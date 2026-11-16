from datetime import timedelta

from odoo import api, fields, models

# Usage rows hold hashed visitor identifiers: kept long enough to look at the costs, not forever
RETENTION_DAYS = 90


class ScitaAiUsage(models.Model):
    """Daily AI usage per website, feature and visitor: rate limiting + cost visibility."""
    _name = 'scita.ai.usage'
    _description = 'Scita AI Usage'
    _order = 'date desc, id desc'

    date = fields.Date(required=True, index=True, default=fields.Date.context_today)
    website_id = fields.Many2one('website', required=True, index=True, ondelete='cascade')
    feature = fields.Selection([
        ('assistant', 'Shopping Assistant'),
        ('visual_search', 'Visual Search'),
        ('compare', 'Product Comparison'),
        ('price_alert', 'Price Alert Sign-ups'),
    ], required=True, index=True)
    visitor_key = fields.Char(required=True, index=True,
                              help='Hashed session identifier, or "ip:" + hashed client IP')
    action_count = fields.Integer(
        'Uses', default=0,
        help='Assistant messages, photo searches or comparisons: what the daily allowances count')
    request_count = fields.Integer(
        'AI Requests', default=0,
        help='Calls to the AI provider (an assistant message can take a few)')
    input_tokens = fields.Integer(default=0)
    output_tokens = fields.Integer(default=0)

    _unique_usage = models.UniqueIndex('(date, website_id, feature, visitor_key)')

    @api.autovacuum
    def _gc_old_usage(self):
        self.sudo().search([('date', '<', fields.Date.context_today(self) - timedelta(days=RETENTION_DAYS))]).unlink()
