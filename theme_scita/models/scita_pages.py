# -*- coding: utf-8 -*-
"""Scita's extra pages (/extra-pages, /contact-us-1..5, /help, /coming-soon-page, ...) are
generic website.page records (website_id empty), so Odoo would serve them, list them in
sitemap.xml and show their menus on every website, also on websites using another theme.
They are kept as they are (no data change, so pages already edited keep their content)
and only hidden on websites that don't use Theme Scita."""
from odoo import api, models

# menus Scita adds under the main menu (copied by Odoo into every website's menu)
SCITA_MENU_URLS = ('/extra-pages', '/allcategories')


class Website(models.Model):
    _inherit = 'website'

    def _scita_theme_active(self):
        self.ensure_one()
        # sudo: visitors may not read ir.module.module (sitemap.xml answered 403 without it)
        return self.sudo().theme_id.name == 'theme_scita'

    @api.model
    @api.ormcache()
    def _scita_generic_page_ids(self):
        """Ids of the generic pages created by theme_scita's data files."""
        return frozenset(self.env['ir.model.data'].sudo().search([
            ('module', '=', 'theme_scita'), ('model', '=', 'website.page'),
        ]).mapped('res_id'))

    def _get_website_pages(self, domain=None, order='name', limit=None):
        # sitemap.xml, link dialogs and the page search of websites without Scita
        pages = super()._get_website_pages(domain=domain, order=order, limit=limit)
        website = self.env.website
        if website and not website._scita_theme_active():
            scita_ids = self._scita_generic_page_ids()
            pages = pages.filtered(lambda page: page.id not in scita_ids)
        return pages


class WebsitePage(models.Model):
    _inherit = 'website.page'

    def _get_page_info(self, request):
        info = super()._get_page_info(request)
        website = self.env.website
        if (info and not info['website_id'] and website and not website._scita_theme_active()
                and info['id'] in self.env['website']._scita_generic_page_ids()):
            return None  # 404, as if Scita was not installed
        return info


class WebsiteMenu(models.Model):
    _inherit = 'website.menu'

    def _compute_visible(self):
        super()._compute_visible()
        for menu in self:
            if (menu.is_visible and menu.url in SCITA_MENU_URLS and menu.website_id
                    and not menu.website_id._scita_theme_active()):
                menu.is_visible = False
