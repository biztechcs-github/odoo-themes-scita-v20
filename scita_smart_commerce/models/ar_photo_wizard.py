import logging

from odoo import api, fields, models
from odoo.exceptions import UserError, ValidationError
from odoo.tools import BinaryBytes

from ..tools import ar_multiview, ar_photo

_logger = logging.getLogger(__name__)

class ScitaArPhotoWizard(models.TransientModel):
    """Product 3D / AR tab > "Create from photo": a real-size AR card (flat panel or thin box)
    built from one product photo, on the server, with no outside service."""
    _name = 'scita.ar.photo.wizard'
    _description = 'Create a 3D / AR model from a photo'

    product_tmpl_id = fields.Many2one('product.template', required=True, ondelete='cascade')
    mode = fields.Selection([
        ('single', 'One photo (real-size cut-out)'),
        ('multi', 'Photos of every side (3D model)'),
    ], default='single', required=True,
        help='One photo: a flat card or thin box. Photos of every side: a 3D model, either a box '
             'with a photo on each face, or a shape carved from the outlines of the product.')
    has_uploaded_model = fields.Boolean(compute='_compute_has_uploaded_model')
    photo = fields.Image('Photo (front)', required=True, max_width=4096, max_height=4096,
                         help='The product photographed from the front, straight on, ideally on a plain '
                              'background (or a PNG with a transparent background). The product image '
                              'is used by default.')
    photo_back = fields.Image('Back', max_width=4096, max_height=4096,
                              help='From behind, straight on. Without it, the front photo is used.')
    photo_left = fields.Image('Left side', max_width=4096, max_height=4096,
                              help="The product's left side, straight on (you stand on its left: its front "
                                   "is on your right).")
    photo_right = fields.Image('Right side', max_width=4096, max_height=4096,
                               help="The product's right side, straight on (its front is on your left).")
    photo_top = fields.Image('Top', max_width=4096, max_height=4096,
                             help='From straight above, with the front of the product at the bottom of the photo.')
    photo_bottom = fields.Image('Bottom', max_width=4096, max_height=4096,
                                help='From underneath, with the front of the product at the bottom of the photo. '
                                     'Rarely needed.')
    multi_shape = fields.Selection([
        ('auto', 'Automatic'),
        ('box', 'Box (a photo on each face)'),
        ('carved', 'Any shape (carved from the outlines)'),
    ], string='3D shape', default='auto', required=True,
        help='Automatic: a box when every photo shows a rectangular product (cabinet, boxed goods, '
             'appliance), else a shape carved from the outlines (lamp, vase, chair, sofa). Hollows '
             'no photo shows (inside of a bowl) stay filled.')
    shape = fields.Selection([('flat', 'Flat card'), ('box', 'Thin box')], default='flat', required=True,
                             help='Flat card: one upright panel (posters, mirrors, TVs, doors). '
                                  'Thin box: adds depth and sides (cabinets, boxed goods, furniture).')
    height_cm = fields.Float('Real height (cm)', required=True,
                             help='The real height of the product: AR shows it at this size.')
    width_cm = fields.Float('Real width (cm)', help='0: worked out from the photo\'s proportions.')
    depth_cm = fields.Float('Real depth (cm)', help='Thin box only. 0: 10% of the smaller side.')
    bg_method = fields.Selection([
        ('auto', 'Automatic'),
        ('simple', 'Plain background (built-in)'),
        ('none', 'Keep the photo as is'),
    ], string='Background', default='auto', required=True,
        help='Automatic: keeps the transparent background of a PNG cut-out, else uses the AI remover '
             'when the "rembg" package is installed, else the built-in plain-background remover.')
    placement = fields.Selection([('floor', 'On the floor'), ('wall', 'On a wall')], default='floor',
                                 required=True, string='Place it')
    multi_available = fields.Boolean(compute='_compute_multi_available')
    cutout = fields.Image('Cut-out preview', readonly=True, max_width=1024, max_height=1024)
    preview_info = fields.Char(readonly=True)

    @api.model
    def default_get(self, fields_list):
        values = super().default_get(fields_list)
        product = self.env['product.template'].browse(values.get('product_tmpl_id'))
        if product.exists():
            # read on the server: the product image is never sent through the client context
            if 'photo' in fields_list and product.image_1920:
                values['photo'] = product.image_1920
            if 'placement' in fields_list:
                values['placement'] = product.scita_ar_placement or 'floor'
        return values

    def _compute_multi_available(self):
        self.multi_available = ar_multiview.available()

    @api.depends('product_tmpl_id')
    def _compute_has_uploaded_model(self):
        for wizard in self:
            product = wizard.product_tmpl_id
            wizard.has_uploaded_model = bool(product.scita_has_ar and not product.scita_ar_from_photo)

    @api.constrains('height_cm', 'width_cm', 'depth_cm', 'mode')
    def _check_sizes(self):
        for wizard in self:
            if wizard.mode == 'multi' and (wizard.width_cm <= 0 or wizard.depth_cm <= 0):
                raise ValidationError(self.env._(
                    'Enter the real width, height and depth of the product: they line the photos up.'))
            if wizard.height_cm <= 0:
                raise ValidationError(self.env._('Enter the real height of the product (in cm).'))
            if wizard.width_cm < 0 or wizard.depth_cm < 0:
                raise ValidationError(self.env._('Sizes cannot be negative.'))
            if max(wizard.height_cm, wizard.width_cm, wizard.depth_cm) > 1000:
                raise ValidationError(self.env._('AR supports products up to 10 m.'))

    def _photos(self):
        return {view: field.content for view, field in (
            ('front', self.photo), ('back', self.photo_back), ('left', self.photo_left),
            ('right', self.photo_right), ('top', self.photo_top), ('bottom', self.photo_bottom)) if field}

    def _generate_multi(self):
        self.ensure_one()
        if not self.photo:
            raise UserError(self.env._('Add a photo of the front of the product first.'))
        try:
            return ar_multiview.generate(
                self._photos(), self.width_cm, self.height_cm, self.depth_cm, shape=self.multi_shape,
                bg_method=self.bg_method, name='product_%s' % self.product_tmpl_id.id)
        except ar_multiview.ViewError as e:
            side = dict(self._side_labels())[e.view]
            raise UserError(self.env._('%(side)s: %(problem)s', side=side, problem=self._photo_error(str(e)))) from None
        except ar_photo.PhotoError as e:
            raise UserError(self._photo_error(str(e))) from None

    def _side_labels(self):
        _ = self.env._
        return [('front', _('Front photo')), ('back', _('Back photo')), ('left', _('Left side photo')),
                ('right', _('Right side photo')), ('top', _('Top photo')), ('bottom', _('Bottom photo'))]

    def _multi_text(self, result):
        _ = self.env._
        sizes = ' × '.join('%g' % size for size in (result['width_cm'], result['height_cm'], result['depth_cm']))
        count = len(result['views'])
        if result['shape'] == 'box':
            return _('%(sizes)s cm box, from %(count)s photos', sizes=sizes, count=count)
        return _('%(sizes)s cm 3D shape carved from %(count)s photos', sizes=sizes, count=count)

    def _generate(self):
        self.ensure_one()
        if not self.photo:
            raise UserError(self.env._('Add a photo of the product first.'))
        try:
            return ar_photo.generate(
                self.photo.content, height_cm=self.height_cm, width_cm=self.width_cm or None,
                depth_cm=self.depth_cm, shape=self.shape, bg_method=self.bg_method,
                name='product_%s' % self.product_tmpl_id.id)
        except ar_photo.PhotoError as e:
            raise UserError(self._photo_error(str(e))) from None

    def _photo_error(self, code):
        _ = self.env._
        if code == 'too_large':
            return _('This photo is too large. Use a photo under 40 megapixels.')
        if code == 'numpy_missing':
            return _('"Photos of every side" needs the free "numpy" Python package on the server. '
                     'Ask your administrator to install it (pip install numpy) and restart Odoo.')
        if code == 'empty':
            return _('The photos do not agree on the shape of the product: check that each one shows the '
                     'side its field asks for (e.g. the top photo with the front of the product at the bottom).')
        if code in ('background', 'all_background'):
            return _('The product could not be cut out of its background: the built-in remover needs a '
                     'plain, evenly lit background (a studio or white-wall photo), or a PNG with a '
                     'transparent background. Use another photo, choose "Keep the photo as is", or ask '
                     'your administrator to install the free "rembg" package for busy backgrounds.')
        return _('This file is not a photo Odoo can read. Use a JPEG, PNG or WEBP image.')

    def _size_text(self, result):
        sizes = [result['width_cm'], result['height_cm']] + ([result['depth_cm']] if result['depth_cm'] else [])
        return self.env._('%(sizes)s cm %(shape)s',
                 sizes=' × '.join('%g' % size for size in sizes),
                 shape=dict(self._fields['shape']._description_selection(self.env))[self.shape].lower())

    def action_preview(self):
        """Show the cut-out and the real size before creating the model."""
        self.ensure_one()
        if self.mode == 'multi':
            result = self._generate_multi()
            self.write({'cutout': BinaryBytes(result['contact_sheet'], filename='cutouts.png'),
                        'preview_info': self._multi_text(result)})
        else:
            result = self._generate()
            self.write({'cutout': BinaryBytes(result['cutout_png'], filename='cutout.png'),
                        'preview_info': self._size_text(result)})
        return {'type': 'ir.actions.act_window', 'res_model': self._name, 'res_id': self.id,
                'view_mode': 'form', 'target': 'new', 'name': self.env._('Create a 3D / AR model from a photo')}

    def action_create(self):
        self.ensure_one()
        if self.mode == 'multi':
            result = self._generate_multi()
            result.setdefault('usdz', None)  # iPhones build it from the GLB on the device
            summary = self._multi_text(result)
        else:
            result = self._generate()
            summary = self._size_text(result)
        name = 'product_%s_ar' % self.product_tmpl_id.id
        self.product_tmpl_id.with_context(scita_ar_from_photo=True).write({
            'scita_ar_model_glb': BinaryBytes(result['glb'], filename=name + '.glb'),
            'scita_ar_model_glb_filename': name + '.glb',
            'scita_ar_model_usdz': BinaryBytes(result['usdz'], filename=name + '.usdz') if result['usdz'] else False,
            'scita_ar_model_usdz_filename': name + '.usdz' if result['usdz'] else False,
            'scita_ar_placement': self.placement,
            'scita_ar_scale': 'fixed',  # built at the real size the owner entered
            'scita_ar_from_photo': summary,
        })
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'type': 'success',
                'message': self.env._('3D / AR model created: %s. Shoppers now see "View in 3D" on the product page.',
                                      summary),
                'next': {'type': 'ir.actions.act_window_close'},
            },
        }
