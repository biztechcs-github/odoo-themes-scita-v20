from odoo import http
from odoo.http import request

class SimilarProductController(http.Controller):
    @http.route('/get_similar_products', type='jsonrpc', auth='public', methods=['POST'], website=True)
    def get_similar_products_sidebar(self, product_id):
            website = request.env.website
            # prices are in the visitor's pricelist currency (combination info below)
            currency = request.pricelist.currency_id or website.currency_id
            Product = request.env['product.template'].sudo()
            product = Product.browse(product_id)

            if not product.exists():
                return {'error': 'Product not found', 'similar_products': []}

            # only what this website shows: published, and not limited to another website
            similar_products = product.similar_product_ids._scita_on_website().filtered('is_published')
            hide_all = website._sct_hide_line_price(False)
            data = []

            for p in similar_products:
                # the visitor's price (pricelist, taxes) unless Scita hides it for this product
                info = p._get_combination_info(only_template=True)
                hidden = hide_all or p.website_hide_price or p.quote_request
                compare = info['list_price'] if info.get('has_discounted_price') else info.get('compare_list_price')
                data.append({
                    'id': p.id,
                    'name': p.name,
                    'price': None if hidden else info['price'],
                    'image_url': f"/web/image/product.template/{p.id}/image_1920",
                    'product_url': f"/shop/product/{p.id}",
                    'rating_avg': p.rating_avg,
                    'rating_count': p.rating_count,
                    'compare_price': None if hidden else compare,
                    'description_ecommerce':p.description_ecommerce,
                    'sku':p.default_code,
                })

            return {
                'similar_products': data,
                'currency': {
                'symbol': currency.symbol,
                'position': currency.position,
                'decimal_places': currency.decimal_places,
            }
            }
