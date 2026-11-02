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
from collections import deque

from PIL import Image, ImageFilter, ImageOps

_logger = logging.getLogger(__name__)

MAX_TEXTURE_PX = 1024
# refuse decompression bombs / absurd uploads before decoding them
MAX_SOURCE_PIXELS = 40_000_000
# simple remover sanity check: share of the photo removed as "background"
MIN_REMOVED, MAX_REMOVED = 0.03, 0.97
# the simple remover works on a copy of this size (pure Python: about 1s a photo)
WORK_PX = 640


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


def _median(values):
    values = sorted(values)
    return values[len(values) // 2]


def _smooth_line(line, window):
    """Running median of a border line of pixels: a product touching the border is ignored."""
    half = max(1, window // 2)
    return [tuple(_median([p[c] for p in line[max(0, i - half):i + half + 1]]) for c in range(3))
            for i in range(len(line))]


def _background_field(px, w, h):
    """Colour of the backdrop expected at each pixel (flat list): a Coons patch of the four
    median-smoothed borders, i.e. the light gradient / vignette of a real photo's backdrop."""
    win = max(9, int(min(w, h) * 0.25))
    top = _smooth_line(px[0:w], win)
    bottom = _smooth_line(px[(h - 1) * w:h * w], win)
    left = _smooth_line([px[y * w] for y in range(h)], win)
    right = _smooth_line([px[y * w + w - 1] for y in range(h)], win)
    c00, c10, c01, c11 = top[0], top[-1], bottom[0], bottom[-1]
    field = []
    for y in range(h):
        v = y / (h - 1)
        lft, rgt = left[y], right[y]
        for x in range(w):
            u = x / (w - 1)
            t, b = top[x], bottom[x]
            field.append(tuple(
                (1 - v) * t[c] + v * b[c] + (1 - u) * lft[c] + u * rgt[c]
                - ((1 - u) * (1 - v) * c00[c] + u * (1 - v) * c10[c] + (1 - u) * v * c01[c] + u * v * c11[c])
                for c in range(3)))
    return field


def _neighbours(i, w, h):
    x, y = i % w, i // w
    if x:
        yield i - 1
    if x < w - 1:
        yield i + 1
    if y:
        yield i - w
    if y < h - 1:
        yield i + w


def _simple_cutout(rgb, tolerance):
    """Built-in remover for product photos on a backdrop (no extra package).

    A single backdrop colour (the corners) left the light gradients, vignettes and soft shadows
    of real photos in the cut-out - and in the 3D model and its real size. The backdrop is
    modelled from the four borders (a smooth colour field); background is what is connected to
    the border through smooth steps (a product's outline is a sharper step) and is close to
    that field, or a soft shadow of it. Backdrop seen through the product (between legs) is
    removed too, and specks of it left apart from the product dropped. Worked out on a copy of
    at most WORK_PX pixels, then scaled up to the photo."""
    W, H = rgb.size
    scale = min(1.0, WORK_PX / float(max(W, H)))
    small = rgb.resize((max(2, int(W * scale)), max(2, int(H * scale))), Image.BILINEAR) if scale < 1 else rgb
    small = small.filter(ImageFilter.MedianFilter(3))  # sensor noise, JPEG blocks
    w, h = small.size
    n = w * h
    px = list(small.getdata())
    field = _background_field(px, w, h)

    def far(i):
        p, f = px[i], field[i]
        return max(abs(p[0] - f[0]), abs(p[1] - f[1]), abs(p[2] - f[2]))

    border = sorted(set(list(range(w)) + list(range((h - 1) * w, n))
                        + [y * w for y in range(h)] + [y * w + w - 1 for y in range(h)]))
    noise = _median([far(i) for i in border])
    tol = max(tolerance, 2.5 * noise + 8)  # close to the backdrop
    step_tol = max(10, noise + 7)  # smooth step between neighbours: no outline crossed
    shadow_step = max(4, noise + 2)  # a shadow fades in (soft edge)

    # 2: close to the backdrop, 1: a shadow on it (darker, same colour), 0: product
    cand = bytearray(n)
    for i in range(n):
        if far(i) <= tol:
            cand[i] = 2
            continue
        p, f = px[i], field[i]
        sp, sf = p[0] + p[1] + p[2], f[0] + f[1] + f[2]
        if sp and sf > 30 and 0.55 <= sp / sf < 1.0 \
                and max(abs(p[c] / sp - f[c] / sf) for c in range(3)) <= 0.02:
            cand[i] = 1

    def smooth(a, b):
        pa, pb = px[a], px[b]
        limit = shadow_step if cand[b] == 1 else step_tol
        return max(abs(pa[0] - pb[0]), abs(pa[1] - pb[1]), abs(pa[2] - pb[2])) <= limit

    bg = bytearray(n)
    queue = deque()
    for i in border:
        if cand[i] == 2:
            bg[i] = 1
            queue.append(i)
    while queue:
        i = queue.popleft()
        for j in _neighbours(i, w, h):
            if not bg[j] and cand[j] and smooth(i, j):
                bg[j] = 1
                queue.append(j)

    # backdrop seen through the product (between chair legs): enclosed smooth areas of the
    # backdrop's colour, large enough not to be a light patch on the product
    seen = bytearray(n)
    min_hole = max(30, n // 400)
    for s in range(n):
        if bg[s] or seen[s] or cand[s] != 2:
            continue
        region, queue = [s], deque([s])
        seen[s] = 1
        while queue:
            i = queue.popleft()
            for j in _neighbours(i, w, h):
                if not seen[j] and not bg[j] and cand[j] == 2 and smooth(i, j):
                    seen[j] = 1
                    queue.append(j)
                    region.append(j)
        if len(region) >= min_hole and sum(1 for i in region if far(i) <= tol * 0.6) >= 0.9 * len(region):
            for i in region:
                bg[i] = 1

    # the product: its biggest part and the parts of a similar size; specks of backdrop left
    # apart would widen the cut-out, and the real size worked out from it
    label = [0] * n
    sizes = []
    for s in range(n):
        if bg[s] or label[s]:
            continue
        sizes.append(0)
        label[s] = len(sizes)
        queue = deque([s])
        while queue:
            i = queue.popleft()
            sizes[-1] += 1
            for j in _neighbours(i, w, h):
                if not bg[j] and not label[j]:
                    label[j] = len(sizes)
                    queue.append(j)
    keep = {k + 1 for k, size in enumerate(sizes) if size >= max(sizes) * 0.05} if sizes else set()
    alpha = Image.new('L', (w, h))
    alpha.putdata([255 if label[i] in keep else 0 for i in range(n)])
    if scale < 1:
        alpha = alpha.resize((W, H), Image.BILINEAR).point(lambda v: 255 if v >= 128 else 0)
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
