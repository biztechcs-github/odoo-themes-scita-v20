# -*- coding: utf-8 -*-
"""Build real-size AR assets from a single product photo, with no external
service and no compiled dependency beyond Pillow. Based on Scita AR Studio's builder.

One photo has no depth: the result is a cut-out "card" (flat panel) or thin box at the
product's real size, not a walk-around 3D model. Good for wall art, mirrors, TVs, doors,
boxed goods and "does it fit" checks of furniture.

Pipeline: photo -> cut-out (alpha PNG) -> textured quad/box -> GLB (glTF 2.0)
-> optional USDZ (only when the free ``usd-core`` package is importable).

glTF conventions used here: +Y up, metres, the model stands on y=0 with the
front face towards +Z, UV (0,0) = top-left of the texture.
"""
import io
import json
import logging
import struct
import tempfile
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

_logger = logging.getLogger(__name__)

MAX_TEXTURE_PX = 1024
# refuse decompression bombs / absurd uploads before decoding them
MAX_SOURCE_PIXELS = 40_000_000
# simple remover sanity check: share of the photo removed as "background"
MIN_REMOVED, MAX_REMOVED = 0.03, 0.97


class PhotoError(ValueError):
    """The photo can't be turned into an AR card (message is shown to the shop owner)."""


def open_photo(image_bytes):
    """Decoded, upright (EXIF orientation applied) image, or PhotoError."""
    try:
        img = Image.open(io.BytesIO(image_bytes))
        if img.width * img.height > MAX_SOURCE_PIXELS:
            raise PhotoError('too_large')
        img.load()
    except PhotoError:
        raise
    except Exception as e:  # noqa: BLE001 - PIL raises many types for bad files
        raise PhotoError('not_an_image') from e
    # phone photos are stored sideways with a rotation flag
    return ImageOps.exif_transpose(img)


def has_transparency(img):
    """The image already has a cut-out (transparent background)."""
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        alpha = img.convert('RGBA').getchannel('A')
        return alpha.getextrema()[0] < 250
    return False


# ---------------------------------------------------------------------------
# 1. Cut-out
# ---------------------------------------------------------------------------

def _rembg_available():
    try:
        import rembg  # noqa: F401
        return True
    except Exception:
        return False


def remove_background(image_bytes, method='auto', tolerance=20):
    """Return ``(png_bytes_rgba, method_used)``.

    method:
      * ``rembg``  - U^2-Net via the ``rembg`` package (best; optional install)
      * ``simple`` - built-in remover for plain studio backgrounds: pixels close
                     to the border colour that are *connected to the border*
                     become transparent (so white areas inside the product stay)
      * ``none``   - keep the photo as is (an existing alpha channel is kept)
      * ``auto``   - the photo's own transparency when it has one, else rembg when
                     installed, else simple
    """
    img = open_photo(image_bytes)
    if method == 'auto':
        if has_transparency(img):
            method = 'none'
        else:
            method = 'rembg' if _rembg_available() else 'simple'

    if method == 'rembg':
        try:
            from rembg import remove
            out = remove(_to_png(img.convert('RGBA')))
            rgba = Image.open(io.BytesIO(out)).convert('RGBA')
            return _to_png(rgba), 'rembg'
        except Exception as e:  # fall back rather than fail the job
            _logger.warning("rembg failed (%s), falling back to simple remover", e)
            method = 'simple'

    if method == 'none':
        return _to_png(img.convert('RGBA')), 'none'

    rgba = _simple_cutout(img.convert('RGB'), tolerance)
    hist = rgba.getchannel('A').histogram()
    removed = sum(hist[:128]) / float(rgba.width * rgba.height)
    if removed < MIN_REMOVED:
        raise PhotoError('background')  # busy background: nothing looks like it
    if removed > MAX_REMOVED:
        # everything "is background": a tightly cropped photo, or a product of the
        # background's colour
        raise PhotoError('all_background')
    return _to_png(rgba), 'simple'


def _simple_cutout(rgb, tolerance):
    w, h = rgb.size
    # Background colour = median of the 4 corner patches.
    patch = max(2, min(w, h) // 50)
    samples = []
    for box in ((0, 0, patch, patch), (w - patch, 0, w, patch),
                (0, h - patch, patch, h), (w - patch, h - patch, w, h)):
        samples.extend(list(rgb.crop(box).getdata()))
    samples.sort()
    bg = samples[len(samples) // 2]

    # Per-pixel distance to the background colour -> "foreground candidate" mask.
    flat = Image.new('RGB', rgb.size, bg)
    # largest difference over the 3 channels: a cream product on an off-white background
    # differs in one channel only (an average would call it background)
    r, g, b = ImageChops.difference(rgb, flat).split()
    diff = ImageChops.lighter(r, ImageChops.lighter(g, b))
    # Everything that differs less than `tolerance` is a background candidate (0),
    # the rest foreground (255).
    fg = diff.point(lambda v: 255 if v > tolerance else 0)

    # Only background candidates *connected to the border* are real background.
    work = fg.copy()
    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
             (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]
    for seed in seeds:
        if work.getpixel(seed) == 0:
            ImageDraw.floodfill(work, seed, 128)
    alpha = work.point(lambda v: 0 if v == 128 else 255)
    # Soften the edge by one pixel so the cut-out does not look jagged.
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.8))

    rgba = rgb.convert('RGBA')
    rgba.putalpha(alpha)
    return rgba


def _to_png(rgba):
    buf = io.BytesIO()
    rgba.save(buf, format='PNG', optimize=True)
    return buf.getvalue()


def prepare_texture(png_bytes, max_px=MAX_TEXTURE_PX, pad_ratio=0.02):
    """Crop the cut-out to its opaque bounding box, add a small transparent
    margin and downscale. Returns ``(png_bytes, width_px, height_px)``."""
    img = Image.open(io.BytesIO(png_bytes)).convert('RGBA')
    bbox = img.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox:
        img = img.crop(bbox)
    w, h = img.size
    pad = int(max(w, h) * pad_ratio)
    if pad:
        canvas = Image.new('RGBA', (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
        canvas.paste(img, (pad, pad))
        img = canvas
    w, h = img.size
    scale = min(1.0, max_px / float(max(w, h)))
    if scale < 1.0:
        img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    return _to_png(img), img.size[0], img.size[1]


def average_colour(png_bytes):
    img = Image.open(io.BytesIO(png_bytes)).convert('RGBA').resize((32, 32))
    r = g = b = n = 0
    for pr, pg, pb, pa in img.getdata():
        if pa > 128:
            r += pr; g += pg; b += pb; n += 1
    if not n:
        return (0.8, 0.8, 0.8)
    return (r / n / 255.0, g / n / 255.0, b / n / 255.0)


# ---------------------------------------------------------------------------
# 2. Geometry
# ---------------------------------------------------------------------------

def _quad(p0, p1, p2, p3, normal, uv=((0, 1), (1, 1), (1, 0), (0, 0))):
    """Four corners given counter-clockwise as seen from the outside:
    bottom-left, bottom-right, top-right, top-left."""
    positions = [p0, p1, p2, p3]
    normals = [normal] * 4
    indices = [0, 1, 2, 0, 2, 3]
    return positions, normals, list(uv), indices


def build_primitives(width_m, height_m, depth_m, shape, has_back_texture):
    """Return a list of dicts: {positions, normals, uvs, indices, material}
    material in {'front', 'back', 'side'}."""
    hw = width_m / 2.0
    prims = []
    if shape == 'flat':
        z = 0.0
        prims.append(dict(zip(
            ('positions', 'normals', 'uvs', 'indices'),
            _quad((-hw, 0, z), (hw, 0, z), (hw, height_m, z), (-hw, height_m, z), (0, 0, 1))),
            material='front'))
        return prims

    hd = max(depth_m, 0.002) / 2.0
    # front (+Z)
    prims.append(dict(zip(('positions', 'normals', 'uvs', 'indices'),
        _quad((-hw, 0, hd), (hw, 0, hd), (hw, height_m, hd), (-hw, height_m, hd), (0, 0, 1))),
        material='front'))
    # back (-Z): seen from behind, "left" is +X. Mirror the UV when we reuse the
    # front texture so text does not read backwards.
    back_uv = ((0, 1), (1, 1), (1, 0), (0, 0)) if has_back_texture else ((1, 1), (0, 1), (0, 0), (1, 0))
    prims.append(dict(zip(('positions', 'normals', 'uvs', 'indices'),
        _quad((hw, 0, -hd), (-hw, 0, -hd), (-hw, height_m, -hd), (hw, height_m, -hd), (0, 0, -1), back_uv)),
        material='back' if has_back_texture else 'front'))
    # left (-X)
    prims.append(dict(zip(('positions', 'normals', 'uvs', 'indices'),
        _quad((-hw, 0, -hd), (-hw, 0, hd), (-hw, height_m, hd), (-hw, height_m, -hd), (-1, 0, 0))),
        material='side'))
    # right (+X)
    prims.append(dict(zip(('positions', 'normals', 'uvs', 'indices'),
        _quad((hw, 0, hd), (hw, 0, -hd), (hw, height_m, -hd), (hw, height_m, hd), (1, 0, 0))),
        material='side'))
    # top (+Y)
    prims.append(dict(zip(('positions', 'normals', 'uvs', 'indices'),
        _quad((-hw, height_m, hd), (hw, height_m, hd), (hw, height_m, -hd), (-hw, height_m, -hd), (0, 1, 0))),
        material='side'))
    # bottom (-Y)
    prims.append(dict(zip(('positions', 'normals', 'uvs', 'indices'),
        _quad((-hw, 0, -hd), (hw, 0, -hd), (hw, 0, hd), (-hw, 0, hd), (0, -1, 0))),
        material='side'))
    return prims


# ---------------------------------------------------------------------------
# 3. GLB writer
# ---------------------------------------------------------------------------

def _pad4(b, fill=b'\x00'):
    return b + fill * ((4 - len(b) % 4) % 4)


def build_glb(front_png, width_m, height_m, depth_m=0.0, shape='flat',
              back_png=None, side_rgb=None, name='product'):
    """Return GLB bytes for a textured quad (``flat``) or box (``box``)."""
    prims = build_primitives(width_m, height_m, depth_m, shape, bool(back_png))
    side_rgb = side_rgb or average_colour(front_png)

    bin_chunks = []
    buffer_views = []
    accessors = []
    offset = 0

    def add_view(data, target=None):
        nonlocal offset
        data = _pad4(data)
        view = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(data)}
        if target:
            view['target'] = target
        buffer_views.append(view)
        bin_chunks.append(data)
        offset += len(data)
        return len(buffer_views) - 1

    def add_accessor(view, comp_type, count, acc_type, minmax=None):
        acc = {'bufferView': view, 'componentType': comp_type, 'count': count, 'type': acc_type}
        if minmax:
            acc['min'], acc['max'] = minmax
        accessors.append(acc)
        return len(accessors) - 1

    # images / textures / materials
    images = [{'bufferView': add_view(front_png), 'mimeType': 'image/png', 'name': 'front'}]
    material_index = {}
    materials = []
    samplers = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}]
    textures = [{'sampler': 0, 'source': 0}]

    def textured_material(tex_index, mat_name):
        materials.append({
            'name': mat_name,
            'pbrMetallicRoughness': {
                'baseColorTexture': {'index': tex_index},
                'metallicFactor': 0.0,
                'roughnessFactor': 0.9,
            },
            'alphaMode': 'MASK',
            'alphaCutoff': 0.5,
            'doubleSided': shape == 'flat',
        })
        return len(materials) - 1

    material_index['front'] = textured_material(0, 'front')
    if back_png:
        images.append({'bufferView': add_view(back_png), 'mimeType': 'image/png', 'name': 'back'})
        textures.append({'sampler': 0, 'source': 1})
        material_index['back'] = textured_material(1, 'back')
    if shape == 'box':
        materials.append({
            'name': 'side',
            'pbrMetallicRoughness': {
                'baseColorFactor': [side_rgb[0], side_rgb[1], side_rgb[2], 1.0],
                'metallicFactor': 0.0,
                'roughnessFactor': 0.95,
            },
        })
        material_index['side'] = len(materials) - 1

    # geometry
    gltf_prims = []
    for prim in prims:
        pos = prim['positions']
        pos_bytes = b''.join(struct.pack('<3f', *p) for p in pos)
        nrm_bytes = b''.join(struct.pack('<3f', *n) for n in prim['normals'])
        uv_bytes = b''.join(struct.pack('<2f', *uv) for uv in prim['uvs'])
        idx_bytes = b''.join(struct.pack('<H', i) for i in prim['indices'])
        mins = [min(p[i] for p in pos) for i in range(3)]
        maxs = [max(p[i] for p in pos) for i in range(3)]
        a_pos = add_accessor(add_view(pos_bytes, 34962), 5126, len(pos), 'VEC3', (mins, maxs))
        a_nrm = add_accessor(add_view(nrm_bytes, 34962), 5126, len(pos), 'VEC3')
        a_uv = add_accessor(add_view(uv_bytes, 34962), 5126, len(pos), 'VEC2')
        a_idx = add_accessor(add_view(idx_bytes, 34963), 5123, len(prim['indices']), 'SCALAR')
        gltf_prims.append({
            'attributes': {'POSITION': a_pos, 'NORMAL': a_nrm, 'TEXCOORD_0': a_uv},
            'indices': a_idx,
            'material': material_index[prim['material']],
            'mode': 4,
        })

    gltf = {
        'asset': {'version': '2.0', 'generator': 'Scita AR Studio (Odoo)'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0, 'name': name}],
        'meshes': [{'primitives': gltf_prims, 'name': name}],
        'materials': materials,
        'textures': textures,
        'images': images,
        'samplers': samplers,
        'accessors': accessors,
        'bufferViews': buffer_views,
        'buffers': [{'byteLength': offset}],
    }

    json_bytes = _pad4(json.dumps(gltf, separators=(',', ':')).encode('utf-8'), b' ')
    bin_bytes = b''.join(bin_chunks)
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    out = io.BytesIO()
    out.write(struct.pack('<4sII', b'glTF', 2, total))
    out.write(struct.pack('<II', len(json_bytes), 0x4E4F534A))  # JSON
    out.write(json_bytes)
    out.write(struct.pack('<II', len(bin_bytes), 0x004E4942))   # BIN
    out.write(bin_bytes)
    return out.getvalue()


# ---------------------------------------------------------------------------
# 4. Optional USDZ writer (usd-core)
# ---------------------------------------------------------------------------

def usd_available():
    try:
        from pxr import Usd  # noqa: F401
        return True
    except Exception:
        return False


def build_usdz(front_png, width_m, height_m, depth_m=0.0, shape='flat', back_png=None,
               side_rgb=None, name='product'):
    """Return USDZ bytes, or ``None`` when ``usd-core`` is not installed.

    Quick Look wants centimetres, so ``metersPerUnit`` is 0.01 and the
    geometry is scaled by 100.
    """
    if not usd_available():
        return None
    from pxr import Usd, UsdGeom, UsdShade, Sdf, Gf, UsdUtils, Vt

    prims = build_primitives(width_m, height_m, depth_m, shape, bool(back_png))
    side_rgb = side_rgb or average_colour(front_png)

    tmpdir = tempfile.mkdtemp(prefix='scita_ar_')
    try:
        usdc_path = os.path.join(tmpdir, f'{name}.usdc')
        usdz_path = os.path.join(tmpdir, f'{name}.usdz')
        front_path = os.path.join(tmpdir, 'front.png')
        with open(front_path, 'wb') as f:
            f.write(front_png)
        if back_png:
            back_path = os.path.join(tmpdir, 'back.png')
            with open(back_path, 'wb') as f:
                f.write(back_png)

        stage = Usd.Stage.CreateNew(usdc_path)
        UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)
        UsdGeom.SetStageMetersPerUnit(stage, 0.01)
        root = UsdGeom.Xform.Define(stage, '/Root')
        stage.SetDefaultPrim(root.GetPrim())

        def make_material(path, texture_file=None, rgb=None):
            mat = UsdShade.Material.Define(stage, path)
            shader = UsdShade.Shader.Define(stage, path + '/PBRShader')
            shader.CreateIdAttr('UsdPreviewSurface')
            shader.CreateInput('roughness', Sdf.ValueTypeNames.Float).Set(0.9)
            shader.CreateInput('metallic', Sdf.ValueTypeNames.Float).Set(0.0)
            if texture_file:
                st_reader = UsdShade.Shader.Define(stage, path + '/stReader')
                st_reader.CreateIdAttr('UsdPrimvarReader_float2')
                st_reader.CreateInput('varname', Sdf.ValueTypeNames.Token).Set('st')
                tex = UsdShade.Shader.Define(stage, path + '/diffuseTexture')
                tex.CreateIdAttr('UsdUVTexture')
                tex.CreateInput('file', Sdf.ValueTypeNames.Asset).Set(os.path.basename(texture_file))
                tex.CreateInput('st', Sdf.ValueTypeNames.Float2).ConnectToSource(
                    st_reader.ConnectableAPI(), 'result')
                tex.CreateInput('wrapS', Sdf.ValueTypeNames.Token).Set('clamp')
                tex.CreateInput('wrapT', Sdf.ValueTypeNames.Token).Set('clamp')
                tex.CreateOutput('rgb', Sdf.ValueTypeNames.Float3)
                tex.CreateOutput('a', Sdf.ValueTypeNames.Float)
                shader.CreateInput('diffuseColor', Sdf.ValueTypeNames.Color3f).ConnectToSource(
                    tex.ConnectableAPI(), 'rgb')
                shader.CreateInput('opacity', Sdf.ValueTypeNames.Float).ConnectToSource(
                    tex.ConnectableAPI(), 'a')
                shader.CreateInput('opacityThreshold', Sdf.ValueTypeNames.Float).Set(0.5)
            else:
                shader.CreateInput('diffuseColor', Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*rgb))
            mat.CreateSurfaceOutput().ConnectToSource(shader.ConnectableAPI(), 'surface')
            return mat

        mats = {'front': make_material('/Root/FrontMat', texture_file=front_path)}
        if back_png:
            mats['back'] = make_material('/Root/BackMat', texture_file=back_path)
        if shape == 'box':
            mats['side'] = make_material('/Root/SideMat', rgb=side_rgb)

        for i, prim in enumerate(prims):
            mesh = UsdGeom.Mesh.Define(stage, f'/Root/Face{i}')
            mesh.CreatePointsAttr([Gf.Vec3f(p[0] * 100, p[1] * 100, p[2] * 100) for p in prim['positions']])
            mesh.CreateNormalsAttr([Gf.Vec3f(*n) for n in prim['normals']])
            mesh.SetNormalsInterpolation(UsdGeom.Tokens.vertex)
            mesh.CreateFaceVertexCountsAttr([3, 3])
            mesh.CreateFaceVertexIndicesAttr(prim['indices'])
            mesh.CreateSubdivisionSchemeAttr(UsdGeom.Tokens.none)
            mesh.CreateDoubleSidedAttr(shape == 'flat')
            # USD st has (0,0) at bottom-left, glTF at top-left -> flip v.
            st = UsdGeom.PrimvarsAPI(mesh).CreatePrimvar(
                'st', Sdf.ValueTypeNames.TexCoord2fArray, UsdGeom.Tokens.vertex)
            st.Set(Vt.Vec2fArray([Gf.Vec2f(u, 1.0 - v) for (u, v) in prim['uvs']]))
            UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(mats[prim['material']])

        stage.GetRootLayer().Save()
        if not UsdUtils.CreateNewUsdzPackage(Sdf.AssetPath(usdc_path), usdz_path):
            return None
        with open(usdz_path, 'rb') as f:
            return f.read()
    except Exception as e:
        _logger.warning("USDZ generation failed: %s", e)
        return None
    finally:
        try:
            for fn in os.listdir(tmpdir):
                os.remove(os.path.join(tmpdir, fn))
            os.rmdir(tmpdir)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# 5. One-call pipeline
# ---------------------------------------------------------------------------

def generate(source_bytes, height_cm, width_cm=None, depth_cm=0.0, shape='flat',
             back_bytes=None, bg_method='auto', name='product'):
    """Full pipeline. Returns a dict with png/glb/usdz bytes and the sizes used."""
    cut_png, method_used = remove_background(source_bytes, bg_method)
    front_png, w_px, h_px = prepare_texture(cut_png)
    back_png = None
    if back_bytes:
        back_cut, _ = remove_background(back_bytes, bg_method)
        back_png, _, _ = prepare_texture(back_cut)

    height_m = float(height_cm) / 100.0
    if width_cm and width_cm > 0:
        width_m = float(width_cm) / 100.0
    else:
        width_m = height_m * (w_px / float(h_px))
    depth_m = float(depth_cm or 0.0) / 100.0 if shape == 'box' else 0.0
    if shape == 'box' and depth_m <= 0:
        depth_m = min(width_m, height_m) * 0.1  # sensible thin box

    side_rgb = average_colour(front_png)
    glb = build_glb(front_png, width_m, height_m, depth_m, shape, back_png, side_rgb, name)
    usdz = build_usdz(front_png, width_m, height_m, depth_m, shape, back_png, side_rgb, name)
    return {
        'cutout_png': front_png,
        'glb': glb,
        'usdz': usdz,
        'bg_method': method_used,
        'width_cm': round(width_m * 100.0, 2),
        'height_cm': round(height_m * 100.0, 2),
        'depth_cm': round(depth_m * 100.0, 2),
        'texture_px': (w_px, h_px),
    }
