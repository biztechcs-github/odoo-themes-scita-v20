import importlib.util

from odoo import api, fields, models

from .ai_providers import PYTHON_PACKAGES

from .website import DEFAULT_MODELS


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    scita_ai_provider = fields.Selection(related='website_id.scita_ai_provider', readonly=False)
    scita_ai_api_key = fields.Char(related='website_id.scita_ai_api_key', readonly=False, groups='base.group_system')
    scita_ai_model = fields.Char(related='website_id.scita_ai_model', readonly=False)
    scita_ai_missing_package = fields.Char(compute='_compute_scita_ai_missing_package')
    scita_ai_daily_limit = fields.Integer(related='website_id.scita_ai_daily_limit', readonly=False)
    scita_ai_ip_daily_limit = fields.Integer(related='website_id.scita_ai_ip_daily_limit', readonly=False)
    scita_ai_site_daily_limit = fields.Integer(related='website_id.scita_ai_site_daily_limit', readonly=False)
    scita_assistant_enabled = fields.Boolean(related='website_id.scita_assistant_enabled', readonly=False)
    scita_assistant_name = fields.Char(related='website_id.scita_assistant_name', readonly=False)
    scita_assistant_welcome = fields.Text(related='website_id.scita_assistant_welcome', readonly=False)
    scita_visual_search_enabled = fields.Boolean(related='website_id.scita_visual_search_enabled', readonly=False)
    scita_visual_search_match = fields.Selection(related='website_id.scita_visual_search_match', readonly=False)
    scita_visual_search_scope = fields.Selection(related='website_id.scita_visual_search_scope', readonly=False)
    scita_visual_search_exclude_services = fields.Boolean(related='website_id.scita_visual_search_exclude_services', readonly=False)
    scita_visual_search_limit = fields.Integer(related='website_id.scita_visual_search_limit', readonly=False)
    scita_compare_ai_enabled = fields.Boolean(related='website_id.scita_compare_ai_enabled', readonly=False)
    scita_price_alert_enabled = fields.Boolean(related='website_id.scita_price_alert_enabled', readonly=False)
    scita_price_alert_default_type = fields.Selection(related='website_id.scita_price_alert_default_type', readonly=False)
    scita_price_alert_default_percent = fields.Integer(related='website_id.scita_price_alert_default_percent', readonly=False)
    scita_price_alert_expiry_days = fields.Integer(related='website_id.scita_price_alert_expiry_days', readonly=False)
    scita_price_alert_skip_sold_out = fields.Boolean(related='website_id.scita_price_alert_skip_sold_out', readonly=False)
    scita_price_alert_guest_confirm = fields.Boolean(related='website_id.scita_price_alert_guest_confirm', readonly=False)
    scita_price_alert_retention_days = fields.Integer(related='website_id.scita_price_alert_retention_days', readonly=False)
    scita_free_shipping_bar_enabled = fields.Boolean(related='website_id.scita_free_shipping_bar_enabled', readonly=False)

    @api.depends('scita_ai_provider')
    def _compute_scita_ai_missing_package(self):
        # the provider's SDK is optional: say so here instead of failing on the first shopper request
        for settings in self:
            package = PYTHON_PACKAGES.get(settings.scita_ai_provider)
            settings.scita_ai_missing_package = package if package and not importlib.util.find_spec(package) else False

    @api.onchange('scita_ai_provider')
    def _onchange_scita_ai_provider(self):
        if self.scita_ai_provider:
            self.scita_ai_model = DEFAULT_MODELS.get(self.scita_ai_provider)
