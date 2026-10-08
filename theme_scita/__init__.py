# -*- coding: utf-8 -*-
# Part of AppJetty. See LICENSE file for full copyright and licensing details.

from . import models
from . import controllers


def uninstall_hook(env):
    """Unload the theme from every website still using it.

    Odoo does not unload a theme when its module is uninstalled from Apps:
    the theme.ir.asset templates are deleted but their per-website ir.asset
    copies stay (theme_template_id is only set to NULL). They point at
    /theme_scita/static/... which the asset loader refuses for a non-installed
    addon, so every frontend page answered 500 after uninstalling Scita.
    """
    Module = env['ir.module.module']
    for website in env['website'].search([('theme_id.name', '=', 'theme_scita')]):
        Module._theme_remove(website)
