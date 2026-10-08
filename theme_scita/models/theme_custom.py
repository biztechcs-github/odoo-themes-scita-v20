# -*- coding: utf-8 -*-
# Part of AppJetty. See LICENSE file for full copyright and licensing details.


from odoo import models, api


class ThemeNew(models.AbstractModel):
    _inherit = 'theme.utils'

    def _theme_scita_post_copy(self, mod):
        self.disable_view('website_sale.product_add_to_wishlist')
        self.disable_view('website_sale.product_quantity')
        self.disable_view('website_sale.product_buy_now')
        self.disable_view('website_sale.product_comment')
        self.disable_view('website_sale.product_add_to_compare')
        self.disable_view('website_sale.search')
        self.disable_view('website_sale.ecom_show_extra_fields')
        # Product hover style 1 is Scita's default: save it explicitly so the editor's Theme
        # tab shows it as selected instead of an empty "None"
        self.env['website.assets'].make_scss_customization(
            '/website/static/src/scss/options/user_values.scss',
            {'prod-hover-style': "'prod_hover_style_1'"},
        )


# The views each "Scita Header N" item of the editor's header template picker enables
# (static/src/xml/scita_header_option.xml); the editor only shows a header as selected when
# all of them are active.
SCITA_HEADER_COMPANION_VIEWS = {
    'theme_scita.option_header_%d' % number: [
        'theme_scita.scita_header_cart_link',
        'theme_scita.scita_header_wishlist_link',
        'theme_scita.scita_header_search_box_icon',
        'theme_scita.scita_header_mobile',
    ] + (['theme_scita.scita_header_all_category_mobile'] if number >= 3 else [])
    for number in range(1, 6)
}


class IrModuleModule(models.Model):
    _inherit = 'ir.module.module'

    def _theme_load(self, website):
        super()._theme_load(website)
        if 'theme_scita' in self.mapped('name'):
            self._scita_sync_header_companion_views(website)

    def _scita_sync_header_companion_views(self, website):
        """ Keep the icon / mobile views of the selected Scita header active.

        When Odoo gives a header view a website-specific copy (e.g. after header content is
        edited) the next theme update re-creates Scita's views inheriting from it with their
        XML default `active="False"`: the header then shows Odoo's cart / wishlist / search
        icons and the editor's header picker shows "None". Only activates, never deactivates.
        """
        View = self.env['ir.ui.view'].with_context(active_test=False)
        for header_key, companion_keys in SCITA_HEADER_COMPANION_VIEWS.items():
            if View.search_count([
                ('key', '=', header_key), ('website_id', '=', website.id), ('active', '=', True),
            ]):
                View.search([
                    ('key', 'in', companion_keys),
                    ('website_id', '=', website.id),
                    ('active', '=', False),
                ]).write({'active': True})
