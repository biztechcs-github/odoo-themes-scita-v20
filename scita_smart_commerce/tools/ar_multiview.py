"""Build a real-size 3D model of a product from photos of its sides (front, back, left,
right, top, bottom), on the server, with Pillow and numpy only.

Two ways, picked automatically or by the shop owner:

* ``box``: the photos are put on the six faces of a box at the product's real size
  (cabinets, boxed goods, appliances...). Exact for box-shaped products.
* ``carved``: "shape from silhouette". A voxel grid filling the product's real size is
  carved by the outline of the product in every photo; the surface is smoothed and each
  part of it gets the photo that faces it (with an occlusion test). Hollows that no
  outline shows (inside of a bowl) stay filled: an approximate, clearly 3D shape.

Coordinates (glTF): metres, +Y up, the product stands on y=0, its front faces +Z, its
right side is +X. Photos are taken straight on; for the top photo the front of the
product is at the bottom of the photo, same for the bottom photo (taken from below).
"""
import io
import json
import logging
import struct

from PIL import Image

try:
    import numpy as np
except ImportError:  # optional: only "photos of every side" needs it (pip install numpy)
    np = None

from .ar_photo import PhotoError, _to_png, average_colour, remove_background

_logger = logging.getLogger(__name__)

VIEWS = ('front', 'back', 'left', 'right', 'top', 'bottom')
# direction from the product towards the camera of each photo
VIEW_DIRECTION = {
    'front': (0, 0, 1), 'back': (0, 0, -1),
    'left': (-1, 0, 0), 'right': (1, 0, 0),
    'top': (0, 1, 0), 'bottom': (0, -1, 0),
}
MAX_TEXTURE_PX = 1024
GRID = 112                # voxels along the longest side of the product
BOX_FILL = 0.92           # outline filling its rectangle this much: the product is a box
SMOOTH_STEPS = 10
MIN_VIEW_SCORE = 0.25     # a surface part is painted from a photo it faces at least this much
NORMAL_DIFFUSION = 12     # smoothing of the facing used to pick photos (removes stripes)


def available():
    """The numpy package this needs is installed."""
    return np is not None


class ViewError(PhotoError):
    """A photo of one side can't be used: ``view`` names the side."""

    def __init__(self, code, view):
        super().__init__(code)
        self.view = view


# ---------------------------------------------------------------------------
# 1. Photos -> aligned silhouettes and textures
# ---------------------------------------------------------------------------

def _face_size(view, size):
    """(width, height) in metres of the face a photo shows."""
    width, height, depth = size
    return {
        'front': (width, height), 'back': (width, height),
        'left': (depth, height), 'right': (depth, height),
        'top': (width, depth), 'bottom': (width, depth),
    }[view]


def prepare_view(image_bytes, view, bg_method='auto'):
    """Cut-out of one photo, cropped to the product. Returns a dict with the mask
    (bool array, rows top->bottom), the texture (RGB PIL image, background filled with
    the product's average colour) and how much of its rectangle the outline fills."""
    try:
        png, method = remove_background(image_bytes, bg_method)
    except PhotoError as e:
        if str(e) == 'all_background' and bg_method == 'auto':
            # photo cropped to the product (common for box faces): it is all product
            png, method = remove_background(image_bytes, 'none')
        else:
            raise ViewError(str(e), view) from None
    rgba = Image.open(io.BytesIO(png)).convert('RGBA')
    alpha = rgba.getchannel('A').point(lambda v: 255 if v > 127 else 0)
    bbox = alpha.getbbox()
    if not bbox:
        raise ViewError('background', view)
    rgba = rgba.crop(bbox)
    alpha = alpha.crop(bbox)
    scale = min(1.0, MAX_TEXTURE_PX / float(max(rgba.size)))
    if scale < 1.0:
        new_size = (max(1, int(rgba.width * scale)), max(1, int(rgba.height * scale)))
        rgba = rgba.resize(new_size, Image.LANCZOS)
        alpha = alpha.resize(new_size, Image.NEAREST)
    mask = np.asarray(alpha) > 127
    colour = tuple(int(c * 255) for c in average_colour(_to_png(rgba)))
    texture = Image.new('RGB', rgba.size, colour)
    texture.paste(rgba.convert('RGB'), (0, 0), rgba.getchannel('A'))
    return {'mask': mask, 'texture': texture, 'fill': float(mask.mean()), 'method': method, 'colour': colour}


def _project(view, points, size):
    """(u, v) in [0, 1] of points (N x 3) in the photo of `view` (u to the right, v down)."""
    width, height, depth = size
    x, y, z = points[:, 0], points[:, 1], points[:, 2]
    if view == 'front':
        return (x + width / 2) / width, (height - y) / height
    if view == 'back':
        return (width / 2 - x) / width, (height - y) / height
    if view == 'left':
        return (z + depth / 2) / depth, (height - y) / height
    if view == 'right':
        return (depth / 2 - z) / depth, (height - y) / height
    if view == 'top':
        return (x + width / 2) / width, (z + depth / 2) / depth
    return (width / 2 - x) / width, (z + depth / 2) / depth  # bottom


def _sample_mask(mask, u, v):
    rows, cols = mask.shape
    col = np.clip((u * cols).astype(np.int64), 0, cols - 1)
    row = np.clip((v * rows).astype(np.int64), 0, rows - 1)
    return mask[row, col]


# ---------------------------------------------------------------------------
# 2. Carving: voxels inside every outline -> smooth closed mesh
# ---------------------------------------------------------------------------

def carve(views, size, grid=GRID):
    """Occupancy grid (nx, ny, nz) of the product, and the voxel size (metres)."""
    width, height, depth = size
    cell = max(size) / float(grid)
    nx, ny, nz = (max(4, int(round(s / cell))) for s in size)
    xs = (np.arange(nx) + 0.5) / nx * width - width / 2
    ys = (np.arange(ny) + 0.5) / ny * height
    zs = (np.arange(nz) + 0.5) / nz * depth - depth / 2
    gx, gy, gz = np.meshgrid(xs, ys, zs, indexing='ij')
    points = np.stack([gx.ravel(), gy.ravel(), gz.ravel()], axis=1)
    inside = np.ones(len(points), dtype=bool)
    for view, data in views.items():
        u, v = _project(view, points, size)
        inside &= _sample_mask(data['mask'], u, v)
    return inside.reshape(nx, ny, nz), (width / nx, height / ny, depth / nz)


def _surface_quads(occ):
    """Outer faces of the occupied voxels as quads of corner indices (counter-clockwise
    seen from outside), on the (nx+1, ny+1, nz+1) corner lattice."""
    nx, ny, nz = occ.shape
    padded = np.pad(occ, 1)
    corner = lambda i, j, k: (i * (ny + 1) + j) * (nz + 1) + k  # noqa: E731
    quads = []
    for axis in range(3):
        for sign in (1, -1):
            neighbour = np.roll(padded, -sign, axis=axis)[1:-1, 1:-1, 1:-1]
            i, j, k = np.nonzero(occ & ~neighbour)
            if not len(i):
                continue
            # the face plane is on the +side (sign 1) or the -side of the voxel
            if axis == 0:
                p = i + (sign > 0)
                c = [corner(p, j, k), corner(p, j + 1, k), corner(p, j + 1, k + 1), corner(p, j, k + 1)]
            elif axis == 1:
                p = j + (sign > 0)
                c = [corner(i, p, k), corner(i, p, k + 1), corner(i + 1, p, k + 1), corner(i + 1, p, k)]
            else:
                p = k + (sign > 0)
                c = [corner(i, j, p), corner(i + 1, j, p), corner(i + 1, j + 1, p), corner(i, j + 1, p)]
            c = np.stack(c, axis=1)
            if sign < 0:
                c = c[:, ::-1]
            quads.append(c)
    return np.concatenate(quads) if quads else np.zeros((0, 4), dtype=np.int64)


def _vertex_normals(positions, triangles):
    a, b, c = (positions[triangles[:, n]] for n in range(3))
    face = np.cross(b - a, c - a)  # area weighted
    normals = np.zeros_like(positions)
    for n in range(3):
        np.add.at(normals, triangles[:, n], face)
    length = np.linalg.norm(normals, axis=1, keepdims=True)
    return normals / np.where(length > 0, length, 1)


def carved_mesh(occ, cell, size, smooth=SMOOTH_STEPS):
    """Closed triangle mesh (positions in metres, triangles) of the occupied voxels,
    smoothed (Taubin, no shrinking) and fitted back to the real size."""
    nx, ny, nz = occ.shape
    quads = _surface_quads(occ)
    if not len(quads):
        raise PhotoError('empty')
    used, inverse = np.unique(quads, return_inverse=True)
    quads = inverse.reshape(-1, 4)
    k = used % (nz + 1)
    j = (used // (nz + 1)) % (ny + 1)
    i = used // ((nz + 1) * (ny + 1))
    width, height, depth = size
    positions = np.stack([i * cell[0] - width / 2, j * cell[1], k * cell[2] - depth / 2], axis=1).astype(np.float64)
    triangles = np.concatenate([quads[:, [0, 1, 2]], quads[:, [0, 2, 3]]])

    # Taubin smoothing over the mesh edges: rounds the voxel steps, keeps the volume
    edges = np.concatenate([quads[:, [0, 1]], quads[:, [1, 2]], quads[:, [2, 3]], quads[:, [3, 0]]])
    edges = np.unique(np.sort(edges, axis=1), axis=0)
    degree = np.bincount(edges.ravel(), minlength=len(positions)).astype(np.float64)[:, None]
    for step in range(smooth * 2):
        factor = 0.5 if step % 2 == 0 else -0.53
        total = np.zeros_like(positions)
        np.add.at(total, edges[:, 0], positions[edges[:, 1]])
        np.add.at(total, edges[:, 1], positions[edges[:, 0]])
        positions += factor * (total / np.maximum(degree, 1) - positions)
    # fit the real size exactly again
    low, high = positions.min(axis=0), positions.max(axis=0)
    target_low = np.array([-width / 2, 0.0, -depth / 2])
    positions = target_low + (positions - low) / np.where(high - low > 0, high - low, 1) * np.array(size)
    return positions, triangles


def _depth_maps(occ):
    """For each photo, the first occupied voxel met by the camera, per pixel column of the
    voxel grid (to know if a surface part is seen in that photo or hidden)."""
    nx, ny, nz = occ.shape
    any_x, any_y, any_z = occ.any(axis=0), occ.any(axis=1), occ.any(axis=2)
    idx_x = np.arange(nx)[:, None, None]
    idx_y = np.arange(ny)[None, :, None]
    idx_z = np.arange(nz)[None, None, :]
    big = 10 ** 6
    return {
        'front': (np.where(occ, idx_z, -1).max(axis=2), any_z),   # max z per (x, y)
        'back': (np.where(occ, idx_z, big).min(axis=2), any_z),   # min z per (x, y)
        'right': (np.where(occ, idx_x, -1).max(axis=0), any_x),   # max x per (y, z)
        'left': (np.where(occ, idx_x, big).min(axis=0), any_x),   # min x per (y, z)
        'top': (np.where(occ, idx_y, -1).max(axis=1), any_y),     # max y per (x, z)
        'bottom': (np.where(occ, idx_y, big).min(axis=1), any_y),  # min y per (x, z)
    }


def _visible(view, centres, occ, size, depth_maps):
    """Which triangle centres are on the surface seen by the camera of `view`."""
    nx, ny, nz = occ.shape
    width, height, depth = size
    fx = np.clip(((centres[:, 0] + width / 2) / width * nx).astype(np.int64), 0, nx - 1)
    fy = np.clip((centres[:, 1] / height * ny).astype(np.int64), 0, ny - 1)
    fz = np.clip(((centres[:, 2] + depth / 2) / depth * nz).astype(np.int64), 0, nz - 1)
    first, _any = depth_maps[view]
    slack = 2.5  # voxels: smoothing moves the surface a little
    if view in ('front', 'back'):
        limit, own = first[fx, fy], fz
    elif view in ('left', 'right'):
        limit, own = first[fy, fz], fx
    else:
        limit, own = first[fx, fz], fy
    if view in ('front', 'right', 'top'):
        return own >= limit - slack
    return own <= limit + slack


# ---------------------------------------------------------------------------
# 3. GLB writer (any triangle mesh, one primitive per material)
# ---------------------------------------------------------------------------

def _pad4(data, fill=b'\x00'):
    return data + fill * ((4 - len(data) % 4) % 4)


def write_glb(primitives, materials, images, name='product'):
    """primitives: [{'positions', 'normals', 'uvs' (or None), 'indices', 'material'}]
    (numpy arrays); materials: glTF material dicts; images: JPEG/PNG bytes."""
    chunks, views, accessors = [], [], []
    offset = 0

    def add_view(data, target=None):
        nonlocal offset
        data = _pad4(data)
        view = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(data)}
        if target:
            view['target'] = target
        views.append(view)
        chunks.append(data)
        offset += len(data)
        return len(views) - 1

    def add_accessor(array, component, kind, with_bounds=False):
        accessor = {'bufferView': add_view(array.tobytes(), 34963 if kind == 'SCALAR' else 34962),
                    'componentType': component, 'count': len(array), 'type': kind}
        if with_bounds:
            accessor['min'] = array.min(axis=0).tolist()
            accessor['max'] = array.max(axis=0).tolist()
        accessors.append(accessor)
        return len(accessors) - 1

    gltf_images = []
    for data in images:
        mime = 'image/png' if data[:4] == b'\x89PNG' else 'image/jpeg'
        gltf_images.append({'bufferView': add_view(data), 'mimeType': mime})
    gltf_primitives = []
    for prim in primitives:
        attributes = {
            'POSITION': add_accessor(prim['positions'].astype(np.float32), 5126, 'VEC3', True),
            'NORMAL': add_accessor(prim['normals'].astype(np.float32), 5126, 'VEC3'),
        }
        if prim.get('uvs') is not None:
            attributes['TEXCOORD_0'] = add_accessor(prim['uvs'].astype(np.float32), 5126, 'VEC2')
        gltf_primitives.append({
            'attributes': attributes,
            'indices': add_accessor(prim['indices'].astype(np.uint32).ravel(), 5125, 'SCALAR'),
            'material': prim['material'],
            'mode': 4,
        })
    gltf = {
        'asset': {'version': '2.0', 'generator': 'Scita Smart Commerce (Odoo)'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0, 'name': name}],
        'meshes': [{'primitives': gltf_primitives, 'name': name}],
        'materials': materials,
        'accessors': accessors,
        'bufferViews': views,
        'buffers': [{'byteLength': offset}],
    }
    if gltf_images:
        gltf['images'] = gltf_images
        gltf['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}]
        gltf['textures'] = [{'sampler': 0, 'source': n} for n in range(len(gltf_images))]
    json_bytes = _pad4(json.dumps(gltf, separators=(',', ':')).encode(), b' ')
    binary = b''.join(chunks)
    out = io.BytesIO()
    out.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(json_bytes) + 8 + len(binary)))
    out.write(struct.pack('<II', len(json_bytes), 0x4E4F534A))
    out.write(json_bytes)
    out.write(struct.pack('<II', len(binary), 0x004E4942))
    out.write(binary)
    return out.getvalue()


def _jpeg(image):
    buf = io.BytesIO()
    image.save(buf, 'JPEG', quality=85, optimize=True)
    return buf.getvalue()


def _textured(name, texture_index):
    return {'name': name, 'pbrMetallicRoughness': {
        'baseColorTexture': {'index': texture_index}, 'metallicFactor': 0.0, 'roughnessFactor': 0.85}}


def _plain(name, colour):
    return {'name': name, 'pbrMetallicRoughness': {
        'baseColorFactor': [c / 255.0 for c in colour] + [1.0], 'metallicFactor': 0.0, 'roughnessFactor': 0.9}}


# ---------------------------------------------------------------------------
# 4. Box: one photo per face
# ---------------------------------------------------------------------------

# corners of each face, counter-clockwise from outside, in photo order:
# bottom-left, bottom-right, top-right, top-left of the photo
def _box_face_corners(view, size):
    w, h, d = size[0] / 2, size[1], size[2] / 2
    return {
        'front': [(-w, 0, d), (w, 0, d), (w, h, d), (-w, h, d)],
        'back': [(w, 0, -d), (-w, 0, -d), (-w, h, -d), (w, h, -d)],
        'left': [(-w, 0, -d), (-w, 0, d), (-w, h, d), (-w, h, -d)],
        'right': [(w, 0, d), (w, 0, -d), (w, h, -d), (w, h, d)],
        'top': [(-w, h, d), (w, h, d), (w, h, -d), (-w, h, -d)],
        'bottom': [(w, 0, d), (-w, 0, d), (-w, 0, -d), (w, 0, -d)],
    }[view]


def build_box(views, size, name='product'):
    colour = next(iter(views.values()))['colour']
    primitives, materials, images = [], [], []
    for view in VIEWS:
        corners = np.array(_box_face_corners(view, size), dtype=np.float64)
        normal = np.tile(np.array(VIEW_DIRECTION[view], dtype=np.float64), (4, 1))
        data = views.get(view)
        if not data and view == 'back' and 'front' in views:
            # no back photo: the front one, mirrored so that it is not a ghost of the front
            data = {'texture': views['front']['texture'].transpose(Image.FLIP_LEFT_RIGHT)}
        if data:
            images.append(_jpeg(data['texture']))
            materials.append(_textured(view, len(images) - 1))
        else:
            materials.append(_plain(view, colour))
        primitives.append({
            'positions': corners, 'normals': normal,
            'uvs': np.array([(0, 1), (1, 1), (1, 0), (0, 0)], dtype=np.float64),
            'indices': np.array([[0, 1, 2], [0, 2, 3]]), 'material': len(materials) - 1,
        })
    return write_glb(primitives, materials, images, name)


# ---------------------------------------------------------------------------
# 5. Carved shape: each part painted from the photo facing it
# ---------------------------------------------------------------------------

def _diffuse(values, triangles, iterations):
    """Average a per-vertex field (e.g. normals) with its neighbours, `iterations` times:
    the facing used to pick photos then follows the overall shape, not the voxel steps."""
    edges = np.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]])
    degree = np.bincount(edges[:, 0], minlength=len(values)).astype(np.float64)[:, None]
    values = values.copy()
    for _step in range(iterations):
        total = np.zeros_like(values)
        np.add.at(total, edges[:, 0], values[edges[:, 1]])
        values = 0.5 * values + 0.5 * total / np.maximum(degree, 1)
    return values / np.maximum(np.linalg.norm(values, axis=1, keepdims=True), 1e-12)


def _triangle_neighbours(triangles):
    """(T, 3) indices of the triangles sharing each edge (closed mesh: exactly one)."""
    count = len(triangles)
    half = np.sort(np.concatenate([triangles[:, [0, 1]], triangles[:, [1, 2]], triangles[:, [2, 0]]]), axis=1)
    keys = half[:, 0].astype(np.int64) * (int(triangles.max()) + 1) + half[:, 1]
    order = np.argsort(keys, kind='stable')
    neighbours = np.arange(len(half)) % count  # default: itself (open edge)
    same = keys[order][1:] == keys[order][:-1]
    first, second = order[:-1][same], order[1:][same]
    neighbours[first] = second % count
    neighbours[second] = first % count
    return np.stack([neighbours[:count], neighbours[count:2 * count], neighbours[2 * count:]], axis=1)


def _majority_smooth(labels, triangles, allowed, rounds=4):
    """A triangle takes the photo of 2 of its 3 neighbours when that photo sees it too:
    removes isolated strips of another photo."""
    neighbours = _triangle_neighbours(triangles)
    rows = np.arange(len(labels))
    for _round in range(rounds):
        n = labels[neighbours]
        candidate = np.where((n[:, 0] == n[:, 1]) | (n[:, 0] == n[:, 2]), n[:, 0],
                             np.where(n[:, 1] == n[:, 2], n[:, 1], labels))
        ok = (candidate == -1) | allowed[rows, np.maximum(candidate, 0)]
        changed = (candidate != labels) & ok
        if not changed.any():
            break
        labels = np.where(changed, candidate, labels)
    return labels


def build_carved(views, size, name='product', grid=GRID):
    occ, cell = carve(views, size, grid)
    if not occ.any():
        raise PhotoError('empty')
    positions, triangles = carved_mesh(occ, cell, size)
    normals = _vertex_normals(positions, triangles)
    a, b, c = (positions[triangles[:, n]] for n in range(3))
    centres = (a + b + c) / 3.0

    # the photo each triangle is painted from: the one it faces most (smoothed normals, so
    # that the voxel steps do not flip neighbours between photos), among those seeing it
    depth_maps = _depth_maps(occ)
    view_names = [view for view in VIEWS if view in views]
    smooth_normals = _diffuse(normals, triangles, NORMAL_DIFFUSION)[triangles].mean(axis=1)
    scores = np.stack([smooth_normals @ np.array(VIEW_DIRECTION[view], dtype=np.float64)
                       for view in view_names], axis=1)
    seen = np.stack([_visible(view, centres, occ, size, depth_maps) for view in view_names], axis=1)
    allowed = seen & (scores > MIN_VIEW_SCORE)
    best_view = np.where(allowed.any(axis=1), np.where(allowed, scores, -np.inf).argmax(axis=1), -1)
    # parts no photo faces (e.g. the top of a lamp base, under its shade): painted from the
    # photo that sees them best, else the one they face best (a side photo gives the
    # colour of that part at that height)
    left = best_view < 0
    fallback = np.where(seen.any(axis=1), np.where(seen, scores, -np.inf).argmax(axis=1), scores.argmax(axis=1))
    best_view = np.where(left, fallback, best_view)
    best_view = _majority_smooth(best_view, triangles, allowed | seen)

    colour = views[view_names[0]]['colour']
    primitives, materials, images = [], [], []
    for index in [*range(len(view_names)), -1]:
        selected = triangles[best_view == index]
        if not len(selected):
            continue
        used, local = np.unique(selected, return_inverse=True)
        prim = {'positions': positions[used], 'normals': normals[used], 'indices': local.reshape(-1, 3)}
        if index >= 0:
            view = view_names[index]
            u, v = _project(view, positions[used], size)
            prim['uvs'] = np.stack([np.clip(u, 0, 1), np.clip(v, 0, 1)], axis=1)
            images.append(_jpeg(views[view]['texture']))
            materials.append(_textured(view, len(images) - 1))
        else:
            materials.append(_plain('unseen', colour))  # no photo sees it (e.g. no bottom photo)
        prim['material'] = len(materials) - 1
        primitives.append(prim)
    return write_glb(primitives, materials, images, name), {
        'triangles': int(len(triangles)), 'voxels': int(occ.sum()), 'grid': occ.shape}


# ---------------------------------------------------------------------------
# 6. One call
# ---------------------------------------------------------------------------

def generate(photos, width_cm, height_cm, depth_cm, shape='auto', bg_method='auto', name='product'):
    """photos: {view: image bytes} (front required). Returns a dict with the GLB, the
    shape used, a contact sheet of the cut-outs and statistics."""
    if not available():
        raise PhotoError('numpy_missing')
    if not photos.get('front'):
        raise ViewError('missing', 'front')
    size = (width_cm / 100.0, height_cm / 100.0, depth_cm / 100.0)
    views = {view: prepare_view(data, view, bg_method) for view, data in photos.items()
             if view in VIEWS and data}
    if shape == 'auto':
        shape = 'box' if min(data['fill'] for data in views.values()) >= BOX_FILL else 'carved'
    stats = {}
    if shape == 'box':
        glb = build_box(views, size, name)
    else:
        glb, stats = build_carved(views, size, name)
    return {
        'glb': glb,
        'shape': shape,
        'views': [view for view in VIEWS if view in views],
        'contact_sheet': contact_sheet(views),
        'width_cm': round(width_cm, 2), 'height_cm': round(height_cm, 2), 'depth_cm': round(depth_cm, 2),
        **stats,
    }


def contact_sheet(views, thumb=200):
    """The cut-outs side by side (front, back, left, right, top, bottom) for the preview."""
    present = [view for view in VIEWS if view in views]
    sheet = Image.new('RGB', (thumb * len(present) + 8 * (len(present) + 1), thumb + 16), (255, 255, 255))
    for n, view in enumerate(present):
        texture = views[view]['texture'].copy()
        mask = Image.fromarray((views[view]['mask'] * 255).astype(np.uint8))
        texture.thumbnail((thumb, thumb))
        mask = mask.resize(texture.size)
        cell = Image.new('RGB', (thumb, thumb), (235, 235, 235))
        cell.paste(texture, ((thumb - texture.width) // 2, (thumb - texture.height) // 2), mask)
        sheet.paste(cell, (8 + n * (thumb + 8), 8))
    return _to_png(sheet)
