from odoo import http
from odoo.http import request
from odoo.tools import format_amount

from ..models.product_template import AR_MIMETYPES

# products of all the hotspots of one page, at most
MAX_PAGE_HOTSPOT_PRODUCTS = 60


class ScitaHotspotAr(http.Controller):

    def _visible_products(self, product_ids):
        """Products the current visitor may see on this website (published for the public)."""
        return request.env['product.template'].search(
            [('id', 'in', list(product_ids)), ('sale_ok', '=', True)] + list(request.env.website.website_domain()))

    @http.route('/scita/ar/model/<int:product_id>.<string:kind>', type='http', auth='public',
                website=True, sitemap=False, readonly=True)
    def ar_model(self, product_id, kind, **kwargs):
        """Serve a product's 3D/AR file with the MIME type AR viewers expect.
        Only for products the visitor can see (published ones for the public)."""
        if kind not in AR_MIMETYPES:
            raise request.not_found()
        product = self._visible_products([product_id]).filtered('scita_has_ar')
        field_name = 'scita_ar_model_%s' % kind
        if not product or not product.sudo()[field_name]:
            raise request.not_found()
        stream = request.env['ir.binary']._get_stream_from(
            product.sudo(), field_name, filename='%s.%s' % (product.id, kind), mimetype=AR_MIMETYPES[kind])
        # the URL carries ?unique=<write_date>, so the file can be cached for good;
        # CORS so Scene Viewer / WebXR pages loading the model are not blocked
        response = stream.get_response(immutable=bool(kwargs.get('unique')), content_security_policy=None)
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

    def _card(self, product):
        """Shopper-facing data of one product.template, as the current visitor sees it."""
        website = request.env.website
        info = product._get_combination_info(only_template=False)
        currency = info['currency']  # the visitor's pricelist currency
        variant = product.product_variant_id
        # Theme Scita's hide-price rule (Request a Quote / login to see price): no price, no cart
        hide_price = bool(info.get('hide_price') or website._scita_hide_price(product))
        in_stock = not variant or not variant._is_sold_out()
        # several variants, custom or no-variant attributes, optional products: choose on the product page
        needs_options = bool(product.product_variant_count > 1 or product.has_configurable_attributes
                             or product.optional_product_ids)
        can_add = bool(not hide_price and in_stock and not needs_options and product._website_show_quick_add())
        if hide_price:
            old_price = 0
        elif info.get('has_discounted_price'):
            old_price = info['list_price']
        elif info.get('compare_list_price') and info['compare_list_price'] > info['price']:
            old_price = info['compare_list_price']
        else:
            old_price = 0
        compare_price = format_amount(request.env, old_price, currency) if old_price else ''
        # "-15%" sale badge on the card
        discount = max(0, round((1 - info['price'] / old_price) * 100)) if old_price else 0
        return {
            'id': product.id,
            'product_id': variant.id,
            # as shown on the website, without the internal reference ("[SC-SOFA] ...")
            'name': product.with_context(display_default_code=False).display_name,
            'url': product.website_url,
            'image_url': '/web/image/product.template/%s/image_512' % product.id,
            'price': '' if hide_price else format_amount(request.env, info['price'], currency),
            'compare_price': compare_price,
            'discount': discount,
            'hide_price': hide_price,
            # hidden by "login to see price": the card offers sign-in, as the product page does
            'price_login': bool(hide_price and website.login_see_price and request.env.user._is_public()),
            'in_stock': in_stock,
            'needs_options': needs_options,
            'can_add_to_cart': can_add,
            'has_ar': product.scita_has_ar,
            'ar': product._scita_ar_urls(),
            # for the 3D viewer
            'category': product.public_categ_ids.filtered(
                lambda categ: categ.website_id in (website, website.browse()))[:1].name or '',
            'dimensions': self._ar_dimensions(product),
        }

    def _ar_dimensions(self, product):
        """[{label, value}] of the 3D model's size in cm, left out when 0 (photo cut-outs are flat)."""
        if not product.scita_ar_dimensions:
            return []
        width, height, depth = product.scita_ar_dimensions.split(',')
        labels = {'width': request.env._('Width'), 'depth': request.env._('Depth'), 'height': request.env._('Height')}
        values = {'width': width, 'depth': depth, 'height': height}
        return [{'label': labels[key], 'value': request.env._('%s cm', values[key])}
                for key in ('width', 'depth', 'height') if float(values[key]) > 0]

    # not readonly: the pricelist price computation may write the website's session pricelist
    @http.route('/scita/hotspots/products', type='jsonrpc', auth='public', website=True)
    def hotspot_products(self, product_ids=None, **kwargs):
        """Cards of the products of the hotspots of a page, keyed by product.template id.

        Products the visitor can't see (unpublished, other website, deleted) are left out: the
        page then hides their hotspots."""
        ids = []
        for raw in product_ids if isinstance(product_ids, list) else []:
            if isinstance(raw, bool):
                continue
            try:
                value = int(raw)
            except (TypeError, ValueError, OverflowError):
                continue
            if 0 < value < 2**31 and value not in ids:
                ids.append(value)
        ids = ids[:MAX_PAGE_HOTSPOT_PRODUCTS]
        if not ids:
            return {'products': {}}
        return {'products': {str(p.id): self._card(p) for p in self._visible_products(ids)}}
