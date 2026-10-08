from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .ai_providers.anthropic_provider import DEFAULT_MODEL as ANTHROPIC_DEFAULT
from .ai_providers.gemini_provider import DEFAULT_MODEL as GEMINI_DEFAULT
from .ai_providers.openai_provider import DEFAULT_MODEL as OPENAI_DEFAULT

DEFAULT_MODELS = {'anthropic': ANTHROPIC_DEFAULT, 'openai': OPENAI_DEFAULT, 'gemini': GEMINI_DEFAULT}


class Website(models.Model):
    _inherit = 'website'

    # --- AI provider (shared by the assistant, visual search and comparison) ---
    scita_ai_provider = fields.Selection(
        [('anthropic', 'Anthropic Claude'), ('openai', 'OpenAI'), ('gemini', 'Google Gemini')],
        string='AI Provider', default='anthropic', required=True)
    scita_ai_api_key = fields.Char('AI API Key', groups='base.group_system')
    scita_ai_model = fields.Char(
        'AI Model', default=ANTHROPIC_DEFAULT,
        help='Model identifier sent to the provider, e.g. claude-opus-5-5.')
    scita_ai_daily_limit = fields.Integer(
        'AI requests per visitor per day', default=40,
        help='Protects your AI budget: each visitor (session) can make at most this many '
             'AI requests per feature per day. 0 means unlimited.')
    scita_ai_ip_daily_limit = fields.Integer(
        'AI requests per IP address per day', default=200,
        help='Same limit per network address, so clearing cookies does not reset it. Keep it higher '
             'than the per-visitor limit: shoppers of one office or mobile network share an address. '
             '0 means unlimited.')
    scita_ai_site_daily_limit = fields.Integer(
        'AI requests per website per day', default=2000,
        help='Hard cap on all AI requests of this website per day (all features and visitors). '
             '0 means unlimited.')

    # --- feature switches (all off until the shop owner turns them on) ---
    scita_assistant_enabled = fields.Boolean('AI Shopping Assistant')
    scita_assistant_name = fields.Char('Assistant Name', default='Shopping Assistant', translate=True)
    scita_assistant_welcome = fields.Text(
        'Assistant Welcome Message', translate=True,
        default='Hi! Tell me what you are looking for and I will find it in our catalogue.')
    scita_visual_search_enabled = fields.Boolean('AI Visual Search')
    scita_visual_search_match = fields.Selection([
        ('name', 'Product name'),
        ('name_description', 'Name and sales description'),
        ('all', 'Name, description, tags and attributes'),
    ], string='Match Photos On', default='all', required=True,
        help='Which product information the words found in the photo (type, colour, material, style) '
             'are compared with. Categories are always used.')
    scita_visual_search_scope = fields.Selection([
        ('category', 'Same category only'),
        ('kind', 'Same kind first'),
        ('similar', 'Anything similar'),
    ], string='Results', default='kind', required=True,
        help='Same category only: a chair photo shows chairs and nothing else. '
             'Same kind first: products of the photo\'s kind; other similar products only when there are none. '
             'Anything similar: every product sharing a colour, material or style, best matches first.')
    scita_visual_search_exclude_services = fields.Boolean(
        'Leave Out Services', default=True,
        help='Services (assembly, delivery, warranty...) never look like a photo: do not list them.')
    scita_visual_search_limit = fields.Integer('Number of Results', default=12)
    scita_compare_ai_enabled = fields.Boolean('AI Product Comparison')
    scita_price_alert_enabled = fields.Boolean('Price Drop Alerts')
    scita_price_alert_default_type = fields.Selection([
        ('any', 'Any price drop'),
        ('percent', 'A percentage off'),
        ('target', 'A price of their own'),
    ], string='Preselected Choice', default='percent', required=True,
        help='What the "Notify me when the price drops" form proposes first. Shoppers can still pick another option.')
    scita_price_alert_default_percent = fields.Integer(
        'Preselected Discount (%)', default=10,
        help='Discount proposed in the form for "a percentage off" (and used to suggest a price of their own).')
    scita_price_alert_expiry_days = fields.Integer(
        'Alert Lifetime (days)', default=180,
        help='A waiting alert stops after this many days. 0 means it never expires.')
    scita_price_alert_skip_sold_out = fields.Boolean(
        'Wait While Sold Out', default=True,
        help='Do not email a price drop while the product is sold out: the shopper is emailed '
             'once it is back in stock, if the price is still low enough.')
    scita_price_alert_retention_days = fields.Integer(
        'Keep Closed Alerts (days)', default=365,
        help='Notified, expired and stopped alerts (with the shopper\'s email) are deleted after this '
             'many days without change. 0 keeps them.')
    scita_price_alert_guest_confirm = fields.Boolean(
        'Guests Confirm by Email', default=True,
        help='Visitors who are not signed in confirm their alert from an email first (double opt-in), '
             'so nobody can subscribe someone else. Recommended (GDPR).')
    scita_free_shipping_bar_enabled = fields.Boolean('Free Shipping Progress Bar')

    @api.constrains('scita_visual_search_limit')
    def _check_scita_visual_search_limit(self):
        for website in self:
            if not 1 <= website.scita_visual_search_limit <= 48:
                raise ValidationError(self.env._('Visual search shows between 1 and 48 results.'))

    @api.constrains('scita_price_alert_default_percent', 'scita_price_alert_expiry_days', 'scita_price_alert_retention_days')
    def _check_scita_price_alert_settings(self):
        for website in self:
            if not 1 <= website.scita_price_alert_default_percent <= 90:
                raise ValidationError(self.env._('The preselected price alert discount must be between 1% and 90%.'))
            if website.scita_price_alert_expiry_days < 0 or website.scita_price_alert_retention_days < 0:
                raise ValidationError(self.env._('Price alert lifetimes cannot be negative.'))

    @api.onchange('scita_ai_provider')
    def _onchange_scita_ai_provider(self):
        self.scita_ai_model = DEFAULT_MODELS.get(self.scita_ai_provider)

    def _scita_ai_ready(self):
        """True when an AI feature can run: a key is set for this website."""
        self.ensure_one()
        return bool(self.sudo().scita_ai_api_key)

    def _scita_hide_price(self, product=None):
        """Theme Scita's hide-price rule for the current visitor: prices hidden on the whole
        website, "login to see price" for anonymous visitors, or a "Request a Quote" product
        (product.template or product.product). Hidden prices also mean no add to cart."""
        self.ensure_one()
        if not self.website_show_price:
            return True
        if self.login_see_price and self.env.user._is_public():
            return True
        return bool(product and product.sudo().website_hide_price)

    def _scita_hide_order_prices(self, order):
        """Cart amounts are hidden as soon as one line's price is (the total would reveal it)."""
        self.ensure_one()
        return self._scita_hide_price() or any(
            order.sudo().website_order_line.product_id.mapped('website_hide_price'))
