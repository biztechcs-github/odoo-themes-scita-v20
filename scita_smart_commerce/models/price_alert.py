import logging
import secrets
from datetime import timedelta

from odoo import api, fields, models, tools
from odoo.exceptions import AccessError, ValidationError
from odoo.tools import SQL

_logger = logging.getLogger(__name__)

# Anti-abuse limits for the public "notify me" form
MAX_ACTIVE_ALERTS_PER_EMAIL = 20
# An alert is re-priced at most once per this interval by the hourly cron (a price change
# made in the backend re-checks its alerts right away)
CHECK_INTERVAL = timedelta(minutes=50)
# Unconfirmed sign-ups are deleted after this delay
PENDING_LIFETIME = timedelta(days=7)
OPEN_STATES = ('pending', 'active')
CLOSED_STATES = ('notified', 'expired', 'cancelled')
# "Only N left" in the email below this stock
LOW_STOCK_THRESHOLD = 5
ALERT_TYPES = [
    ('any', 'Any price drop'),
    ('percent', 'Percentage off'),
    ('target', 'Target price'),
]
MIN_DROP_PERCENT, MAX_DROP_PERCENT = 1, 90


class ScitaPriceAlert(models.Model):
    """A shopper asks to be emailed when a product gets cheaper: any drop, a percentage off
    or a price of their own."""
    _name = 'scita.price.alert'
    _description = 'Price Drop Alert'
    _order = 'create_date desc, id desc'
    _rec_name = 'product_tmpl_id'

    email = fields.Char(required=True)
    email_normalized = fields.Char(compute='_compute_email_normalized', store=True, index=True)
    partner_id = fields.Many2one('res.partner', ondelete='set null', index=True)
    product_tmpl_id = fields.Many2one('product.template', string='Product', required=True,
                                      ondelete='cascade', index=True)
    product_id = fields.Many2one('product.product', string='Variant', required=True, ondelete='cascade', index=True,
                                 domain="[('product_tmpl_id', '=', product_tmpl_id)]")
    website_id = fields.Many2one('website', required=True, ondelete='cascade', index=True)
    company_id = fields.Many2one(related='website_id.company_id', store=True, index=True)
    pricelist_id = fields.Many2one('product.pricelist', ondelete='set null', index=True)
    fiscal_position_id = fields.Many2one(
        'account.fiscal.position', ondelete='set null',
        help='Tax mapping of the shopper when they subscribed, so the price is checked the way they see it.')
    currency_id = fields.Many2one('res.currency', required=True)
    lang = fields.Char(help='Language of the notification email')
    alert_type = fields.Selection(ALERT_TYPES, string='Notify When', default='target', required=True)
    drop_percent = fields.Float('Wanted Discount (%)', digits=(16, 0),
                                help='For "Percentage off" alerts: how much cheaper the product must get.')
    target_price = fields.Monetary(required=True, currency_field='currency_id',
                                   help='The shopper is emailed when the price is at or below this amount.')
    price_at_creation = fields.Monetary('Price When Subscribed', currency_field='currency_id', readonly=True)
    last_price = fields.Monetary('Last Checked Price', currency_field='currency_id', readonly=True)
    last_check_date = fields.Datetime(readonly=True, index=True)
    requested_discount = fields.Float(
        'Requested Discount (%)', compute='_compute_requested_discount', store=True, aggregator='avg',
        help='How far below the price at subscription time the shopper wants to buy.')
    state = fields.Selection([
        ('pending', 'Awaiting Confirmation'),
        ('active', 'Waiting'),
        ('notified', 'Notified'),
        ('expired', 'Expired'),
        ('cancelled', 'Cancelled'),
    ], default='active', required=True, index=True)
    notified_date = fields.Datetime(readonly=True)
    expiry_date = fields.Datetime('Expires On', index=True,
                                  help='The alert stops on this date if the price has not dropped by then.')
    access_token = fields.Char(required=True, copy=False, default=lambda self: secrets.token_urlsafe(24),
                               groups='base.group_system')

    _check_target_price = models.Constraint('CHECK (target_price > 0)', 'The target price must be positive.')

    @api.depends('email')
    def _compute_email_normalized(self):
        for alert in self:
            alert.email_normalized = tools.email_normalize(alert.email) or (alert.email or '').strip().lower()

    @api.depends('target_price', 'price_at_creation')
    def _compute_requested_discount(self):
        for alert in self:
            if alert.price_at_creation:
                alert.requested_discount = (alert.price_at_creation - alert.target_price) / alert.price_at_creation * 100
            else:
                alert.requested_discount = 0.0

    @api.constrains('email')
    def _check_email(self):
        for alert in self:
            if not tools.email_normalize(alert.email):
                raise ValidationError(self.env._('Invalid email address: %s', alert.email))

    # ------------------------------------------------------------------ subscription rules

    @api.model
    def _scita_target_for(self, alert_type, price, currency, drop_percent=None, target_price=None):
        """Target price of a new alert from what the shopper chose.

        :return: (target price, error message): one of them is falsy
        """
        _ = self.env._
        if alert_type == 'any':
            # any drop, even by the smallest unit of the currency
            target = currency.round(price - currency.rounding)
        elif alert_type == 'percent':
            try:
                percent = float(drop_percent)
            except (TypeError, ValueError):
                percent = 0
            if not MIN_DROP_PERCENT <= percent <= MAX_DROP_PERCENT:
                return 0, _('Please choose a discount between %(min)s%% and %(max)s%%.',
                            min=MIN_DROP_PERCENT, max=MAX_DROP_PERCENT)
            target = min(currency.round(price * (100 - percent) / 100), currency.round(price - currency.rounding))
        elif alert_type == 'target':
            try:
                target = float(target_price)
            except (TypeError, ValueError):
                return 0, _('Please enter the price you would pay.')
            if target != target or target in (float('inf'), float('-inf')):  # NaN / infinite
                return 0, _('Please enter the price you would pay.')
            target = currency.round(target)
            if target > 0 and currency.compare_amounts(target, price) >= 0:
                return 0, _('Your price must be below the current price (%s).',
                            tools.format_amount(self.env, price, currency))
        else:
            return 0, _('Please choose when we should email you.')
        if target <= 0:
            return 0, _('Please enter a price above zero.')
        return target, False

    @api.model
    def _scita_expiry_date(self, website):
        days = website.sudo().scita_price_alert_expiry_days
        return fields.Datetime.now() + timedelta(days=days) if days > 0 else False

    def _scita_product_name(self):
        """The product as shoppers see it on the website: "Velvet Armchair (Red)", without the
        internal reference ("[SC-ARMCHAIR-RED] ...") that display_name adds."""
        self.ensure_one()
        return self.product_id.with_context(display_default_code=False).display_name or ''

    def _scita_format(self, amount):
        self.ensure_one()
        return tools.format_amount(self.env, amount, self.currency_id, lang_code=self.lang or None)

    def _scita_condition_text(self):
        """When the shopper is emailed, in words ("drops below $1,000.00", ...)."""
        self.ensure_one()
        _ = self.with_context(lang=self.lang or self.env.lang).env._
        if self.alert_type == 'any':
            return _('drops below %s', self._scita_format(self.price_at_creation or self.target_price))
        if self.alert_type == 'percent':
            return _('is at least %(percent)s%% cheaper (%(price)s or less)',
                     percent=int(self.drop_percent), price=self._scita_format(self.target_price))
        return _('reaches %s or less', self._scita_format(self.target_price))

    def _scita_saving(self):
        """(amount saved, % saved) between the subscription price and the last checked one."""
        self.ensure_one()
        if not self.price_at_creation or not self.last_price or self.last_price >= self.price_at_creation:
            return 0.0, 0
        saved = self.price_at_creation - self.last_price
        return saved, int(round(saved / self.price_at_creation * 100))

    def _scita_stock_left(self):
        """Units left when the variant is about to sell out (for the email), else 0."""
        self.ensure_one()
        product = self.product_id.sudo()
        if not product.is_storable or product.allow_out_of_stock_order:
            return 0
        website = self.website_id.sudo()
        qty = int(website.with_context(website_id=website.id)._get_product_available_qty(product))
        return qty if 0 < qty <= LOW_STOCK_THRESHOLD else 0

    # ------------------------------------------------------------------ pricing

    def _scita_compute_price(self):
        """Price the alert's variant as the shopper saw it when subscribing: same website,
        pricelist and tax mapping. Returned in the alert's currency."""
        self.ensure_one()
        tmpl = self.product_tmpl_id.sudo().with_context(website_id=self.website_id.id, lang=self.lang or None)
        pricelist = self.pricelist_id
        if not pricelist:
            # what an anonymous visitor of that website pays (catalog price if no pricelist)
            website = self.website_id.sudo()
            public_pricelist = website.user_id.partner_id.property_product_pricelist
            pricelist = public_pricelist & website.pricelist_ids
        info = tmpl._get_combination_info(
            product_id=self.product_id.id,
            pricelist=pricelist,
            fiscal_position=self.fiscal_position_id.sudo(),
        )
        price, currency = info['price'], info['currency']
        if currency != self.currency_id:
            # the pricelist changed currency since the shopper subscribed
            price = currency._convert(price, self.currency_id, self.company_id or self.env.company,
                                      fields.Date.context_today(self))
        return price, self.currency_id

    def _scita_price_is_hidden(self):
        """Theme Scita hides this product's price from the alert's recipient."""
        self.ensure_one()
        website = self.website_id.sudo()
        partner = self.partner_id.sudo()
        return bool(website.website_hide_price or self.product_tmpl_id.sudo().website_hide_price
                    or (partner and not partner.website_show_price)
                    or (website.login_see_price and not partner.user_ids))

    def _scita_is_sold_out(self):
        self.ensure_one()
        website = self.website_id.sudo()
        return self.product_id.sudo().with_context(website_id=website.id)._is_sold_out()

    # ------------------------------------------------------------------ actions

    def action_cancel(self):
        self.write({'state': 'cancelled'})

    def action_reactivate(self):
        for alert in self:
            alert.write({'state': 'active', 'notified_date': False, 'last_check_date': False,
                         'expiry_date': self._scita_expiry_date(alert.website_id)})

    def action_check_now(self):
        """Backend "Check Now": re-price the selected waiting alerts (all of them when none
        is selected) right away and email the shoppers whose price is reached."""
        if not self.env.user.has_group('sales_team.group_sale_salesman'):
            raise AccessError(self.env._('Only salespeople can check price alerts.'))
        now = fields.Datetime.now()
        domain = [('state', '=', 'active')] + ([('id', 'in', self.ids)] if self else [])
        alerts = self.sudo().search(domain)
        expired = alerts.filtered(lambda a: a.expiry_date and a.expiry_date < now)
        expired.write({'state': 'expired'})
        alerts -= expired
        template = self.env.ref('scita_smart_commerce.mail_template_price_alert', raise_if_not_found=False)
        notified = self.browse()
        for alert in alerts:
            if alert._scita_check_price(template, now):
                notified |= alert
        if notified:
            self._scita_trigger_mail_queue()
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'type': 'success' if notified else 'info',
                'message': self.env._('%(checked)s waiting alerts checked, %(notified)s shoppers emailed.',
                                      checked=len(alerts), notified=len(notified)),
                'next': {'type': 'ir.actions.client', 'tag': 'soft_reload'},
            },
        }

    @api.model
    def _scita_trigger_mail_queue(self):
        """Send the alert emails now, not at the next (hourly) run of the email queue."""
        mail_cron = self.env.ref('mail.ir_cron_mail_scheduler_action', raise_if_not_found=False)
        if mail_cron:
            mail_cron.sudo()._trigger()

    def action_keep_watching(self):
        self._scita_rearm()

    def action_confirm(self):
        self.filtered(lambda a: a.state == 'pending').write({'state': 'active'})

    def _scita_rearm(self):
        """"Keep watching": follow the price again from today's price. A reached target
        price becomes "any further drop"; a percentage stays a percentage of the new price."""
        now = fields.Datetime.now()
        for alert in self:
            price, currency = alert._scita_compute_price()
            alert_type = 'percent' if alert.alert_type == 'percent' else 'any'
            target, error = self._scita_target_for(alert_type, price, currency, alert.drop_percent)
            if error:
                continue  # free product: nothing to watch
            alert.write({
                'state': 'active',
                'alert_type': alert_type,
                'target_price': target,
                'price_at_creation': price,
                'last_price': price,
                'last_check_date': now,
                'notified_date': False,
                'expiry_date': self._scita_expiry_date(alert.website_id),
            })
        return self.filtered(lambda a: a.state == 'active')

    def _scita_url(self, action):
        self.ensure_one()
        base = self.website_id.sudo().get_base_url()
        return '%s/scita/price_alert/%s/%s/%s' % (base, action, self.id, self.sudo().access_token)

    def _scita_unsubscribe_url(self):
        return self._scita_url('unsubscribe')

    def _scita_confirm_url(self):
        return self._scita_url('confirm')

    def _scita_rearm_url(self):
        return self._scita_url('rearm')

    def _scita_product_url(self):
        """Product page with the alert's variant selected."""
        self.ensure_one()
        return self.website_id.sudo().get_base_url() + (self.product_id.sudo().website_url
                                                         or self.product_tmpl_id.website_url)

    def _scita_unsubscribe_headers(self):
        """RFC 2369 / RFC 8058 one-click unsubscribe: mailbox providers (Gmail, Yahoo, Outlook)
        show an "Unsubscribe" link and POST "List-Unsubscribe=One-Click" to the URL."""
        self.ensure_one()
        return {
            'List-Unsubscribe': '<%s>' % self._scita_unsubscribe_url(),
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        }

    def _scita_send_confirmation(self):
        template = self.env.ref('scita_smart_commerce.mail_template_price_alert_confirm', raise_if_not_found=False)
        if not template:
            return
        for alert in self:
            # the shopper is waiting for it: send right after the request, not with the queue
            template.with_context(lang=alert.lang or None).send_mail(alert.id, force_send=True)

    # ------------------------------------------------------------------ price changes

    @api.model
    def _scita_recheck(self, domain):
        """Re-price the matching waiting alerts as soon as possible (a price just changed),
        in the background: the change is saved fast whatever the number of alerts."""
        alerts = self.sudo().search([('state', '=', 'active')] + list(domain))
        if alerts:
            alerts.write({'last_check_date': False})
            cron = self.env.ref('scita_smart_commerce.ir_cron_scita_price_alert', raise_if_not_found=False)
            if cron:
                cron.sudo()._trigger()

    @api.model
    def _scita_recheck_back_in_stock(self, products):
        """Stock came in: re-check now the alerts that reached their price while the
        product was sold out (they wait for it to be back), not at the next hourly run."""
        alerts = self.sudo().search([('state', '=', 'active'), ('product_id', 'in', products.ids),
                                     ('last_price', '!=', False)])
        held = alerts.filtered(lambda a: a.currency_id.compare_amounts(a.last_price, a.target_price) <= 0)
        if held:
            held.write({'last_check_date': False})
            cron = self.env.ref('scita_smart_commerce.ir_cron_scita_price_alert', raise_if_not_found=False)
            if cron:
                cron.sudo()._trigger()

    # ------------------------------------------------------------------ cron

    def _scita_check_price(self, template, now):
        """Re-price one alert and email the shopper when the price is low enough. Always
        stamps last_check_date, so a failing alert can't block the queue."""
        self.ensure_one()
        vals = {'last_check_date': now}
        notified = False
        tmpl = self.product_tmpl_id
        website = self.website_id.sudo()
        try:
            with self.env.cr.savepoint():
                if (not website.scita_price_alert_enabled or not tmpl.is_published
                        or not tmpl.active or not self.product_id.active or not tmpl.sale_ok):
                    pass  # checked again later, when the product is sellable again
                elif self._scita_price_is_hidden():
                    pass  # never email a price Theme Scita hides
                else:
                    price, currency = self._scita_compute_price()
                    vals['last_price'] = price
                    if (currency.compare_amounts(price, self.target_price) <= 0 and template
                            and not (website.scita_price_alert_skip_sold_out and self._scita_is_sold_out())):
                        self.write(vals)  # the email shows the price that triggered it
                        template.with_context(lang=self.lang or None).send_mail(
                            self.id, email_values={'headers': repr(self._scita_unsubscribe_headers())})
                        vals.update(state='notified', notified_date=now)
                        notified = True
                    # sold out at the right price: keep waiting, the shopper is emailed
                    # when it is back in stock (and still cheap enough)
        except Exception:
            _logger.exception('Price alert %s: could not check the price', self.id)
            vals = {'last_check_date': now}
            notified = False
        self.write(vals)
        return notified

    @api.model
    def _cron_check_price_alerts(self, batch_size=200):
        """Expire old alerts, then re-price the waiting ones not checked in the last
        CHECK_INTERVAL and email the shopper when the price is low enough. Commits per
        batch; the cron framework re-runs the job while alerts remain."""
        Cron = self.env['ir.cron']
        Alert = self.sudo()
        now = fields.Datetime.now()
        Alert.search([('state', '=', 'active'), ('expiry_date', '!=', False),
                      ('expiry_date', '<', now)]).write({'state': 'expired'})
        domain = [('state', '=', 'active'), '|', ('last_check_date', '=', False),
                  ('last_check_date', '<', now - CHECK_INTERVAL)]
        template = self.env.ref('scita_smart_commerce.mail_template_price_alert', raise_if_not_found=False)
        Cron._commit_progress(remaining=Alert.search_count(domain))
        while True:
            alerts = Alert.search(domain, limit=batch_size, order='last_check_date asc NULLS FIRST, id')
            if not alerts:
                break
            notified = False
            for alert in alerts:
                notified |= alert._scita_check_price(template, now)
            if notified:
                self._scita_trigger_mail_queue()
            if not Cron._commit_progress(len(alerts)):
                break  # out of time: the cron runs again for the rest

    @api.autovacuum
    def _gc_unconfirmed_alerts(self):
        self.sudo().search([('state', '=', 'pending'),
                            ('create_date', '<', fields.Datetime.now() - PENDING_LIFETIME)]).unlink()

    @api.autovacuum
    def _gc_closed_alerts(self):
        """Personal data is not kept forever: delete notified, expired and stopped alerts
        after the retention period of their website (0 keeps them)."""
        now = fields.Datetime.now()
        for website in self.env['website'].sudo().search([('scita_price_alert_retention_days', '>', 0)]):
            self.sudo().search([
                ('website_id', '=', website.id), ('state', 'in', CLOSED_STATES),
                ('write_date', '<', now - timedelta(days=website.scita_price_alert_retention_days)),
            ]).unlink()


class ScitaPriceAlertReport(models.Model):
    """Price sensitivity: which products shoppers find too expensive (active alerts)."""
    _name = 'scita.price.alert.report'
    _description = 'Price Sensitivity Analysis'
    _auto = False
    _order = 'alert_count desc'

    product_tmpl_id = fields.Many2one('product.template', string='Product', readonly=True)
    website_id = fields.Many2one('website', readonly=True)
    company_id = fields.Many2one('res.company', readonly=True)
    currency_id = fields.Many2one('res.currency', readonly=True)
    alert_count = fields.Integer('Waiting Alerts', readonly=True)
    avg_price_at_creation = fields.Monetary('Avg. Price When Subscribed', readonly=True, aggregator='avg')
    avg_current_price = fields.Monetary('Avg. Last Checked Price', readonly=True, aggregator='avg')
    avg_target_price = fields.Monetary('Avg. Target Price', readonly=True, aggregator='avg')
    avg_requested_discount = fields.Float('Avg. Requested Discount (%)', readonly=True, aggregator='avg')
    max_requested_discount = fields.Float('Max Requested Discount (%)', readonly=True, aggregator='max')

    @property
    def _table_sql(self):
        return SQL("""(
            SELECT MIN(a.id) AS id,
                   a.product_tmpl_id,
                   a.website_id,
                   a.company_id,
                   a.currency_id,
                   COUNT(*) AS alert_count,
                   AVG(a.price_at_creation) AS avg_price_at_creation,
                   AVG(COALESCE(a.last_price, a.price_at_creation)) AS avg_current_price,
                   AVG(a.target_price) AS avg_target_price,
                   AVG(a.requested_discount) AS avg_requested_discount,
                   MAX(a.requested_discount) AS max_requested_discount
              FROM scita_price_alert a
             WHERE a.state = 'active'
          GROUP BY a.product_tmpl_id, a.website_id, a.company_id, a.currency_id
        )""", to_flush=[f for f in self.env['scita.price.alert']._fields.values() if f.store])


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    scita_price_alert_count = fields.Integer(compute='_compute_scita_price_alert_count',
                                             groups='sales_team.group_sale_salesman')

    def _compute_scita_price_alert_count(self):
        counts = dict(self.env['scita.price.alert']._read_group(
            [('product_tmpl_id', 'in', self.ids), ('state', '=', 'active')],
            ['product_tmpl_id'], ['__count']))
        for tmpl in self:
            tmpl.scita_price_alert_count = counts.get(tmpl, 0)

    def action_scita_view_price_alerts(self):
        self.ensure_one()
        action = self.env['ir.actions.act_window']._for_xml_id('scita_smart_commerce.action_scita_price_alert')
        action['domain'] = [('product_tmpl_id', '=', self.id)]
        action['context'] = {'search_default_filter_active': 1, 'default_product_tmpl_id': self.id}
        return action

    def write(self, vals):
        res = super().write(vals)
        if 'list_price' in vals:
            self.env['scita.price.alert']._scita_recheck([('product_tmpl_id', 'in', self.ids)])
        return res


class ProductProduct(models.Model):
    _inherit = 'product.product'

    def write(self, vals):
        res = super().write(vals)
        if 'lst_price' in vals:
            # a custom price typed on one variant (Odoo 20 stores it on the variant only)
            self.env['scita.price.alert']._scita_recheck([('product_id', 'in', self.ids)])
        return res


class ProductTemplateAttributeValue(models.Model):
    _inherit = 'product.template.attribute.value'

    def write(self, vals):
        res = super().write(vals)
        if 'price_extra' in vals:
            self.env['scita.price.alert']._scita_recheck([('product_tmpl_id', 'in', self.product_tmpl_id.ids)])
        return res


class ProductPricelistItem(models.Model):
    _inherit = 'product.pricelist.item'

    @api.model_create_multi
    def create(self, vals_list):
        items = super().create(vals_list)
        items._scita_recheck_price_alerts()
        return items

    def write(self, vals):
        self._scita_recheck_price_alerts()  # what the rules applied to before...
        res = super().write(vals)
        self._scita_recheck_price_alerts()  # ...and after the change
        return res

    def unlink(self):
        self._scita_recheck_price_alerts()
        return super().unlink()

    def _scita_recheck_price_alerts(self):
        """A pricelist rule changed: re-check the alerts priced with it. Alerts without a
        pricelist use the website's public pricelist, which may be any of them."""
        Alert = self.env['scita.price.alert']
        for item in self:
            domain = ['|', ('pricelist_id', '=', item.pricelist_id.id), ('pricelist_id', '=', False)]
            if item.applied_on == '0_product_variant' and item.product_id:
                domain.append(('product_id', '=', item.product_id.id))
            elif item.applied_on == '1_product' and item.product_tmpl_id:
                domain.append(('product_tmpl_id', '=', item.product_tmpl_id.id))
            Alert._scita_recheck(domain)


class StockMove(models.Model):
    _inherit = 'stock.move'

    def _action_done(self, cancel_backorder=False):
        moves = super()._action_done(cancel_backorder=cancel_backorder)
        # receipts, returns, inventory adjustments: a sold-out product may be back
        incoming = moves.filtered(lambda m: m.state == 'done' and m.location_dest_id.usage == 'internal'
                                  and m.location_id.usage != 'internal')
        if incoming:
            self.env['scita.price.alert']._scita_recheck_back_in_stock(incoming.product_id)
        return moves


class ResPartner(models.Model):
    _inherit = 'res.partner'

    def write(self, vals):
        if 'email' not in vals:
            return super().write(vals)
        old_emails = {partner: partner.email_normalized for partner in self}
        res = super().write(vals)
        Alert = self.env['scita.price.alert'].sudo()
        for partner, old_email in old_emails.items():
            new_email = partner.email_normalized
            if old_email and new_email and new_email != old_email:
                # open alerts made with the account's address follow it (not those sent to
                # another address the shopper typed)
                Alert.search([('partner_id', '=', partner.id), ('email_normalized', '=', old_email),
                              ('state', 'in', OPEN_STATES)]).write({'email': new_email})
        return res
