from odoo import fields, models
from odoo.fields import Domain

MAX_SUGGESTIONS = 3
FALLBACK_CANDIDATES = 20


class Website(models.Model):
    _inherit = 'website'

    def _scita_free_shipping_carriers(self, order):
        """Published delivery methods of the order's company offering free shipping over an amount.

        Like the checkout, keep only the methods available for the order's address. When the
        shopper has no address yet (anonymous cart), keep the methods that deliver to the
        visitor's country (GeoIP); without a known country, the methods with no country
        restriction (if there is none, every method).
        """
        Carrier = self.env['delivery.carrier'].sudo()
        carriers = Carrier.search([
            ('is_published', '=', True),
            ('website_id', 'in', [False, self.id]),
            ('free_over', '=', True),
            # base_on_rule prices ignore free_over (see delivery.carrier.rate_shipment)
            ('delivery_type', '!=', 'base_on_rule'),
            *Carrier._check_company_domain(order.company_id),
        ])
        shipping_partner = order.partner_shipping_id
        public_partner = self.sudo().user_id.partner_id
        has_address = shipping_partner and shipping_partner != public_partner and shipping_partner.country_id
        if has_address:
            return carriers.filtered(lambda c: c._is_available_for_order(order))
        country_code = self._get_geoip_country_code()
        if country_code:
            return carriers.filtered(lambda c: not c.country_ids or country_code in c.country_ids.mapped('code'))
        return carriers.filtered(lambda c: not c.country_ids) or carriers

    def _scita_free_shipping_info(self, order):
        """Progress towards free delivery for `order`, in the order's currency.

        Mirrors delivery.carrier.rate_shipment: shipping is free when
        order._compute_amount_total_without_delivery(), converted to the carrier's company
        currency, reaches carrier.amount.
        """
        self.ensure_one()
        info = {'show': False}
        if not self.scita_free_shipping_bar_enabled or not order or not order.website_order_line:
            return info
        if self._scita_hide_order_prices(order):
            # Theme Scita hides this cart's prices: the amounts would reveal them
            return info
        carriers = self._scita_free_shipping_carriers(order)
        if not carriers:
            return info
        # thresholds expressed in the order (pricelist) currency
        thresholds = [c._compute_currency(order, c.amount, 'company_to_pricelist') for c in carriers]
        threshold = min(thresholds)
        currency = order.currency_id
        current = order._compute_amount_total_without_delivery()
        remaining = max(currency.round(threshold - current), 0.0)
        reached = currency.compare_amounts(current, threshold) >= 0
        progress = 100.0 if reached or not threshold else max(0.0, min(100.0, current / threshold * 100.0))
        info.update({
            'show': True,
            'reached': reached,
            'threshold': threshold,
            'current': current,
            'remaining': 0.0 if reached else remaining,
            'progress': round(progress, 1),
            'currency': currency,
            'suggestions': [] if reached else self._scita_free_shipping_suggestions(order, remaining),
        })
        return info

    def _scita_free_shipping_price(self, tmpl, order):
        """Unit price shown to this cart's shopper (pricelist + fiscal position + tax display)."""
        return tmpl.with_context(website_id=self.id)._get_combination_info(
            product_id=tmpl.product_variant_id.id,
            pricelist=order.pricelist_id,
            fiscal_position=order.fiscal_position_id,
        )['price']

    def _scita_free_shipping_suggestions(self, order, remaining, limit=MAX_SUGGESTIONS):
        """Products that close the gap to free delivery.

        First the optional / accessory / alternative products of the cart items priced at least
        `remaining` (the cheapest such first), then other published products the same way, best
        sellers first; finally, if nothing is expensive enough, the most expensive cart-related
        product (it still gets the shopper closer).
        """
        self.ensure_one()
        in_cart = order.website_order_line.product_id.product_tmpl_id
        related = (
            in_cart.optional_product_ids
            | in_cart.accessory_product_ids.product_tmpl_id
            | in_cart.alternative_product_ids
        ) - in_cart
        sellable = Domain.AND([
            [('sale_ok', '=', True), ('is_published', '=', True), ('type', '!=', 'combo'),
             ('website_hide_price', '=', False)],  # "Request a Quote" products have no price to show
            self.website_domain(),
            # products of another company can't be added to this cart
            [('company_id', 'in', [False, (order.company_id or self.company_id).id])],
        ])
        Template = self.env['product.template'].sudo()
        related = Template.browse(related.ids).filtered_domain(sellable)

        def priced(templates):
            # sold-out products (tracked stock, no backorders) can't close the gap
            return [(tmpl, self._scita_free_shipping_price(tmpl, order)) for tmpl in templates
                    if not tmpl.product_variant_id._is_sold_out()]

        currency = order.currency_id
        related_priced = priced(related)
        chosen = sorted([p for p in related_priced if currency.compare_amounts(p[1], remaining) >= 0],
                        key=lambda p: p[1])[:limit]
        if len(chosen) < limit:
            # only products whose catalogue price can close the gap (half of it, to allow for
            # taxes and pricelist discounts), cheapest first: a few price computations per request
            company = order.company_id or self.company_id
            min_list_price = currency._convert(remaining, company.currency_id, company,
                                               fields.Date.context_today(self)) / 2
            others = Template.search(
                Domain.AND([sellable, [('id', 'not in', (in_cart | related).ids),
                                       ('list_price', '>=', min_list_price)]]),
                limit=FALLBACK_CANDIDATES, order='list_price, website_sequence, id')
            others_priced = [p for p in priced(others) if currency.compare_amounts(p[1], remaining) >= 0]
            sold = {tmpl.id: tmpl.sales_count for tmpl, _price in others_priced}
            # closest above the gap first; best sellers break ties between similar prices
            others_priced.sort(key=lambda p: (round(p[1] - remaining, 0), -sold.get(p[0].id, 0)))
            chosen += others_priced[:limit - len(chosen)]
        if not chosen and related_priced:
            chosen = [max(related_priced, key=lambda p: p[1])]
        return [{
            'product_tmpl': tmpl,
            'product_id': tmpl.product_variant_id.id,
            'price': price,
            # products with several variants/custom values must be configured on their page
            'direct_add': tmpl.product_variant_count == 1 and not tmpl.has_configurable_attributes,
        } for tmpl, price in chosen]
