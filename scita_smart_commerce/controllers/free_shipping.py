from odoo import http
from odoo.http import request


class ScitaFreeShippingController(http.Controller):

    @http.route('/scita/free_shipping/bar', type='jsonrpc', auth='public', website=True, methods=['POST'])
    def free_shipping_bar(self, context='cart', **kw):
        """Render the free-shipping progress bar for the current cart."""
        website = request.env.website
        order = request.cart
        info = website._scita_free_shipping_info(order) if order else {'show': False}
        if not info.get('show'):
            return {'show': False, 'html': ''}
        html = request.env['ir.ui.view']._render_template('scita_smart_commerce.free_shipping_bar', {
            'fsb': info,
            'fsb_context': 'mini' if context == 'mini' else 'cart',
            'website': website,
        })
        return {'show': True, 'reached': info['reached'], 'html': html}
