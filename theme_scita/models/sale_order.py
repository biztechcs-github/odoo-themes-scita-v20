# -*- coding: utf-8 -*-
# Part of AppJetty. See LICENSE file for full copyright and licensing details.

import math

from odoo import models


class SaleOrder(models.Model):
    _inherit = 'sale.order'

    def _is_cart_ready_for_checkout(self):
        """Request Quote / login to see price: the customer can't see the prices, so the
        cart can't go through checkout. Every checkout step (address, delivery, payment and
        the payment transaction) validates the cart through this method, and redirects to
        the cart, where Scita shows why (sct_hide_checkout_buttons)."""
        self.ensure_one()
        if self.website_id and self.website_id._sct_hide_order_prices(self):
            return False
        return super()._is_cart_ready_for_checkout()

    def _get_order_tracking_info(self):
        """The cart page prints this: no order total while its prices are hidden."""
        tracking_info = super()._get_order_tracking_info()
        if self.website_id and self.website_id._sct_hide_order_prices(self):
            tracking_info.pop('value', None)
        return tracking_info

    def _verify_updated_quantity(self, order_line, product_id, new_qty, uom_id, **kwargs):
        """Cart routes take any number: without the "Decimal Qty" setting, whole units only
        (0.01 of a sofa was accepted). Every route adding or changing a line comes through here."""
        website = self.website_id
        if website and website._scita_theme_active() and not website.shop_qty:
            new_qty = math.floor(new_qty) if math.isfinite(new_qty) else 0
        return super()._verify_updated_quantity(order_line, product_id, new_qty, uom_id, **kwargs)
