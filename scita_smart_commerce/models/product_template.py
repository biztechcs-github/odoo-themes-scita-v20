import json
import logging
import math
import struct

from odoo import _, api, fields, models
from odoo.exceptions import ValidationError

_logger = logging.getLogger(__name__)

# Owners should keep models light: they are downloaded on the shopper's phone.
AR_MAX_BYTES = 25 * 1024 * 1024
AR_MIMETYPES = {'glb': 'model/gltf-binary', 'usdz': 'model/vnd.usdz+zip'}
# first bytes of a valid file (kept out of the _() calls below: the translation extractor
# can't parse bytes next to them)
AR_MAGIC = {'glb': b'glTF', 'usdz': b'PK'}
# photos people upload by mistake (a 3D/AR model can't be made from them here)
PHOTO_MAGIC = (b'\xff\xd8\xff', b'\x89PNG', b'GIF8', b'RIFF')


# a real product is between these sizes (metres): outside, the model is in the wrong unit
AR_MIN_SIZE, AR_MAX_SIZE = 0.02, 10.0


def _mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def _node_matrix(node):
    if 'matrix' in node:
        m = node['matrix']  # column-major
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    tx, ty, tz = node.get('translation', (0, 0, 0))
    qx, qy, qz, qw = node.get('rotation', (0, 0, 0, 1))
    sx, sy, sz = node.get('scale', (1, 1, 1))
    rot = [
        [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
        [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
        [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
    ]
    return [
        [rot[0][0] * sx, rot[0][1] * sy, rot[0][2] * sz, tx],
        [rot[1][0] * sx, rot[1][1] * sy, rot[1][2] * sz, ty],
        [rot[2][0] * sx, rot[2][1] * sy, rot[2][2] * sz, tz],
        [0, 0, 0, 1],
    ]


def glb_size(data):
    """(x, y, z) size in the model's units (metres in glTF) of a GLB file, from the
    bounds of its meshes placed by the scene's node transforms; None if unknown."""
    try:
        if len(data) < 20 or data[:4] != b'glTF':
            return None
        length, kind = struct.unpack('<II', data[12:20])
        if kind != 0x4E4F534A:
            return None
        gltf = json.loads(data[20:20 + length])
        nodes, meshes, accessors = gltf.get('nodes', []), gltf.get('meshes', []), gltf.get('accessors', [])
        scenes = gltf.get('scenes') or [{'nodes': list(range(len(nodes)))}]
        roots = scenes[gltf.get('scene', 0)].get('nodes', [])
        low, high = [math.inf] * 3, [-math.inf] * 3
        stack = [(index, [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]) for index in roots]
        seen = 0
        while stack:
            index, parent = stack.pop()
            seen += 1
            if seen > 10000:  # cyclic or absurd scene graph
                return None
            node = nodes[index]
            matrix = _mat_mul(parent, _node_matrix(node))
            for prim in meshes[node['mesh']].get('primitives', []) if 'mesh' in node else []:
                acc = accessors[prim.get('attributes', {}).get('POSITION', -1)] if 'POSITION' in prim.get('attributes', {}) else {}
                if 'min' not in acc or 'max' not in acc:
                    continue
                for corner in ((x, y, z) for x in (acc['min'][0], acc['max'][0])
                               for y in (acc['min'][1], acc['max'][1]) for z in (acc['min'][2], acc['max'][2])):
                    point = [sum(matrix[r][c] * (corner + (1,))[c] for c in range(4)) for r in range(3)]
                    low = [min(a, b) for a, b in zip(low, point)]
                    high = [max(a, b) for a, b in zip(high, point)]
            stack.extend((child, matrix) for child in node.get('children', []))
        if math.isinf(low[0]):
            return None
        return tuple(h - l for l, h in zip(low, high))
    except Exception:  # noqa: BLE001 - any malformed file: size unknown
        _logger.debug('Could not read the size of a GLB model', exc_info=True)
        return None


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    scita_ar_model_glb = fields.Binary(
        '3D Model (GLB)', attachment=True, copy=False,
        help='Binary glTF (.glb) model shown in the 3D viewer and used for AR on Android '
             '(Scene Viewer / WebXR). Aim for under 5 MB: compressed textures, one mesh.')
    scita_ar_model_glb_filename = fields.Char('3D Model Filename', copy=False)
    scita_ar_model_usdz = fields.Binary(
        'iOS AR Model (USDZ)', attachment=True, copy=False,
        help='Optional .usdz model for AR on iPhone / iPad (AR Quick Look). Without it, '
             'the viewer converts the GLB on the device, which is slower and less faithful.')
    scita_ar_model_usdz_filename = fields.Char('USDZ Filename', copy=False)
    scita_has_ar = fields.Boolean('Has 3D / AR Model', compute='_compute_scita_has_ar', store=True)
    scita_ar_placement = fields.Selection(
        [('floor', 'On the floor'), ('wall', 'On a wall')], string='AR Placement', default='floor',
        required=True, help='Where AR puts the model in the shopper\'s room: wall art, mirrors and TVs '
                            'go on a wall, the rest stands on the floor.')
    scita_ar_scale = fields.Selection(
        [('auto', 'Shoppers can resize it'), ('fixed', 'Real size (fixed)')], string='AR Size',
        default='auto', required=True,
        help='Real size: the model is shown at its true size and pinching does not resize it '
             '(the model must be in metres). Use it to let shoppers check that the product fits.')
    scita_ar_size = fields.Char(
        'Model Size', compute='_compute_scita_ar_size', store=True,
        help='Size of the 3D model as AR shows it at real size: check that it matches the product.')
    scita_ar_size_warning = fields.Char(compute='_compute_scita_ar_size', store=True)
    # "width,height,depth" in cm (glTF: x, y up, z), shown in the 3D viewer; not when the
    # model does not seem to be in metres
    scita_ar_dimensions = fields.Char(compute='_compute_scita_ar_size', store=True)
    scita_ar_from_photo = fields.Char(
        'Created From Photo', readonly=True, copy=False,
        help='Set when the 3D model was created from a product photo: its real size.')

    @api.depends('scita_ar_model_glb')
    def _compute_scita_has_ar(self):
        for product in self:
            product.scita_has_ar = bool(product.scita_ar_model_glb)

    @api.constrains('scita_ar_model_glb', 'scita_ar_model_usdz')
    def _check_scita_ar_models(self):
        for product in self:
            for field_name, magic, label in (
                ('scita_ar_model_glb', AR_MAGIC['glb'], _('a binary glTF (.glb) file')),
                ('scita_ar_model_usdz', AR_MAGIC['usdz'], _('a USDZ (.usdz) file')),
            ):
                value = product[field_name]
                if not value:
                    continue
                data = bytes(value)
                if data.startswith(PHOTO_MAGIC):
                    raise ValidationError(_(
                        '%(field)s: this is a photo, not a 3D model. Use the "Create from a photo" '
                        'button above to turn it into a real-size AR cut-out, or upload %(kind)s made '
                        'with a 3D tool (e.g. a phone scanning app, or the manufacturer\'s 3D file).',
                        field=product._fields[field_name].string, kind=label))
                if not data.startswith(magic):
                    raise ValidationError(_('%(field)s must be %(kind)s.',
                                            field=product._fields[field_name].string, kind=label))
                if len(data) > AR_MAX_BYTES:
                    raise ValidationError(_('%(field)s is larger than 25 MB; shoppers would wait too long. '
                                            'Please compress it (e.g. with gltf-transform or Reality Converter).',
                                            field=product._fields[field_name].string))

    @api.depends('scita_ar_model_glb')
    def _compute_scita_ar_size(self):
        for product in self:
            size = glb_size(bytes(product.scita_ar_model_glb.content)) if product.scita_ar_model_glb else None
            if not size:
                product.scita_ar_size = False
                product.scita_ar_size_warning = False
                product.scita_ar_dimensions = False
                continue
            product.scita_ar_size = self.env._('%s cm', ' × '.join('%g' % round(v * 100, 1) for v in size))
            biggest = max(size)
            if biggest > AR_MAX_SIZE:
                product.scita_ar_size_warning = self.env._(
                    'Larger than 10 m: the model is probably in centimetres or millimetres instead of '
                    'metres. At real size, AR would show it far too big.')
            elif biggest < AR_MIN_SIZE:
                product.scita_ar_size_warning = self.env._(
                    'Smaller than 2 cm: the model is probably not in metres. At real size, AR would show '
                    'it far too small.')
            else:
                product.scita_ar_size_warning = False
            product.scita_ar_dimensions = not product.scita_ar_size_warning and ','.join(
                '%g' % round(v * 100) for v in size)

    def write(self, vals):
        if 'scita_ar_model_glb' in vals:
            if not self.env.context.get('scita_ar_from_photo'):
                # a model uploaded by hand replaces the one created from a photo
                vals = {**vals, 'scita_ar_from_photo': False}
            if 'scita_ar_model_usdz' not in vals:
                # the iPhone file was made from the previous model: keep it and iPhones would
                # show the old product (without it, they convert the new GLB on the device)
                vals = {**vals, 'scita_ar_model_usdz': False, 'scita_ar_model_usdz_filename': False}
        return super().write(vals)

    def action_scita_ar_from_photo(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Create a 3D / AR model from a photo'),
            'res_model': 'scita.ar.photo.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {'default_product_tmpl_id': self.id},
        }

    def _scita_ar_urls(self):
        """Public URLs of the 3D/AR files (empty dict when the product has no model)."""
        self.ensure_one()
        if not self.scita_has_ar:
            return {}
        unique = fields.Datetime.to_string(self.write_date).replace(' ', 'T') if self.write_date else ''
        urls = {
            'glb': '/scita/ar/model/%s.glb?unique=%s' % (self.id, unique),
            'placement': self.scita_ar_placement or 'floor',
            'scale': self.scita_ar_scale or 'auto',
        }
        if self.scita_ar_model_usdz:
            urls['usdz'] = '/scita/ar/model/%s.usdz?unique=%s' % (self.id, unique)
        return urls
