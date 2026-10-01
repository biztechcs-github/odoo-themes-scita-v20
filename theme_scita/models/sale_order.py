# -*- coding: utf-8 -*-
# Part of AppJetty. See LICENSE file for full copyright and licensing details.

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
