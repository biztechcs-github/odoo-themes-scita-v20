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
        help='Model identifier sent to the provider, e.g. claude-haiku-5-5.')
    # --- what each visitor may use per day (0 = unlimited) ---
    scita_ai_guest_assistant_limit = fields.Integer(
        'Assistant messages per guest per day', default=10,
        help='Visitors who are not logged in. A conversation usually takes 3 to 8 messages.')
    scita_ai_user_assistant_limit = fields.Integer(
        'Assistant messages per customer per day', default=30,
        help='Logged-in customers, counted per account across their devices.')
    scita_ai_guest_action_limit = fields.Integer(
        'Photo searches / comparisons per guest per day', default=5,
        help='Each of the two features separately. A comparison already explained for the same '
             'products is reused and does not count.')
    scita_ai_user_action_limit = fields.Integer(
        'Photo searches / comparisons per customer per day', default=20)
    scita_ai_login_required = fields.Boolean(
        'AI for logged-in customers only',
        help='Hide the AI features from visitors who are not logged in.')
    scita_ai_ip_daily_limit = fields.Integer(
        'Uses per IP address per day', default=100,
        help='Guests, per feature and network address, so clearing cookies does not reset their '
             'allowance. Keep it well above the per-guest limits: shoppers of one office or '
             'mobile network share an address.')
    # --- what the website may spend per day (0 = unlimited) ---
    scita_ai_daily_token_budget = fields.Integer(
        'AI tokens per website per day', default=2000000,
        help='What your AI provider bills you for. Past 80% only logged-in customers keep the AI '
             'features (you get an email), past 100% they are paused until tomorrow.')
    scita_ai_budget_alert_date = fields.Date(copy=False, groups='base.group_system')
    scita_ai_site_daily_limit = fields.Integer(
        'AI requests per website per day', default=2000,
        help='Hard cap on the number of calls to the AI provider per day (all features and visitors).')

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

    def write(self, vals):
        res = super().write(vals)
        # guests get website pages from Odoo's page cache (an hour): a setting that changes
        # what the pages show (AI features on/off, "logged-in only", the key...) would only
        # reach them that much later
        if any(key.startswith('scita_') and key != 'scita_ai_budget_alert_date' for key in vals):
            self.env.transaction.invalidate_ormcache('templates')
        return res

    def _scita_ai_ready(self):
        """True when the AI features can run for the current visitor: a key is set for this
        website, and they are logged in if the website keeps AI for customers. (Checked here
        rather than in the templates: website-specific copies of the templates made by the
        editor keep their old conditions.)"""
        self.ensure_one()
        if self.scita_ai_login_required and self.env.user._is_public():
            return False
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
        if not product:
            return False
        product = product.sudo()
        # quote_request comes from Theme Scita
        return bool(product.website_hide_price or ('quote_request' in product._fields and product.quote_request))

    def _scita_hide_order_prices(self, order):
        """Cart amounts are hidden as soon as one line's price is (the total would reveal it)."""
        self.ensure_one()
        return self._scita_hide_price() or any(
            self._scita_hide_price(product) for product in order.sudo().website_order_line.product_id)
