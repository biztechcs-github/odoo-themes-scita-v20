from datetime import timedelta

from odoo import api, fields, models


class ScitaCompareCache(models.Model):
    """Cached AI comparison explanations (same products, language, pricelist and
    product versions => same answer), to avoid paying twice for identical requests."""
    _name = 'scita.compare.cache'
    _description = 'Scita AI Comparison Cache'

    key = fields.Char(required=True, index=True)
    website_id = fields.Many2one('website', required=True, ondelete='cascade')
    result = fields.Text(required=True, help='JSON explanation returned to the shop')

    _unique_key = models.UniqueIndex('(key, website_id)')

    @api.autovacuum
    def _gc_old_entries(self):
        self.search([('create_date', '<', fields.Datetime.now() - timedelta(days=30))]).unlink()
