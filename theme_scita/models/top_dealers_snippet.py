# -*- coding: utf-8 -*-
# Part of AppJetty. See LICENSE file for full copyright and licensing details.

from odoo import api, fields, models


class TopDealersConfiguration(models.Model):
    _name = 'top.dealers.configuration'
    _description = 'Top Dealers Snippet Configuration'
    _order = "sequence asc"

    name = fields.Char(string="Name", help="Name", required=True, translate=True)
    active = fields.Boolean(string="Active", default=True)
    vendor_ids = fields.Many2many("res.partner", "top_dealer_res_partner_rel", "dealer_id", "partner_id",
                                  string="Vendors")
    sequence = fields.Integer(string="Sequence", default=1)

    @api.model_create_multi
    def create(self, vals_list):
        records = super().create(vals_list)
        records._scita_update_vendor_product_count()
        return records

    def write(self, vals):
        res = super().write(vals)
        if 'vendor_ids' in vals:
            self._scita_update_vendor_product_count()
        return res

    def _scita_update_vendor_product_count(self):
        for vendor in self.vendor_ids.sudo():
            vendor.product_count = self.env['product.template'].search_count(
                [('seller_ids.partner_id', 'child_of', vendor.id)])
