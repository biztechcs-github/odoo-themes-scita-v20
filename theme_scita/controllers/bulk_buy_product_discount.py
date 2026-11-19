# # -*- coding: utf-8 -*-
# # Part of AppJetty. See LICENSE file for full copyright and licensing details.

from odoo import http
from odoo.http import request
from odoo.tools import format_amount
from odoo.addons.website_sale.controllers.main import WebsiteSale
from odoo.addons.website_sale.controllers.variant import WebsiteSaleVariantController
from odoo.addons.website_sale.controllers.product_configurator import WebsiteSaleProductConfiguratorController


class WebsiteSaleExtended(WebsiteSale):

    @http.route()
    def product(self, product, **kwargs):
        response = super().product(product, **kwargs)
        if getattr(response, 'qcontext', None) is not None:
            response.qcontext['website_sale_order'] = request.cart
        return response


class ScitaBulkVariantController(WebsiteSaleVariantController):

    @http.route(
        '/website_sale/get_combination_info',
        type='jsonrpc',
        auth='public',
        methods=['POST'],
        website=True,
        readonly=True,
    )
    def get_combination_info_website(self, product_template_id, product_id, combination, add_qty, uom_id=None, **kwargs):
        combination_info = super().get_combination_info_website(
            product_template_id=product_template_id,
            product_id=product_id,
            combination=combination,
            add_qty=add_qty,
            uom_id=uom_id,
            **kwargs
        )

        bulk_prices = []
        pricelist = request.pricelist

        if pricelist and product_template_id:
            tmpl_id = int(product_template_id)
            # Use the server-resolved variant ID, not the stale one from the JS hidden input
            variant_id = combination_info.get('product_id')

            variant = request.env['product.product'].browse(variant_id or []).exists()
            template = request.env['product.template'].browse(tmpl_id).exists()
            # unit price at each tier quantity, whatever the rule type (fixed, %, formula)
            bulk_prices = template._scita_bulk_prices(variant, pricelist) if template else []

            # for what is selected: attribute extras (no_variant values) and unit of measure.
            # combination_info['price'] is Odoo's own for add_qty, so already the right tier.
            ptavs = request.env['product.template.attribute.value'].browse(combination)
            for tier in bulk_prices:
                tier['fixed_price'] = template._get_combination_info(
                    combination=ptavs, product_id=variant.id, add_qty=tier['min_quantity'],
                    uom_id=uom_id, pricelist=pricelist)['price']
                # as the page shows prices: currency symbol, the visitor's number format
                tier['price_text'] = format_amount(request.env, tier['fixed_price'], pricelist.currency_id)

        combination_info['bulk_prices'] = bulk_prices

        # Prices hidden by Scita (request quote, prices hidden on the website, or "login to
        # see price" for visitors) are only left out of the page templates; this JSON is what
        # the product page fetches on every variant change, so leave them out here too.
        website = request.env.website
        template = request.env['product.template'].browse(int(product_template_id or 0)).exists()
        if (
            not website.website_show_price
            or website.website_hide_price
            or (template and template._sct_price_hidden())
            or (website.login_see_price and request.env.user._is_public())
        ):
            combination_info.update({
                'price': 0,
                'list_price': 0,
                'raw_pricelist_price': 0,
                'compare_list_price': 0,
                'has_discounted_price': False,
                'hide_price': True,
                'bulk_prices': [],
            })
        return combination_info


class ScitaBulkConfiguratorController(WebsiteSaleProductConfiguratorController):
    """Explicitly override the two product-configurator dialog routes so Odoo
    registers THIS class as the route handler.  Without @http.route the parent
    class keeps handling the requests and our _get_basic_product_information
    override is never reached.  The prices are Odoo's: it prices the quantity with
    the selected attribute extras and unit of measure, so bulk tiers apply."""

    def _get_basic_product_information(self, product_or_template, *args, **kwargs):
        info = super()._get_basic_product_information(product_or_template, *args, **kwargs)
        template = product_or_template.product_tmpl_id if product_or_template._name == 'product.product' \
            else product_or_template
        if template._sct_price_hidden():
            info['price'] = 0
            info.pop('strikethrough_price', None)
        return info

    @http.route(
        '/website_sale/product_configurator/get_values',
        type='jsonrpc',
        auth='public',
        website=True,
        readonly=True,
    )
    def website_sale_product_configurator_get_values(self, *args, **kwargs):
        return super().website_sale_product_configurator_get_values(*args, **kwargs)

    @http.route(
        '/website_sale/product_configurator/update_combination',
        type='jsonrpc',
        auth='public',
        methods=['POST'],
        website=True,
        readonly=True,
    )
    def website_sale_product_configurator_update_combination(self, *args, **kwargs):
        return super().website_sale_product_configurator_update_combination(*args, **kwargs)
