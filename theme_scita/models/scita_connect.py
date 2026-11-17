# -*- coding: utf-8 -*-
# Part of AppJetty. See LICENSE file for full copyright and licensing details.

from odoo import fields, models


class ScitaConnectItem(models.Model):
    """A card of the Quick Contact Panel (Website > Configuration > Quick Contact Cards)."""
    _name = 'scita.connect.item'
    _description = 'Quick Contact Card'
    _order = 'sequence, id'

    name = fields.Char('Title', required=True, translate=True)
    description = fields.Char('Subtitle', translate=True,
                              help="Shown under the title, e.g. a phone number, an email address or a short text.")
    url = fields.Char('Link', required=True,
                      help="Page or address opened by the card, e.g. /contactus, tel:+1 555 0100, "
                           "mailto:info@example.com, https://maps.google.com/?q=...")
    icon = fields.Selection([
        ('quote', 'Quote'),
        ('phone', 'Phone'),
        ('email', 'Email'),
        ('location', 'Location'),
        ('buy', 'Buy / Cart'),
        ('play', 'Play / Demo'),
        ('chat', 'Chat'),
        ('whatsapp', 'WhatsApp'),
        ('calendar', 'Calendar'),
        ('link', 'Link'),
    ], default='link', required=True)
    new_window = fields.Boolean('Open in New Tab')
    sequence = fields.Integer(default=10)
    active = fields.Boolean(default=True)
    website_id = fields.Many2one('website', ondelete='cascade', index=True,
                                 help="Leave empty to show the card on every website.")


class Website(models.Model):
    _inherit = 'website'

    scita_connect_enabled = fields.Boolean('Quick Contact Panel')
    scita_connect_title = fields.Char('Quick Contact Panel Title', translate=True, default='Get in Touch')

    def _scita_connect_items(self):
        """Cards of the Quick Contact Panel of this website (none when the feature is off)."""
        self.ensure_one()
        if not self.scita_connect_enabled:
            return self.env['scita.connect.item']
        return self.env['scita.connect.item'].sudo().search([('website_id', 'in', (False, self.id))])
