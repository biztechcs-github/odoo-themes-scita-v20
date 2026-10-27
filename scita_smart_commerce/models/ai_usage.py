from odoo import fields, models


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
