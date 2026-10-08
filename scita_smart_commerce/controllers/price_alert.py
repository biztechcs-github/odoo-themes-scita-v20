import time

from odoo import http, tools
from odoo.http import request
from odoo.tools import consteq

from ..models.ai_service import ip_key
from ..models.price_alert import MAX_ACTIVE_ALERTS_PER_EMAIL, OPEN_STATES

# Per browser session: at most this many alert submissions per rolling day
MAX_SUBMISSIONS_PER_SESSION = 10
# Per client IP address and day (survives clearing cookies; several shoppers may share an IP)
MAX_SUBMISSIONS_PER_IP = 30
SESSION_KEY = 'scita_price_alert_submissions'


class ScitaPriceAlertController(http.Controller):

    def _error(self, message):
        return {'ok': False, 'message': message}

    def _session_allowance(self):
        now = time.time()
        recent = [t for t in request.session.get(SESSION_KEY, []) if now - t < 86400]
        request.session[SESSION_KEY] = recent
        return len(recent) < MAX_SUBMISSIONS_PER_SESSION

    def _ip_usage(self, website):
        return request.env['scita.ai']._usage_record(website, 'price_alert', ip_key())

    def _record_submission(self, website):
        request.session[SESSION_KEY] = request.session.get(SESSION_KEY, []) + [time.time()]
        self._ip_usage(website).request_count += 1

    @http.route('/scita/price_alert/create', type='jsonrpc', auth='public', website=True, methods=['POST'])
    def create_price_alert(self, product_id=None, email=None, target_price=None, website_url=None,
                           alert_type=None, drop_percent=None, **kw):
        """Subscribe to a price drop alert. `alert_type`: "any" (any drop), "percent" (at least
        `drop_percent` % cheaper) or "target" (`target_price` or less, the default for old
        callers). `website_url` is a honeypot: humans never fill it.

        Alerts for an address other than the signed-in shopper's own one must be confirmed
        from an email first (unless the website turned that off), so nobody can subscribe
        someone else."""
        env = request.env
        website = env.website
        _ = env._
        if not website.scita_price_alert_enabled:
            return self._error(_('Price alerts are not available.'))
        if website_url:
            # bots fill every field; answer as if it worked
            return {'ok': True, 'message': _("We'll email you when the price drops.")}
        if not self._session_allowance() or self._ip_usage(website).request_count >= MAX_SUBMISSIONS_PER_IP:
            return self._error(_('Too many alerts from this browser today. Please try again tomorrow.'))

        product = self._product(product_id)
        if not product:
            return self._error(_('This product is not available.'))
        tmpl = product.product_tmpl_id

        if env.user._is_public():
            email = tools.email_normalize(email or '') if isinstance(email, str) else False
            partner = env['res.partner']
        else:
            partner = env.user.partner_id
            email = (tools.email_normalize(email) if isinstance(email, str) and email.strip() else False) \
                or partner.email_normalized
        if not email:
            return self._error(_('Please enter a valid email address.'))
        # the signed-in shopper's own address needs no confirmation
        confirmed = (bool(partner) and email == partner.email_normalized) or not website.scita_price_alert_guest_confirm

        info = tmpl.with_context(website_id=website.id)._get_combination_info(product_id=product.id)
        currency = info['currency']
        price = info['price']
        Alert = env['scita.price.alert'].sudo()
        alert_type = alert_type if alert_type in ('any', 'percent', 'target') else 'target'
        target, error = Alert._scita_target_for(alert_type, price, currency, drop_percent, target_price)
        if error:
            return self._error(error)
        try:
            percent = int(float(drop_percent)) if alert_type == 'percent' else 0
        except (TypeError, ValueError):
            percent = 0

        values = {
            'alert_type': alert_type,
            'drop_percent': percent,
            'target_price': target,
            'price_at_creation': price,
            'last_price': price,
            'last_check_date': False,
            'currency_id': currency.id,
            'pricelist_id': request.pricelist.id or False,
            'fiscal_position_id': request.fiscal_position.id or False,
            'lang': env.lang,
            'partner_id': partner.id or False,
            'expiry_date': Alert._scita_expiry_date(website),
        }
        existing = Alert.search([
            ('email_normalized', '=', email), ('product_id', '=', product.id),
            ('website_id', '=', website.id), ('state', 'in', OPEN_STATES),
        ], limit=1)
        if existing and not confirmed and existing.state != 'pending':
            # Someone who can't prove they own this address (guest, or a signed-in shopper
            # typing another address) must not change an alert its owner already confirmed,
            # nor learn that this address follows this product: same answer as a new sign-up.
            self._record_submission(website)
            return {
                'ok': True,
                'updated': False,
                'pending': True,
                'message': _("Almost done! Check %(email)s and confirm the alert: we'll email you when "
                             "the price %(condition)s.", email=email,
                             condition=Alert.new({**values, 'product_id': product.id})._scita_condition_text()),
            }
        if existing:
            if confirmed:
                values['state'] = 'active'
            existing.write(values)
            alert = existing
        else:
            # unconfirmed sign-ups (maybe made by someone else) never use up the owner's quota
            counted_states = ('active',) if confirmed else OPEN_STATES
            if Alert.search_count([('email_normalized', '=', email), ('state', 'in', counted_states)]) >= MAX_ACTIVE_ALERTS_PER_EMAIL:
                return self._error(_('You already have the maximum number of price alerts.'))
            alert = Alert.create({
                **values,
                'email': email,
                'product_tmpl_id': tmpl.id,
                'product_id': product.id,
                'website_id': website.id,
                'state': 'active' if confirmed else 'pending',
            })
        self._record_submission(website)
        condition = alert._scita_condition_text()
        if alert.state == 'pending':
            alert._scita_send_confirmation()
            return {
                'ok': True,
                'updated': bool(existing),
                'pending': True,
                'message': _("Almost done! Check %(email)s and confirm the alert: we'll email you when "
                             "the price %(condition)s.", email=email, condition=condition),
            }
        return {
            'ok': True,
            'updated': bool(existing),
            'alert': self._alert_status(alert),
            'message': _("Done! We'll email %(email)s when the price %(condition)s.",
                         email=email, condition=condition),
        }

    def _product(self, product_id):
        """The website product a visitor may follow, or an empty recordset."""
        env = request.env
        website = env.website
        try:
            product_id = int(product_id or 0)
        except (TypeError, ValueError):
            product_id = 0
        product = env['product.product'].sudo().browse(product_id).exists() if product_id > 0 else env['product.product']
        tmpl = product.product_tmpl_id
        if (not product or not product.active or not product.sale_ok or not tmpl.is_published
                or not tmpl.filtered_domain(website.website_domain())
                or tmpl.company_id not in (website.company_id, tmpl.env['res.company'])
                or website._scita_hide_price(tmpl)):
            return env['product.product']
        return product

    @staticmethod
    def _my_alerts_domain(partner):
        """Alerts of a signed-in shopper: made while signed in, or confirmed from their mailbox."""
        domain = [('partner_id', '=', partner.id)]
        if partner.email_normalized:
            domain = ['|'] + domain + ['&', ('email_normalized', '=', partner.email_normalized),
                                       ('state', '!=', 'pending')]
        return domain

    def _alert_status(self, alert):
        return {
            'id': alert.id,
            'state': alert.state,
            'condition': alert._scita_condition_text(),
            'email': alert.email,
        }

    @http.route('/scita/price_alert/status', type='jsonrpc', auth='public', website=True, readonly=True)
    def price_alert_status(self, product_id=None, **kw):
        """Price alert box of the selected variant: its price and suggested "my price"
        (the variant changes on the page), and the signed-in shopper's open alert on it
        ("You're watching")."""
        env = request.env
        if not env.website.scita_price_alert_enabled:
            return {'alert': False}
        product = self._product(product_id)
        if not product:
            return {'alert': False}
        info = product.product_tmpl_id.with_context(website_id=env.website.id)._get_combination_info(
            product_id=product.id)
        currency = info['currency']
        percent = env.website.scita_price_alert_default_percent or 10
        result = {
            'alert': False,
            'price': info['price'],
            'suggested_target': currency.round(info['price'] * (100 - percent) / 100),
            'decimals': currency.decimal_places,
        }
        if not env.user._is_public():
            alert = env['scita.price.alert'].sudo().search(
                self._my_alerts_domain(env.user.partner_id) + [
                    ('product_id', '=', product.id), ('website_id', '=', env.website.id),
                    ('state', 'in', OPEN_STATES)], limit=1)
            result['alert'] = self._alert_status(alert) if alert else False
        return result

    @http.route('/scita/price_alert/stop', type='jsonrpc', auth='user', website=True, methods=['POST'])
    def price_alert_stop(self, alert_id=None, **kw):
        alert = self._my_alert(alert_id)
        if not alert:
            return {'ok': False}
        alert.action_cancel()
        return {'ok': True, 'message': request.env._('Price alert stopped.')}

    def _my_alert(self, alert_id):
        """One alert of the signed-in shopper, or an empty recordset."""
        try:
            alert_id = int(alert_id or 0)
        except (TypeError, ValueError):
            alert_id = 0
        Alert = request.env['scita.price.alert'].sudo()
        if alert_id <= 0:
            return Alert
        return Alert.search(self._my_alerts_domain(request.env.user.partner_id) + [('id', '=', alert_id)], limit=1)

    def _alert_from_token(self, alert_id, token):
        alert = request.env['scita.price.alert'].sudo().browse(alert_id).exists()
        if alert and consteq(alert.access_token or '', token or ''):
            return alert
        return request.env['scita.price.alert']

    @http.route('/scita/price_alert/confirm/<int:alert_id>/<string:token>',
                type='http', auth='public', website=True, sitemap=False, methods=['GET', 'POST'])
    def confirm_price_alert(self, alert_id, token, **kw):
        """Double opt-in link of the confirmation email. A GET only asks (mail scanners open
        links, which must not subscribe the address), the button POSTs."""
        alert = self._alert_from_token(alert_id, token)
        if alert and alert.state == 'pending' and request.httprequest.method == 'POST':
            alert.action_confirm()
        return request.render('scita_smart_commerce.price_alert_confirmed', {
            'valid': bool(alert) and alert.state in ('pending', 'active', 'notified'),
            'pending': bool(alert) and alert.state == 'pending',
            'alert': alert or None,
            'token': token,
        })

    # csrf=False: RFC 8058 one-click unsubscribe, mailbox providers POST without a CSRF token
    # (the secret per-alert token is the protection)
    @http.route('/scita/price_alert/unsubscribe/<int:alert_id>/<string:token>',
                type='http', auth='public', website=True, sitemap=False, methods=['GET', 'POST'], csrf=False)
    def unsubscribe_price_alert(self, alert_id, token, **kw):
        """"Stop this alert" link of the emails. A GET only asks (mail scanners open links),
        the button or the mailbox's one-click unsubscribe POSTs."""
        alert = self._alert_from_token(alert_id, token)
        done = False
        if alert and request.httprequest.method == 'POST':
            if alert.state != 'cancelled':
                alert.action_cancel()
            done = True
        return request.render('scita_smart_commerce.price_alert_unsubscribed', {
            'valid': bool(alert),
            'alert': alert or None,
            'done': done or (bool(alert) and alert.state == 'cancelled'),
            'token': token,
        })

    @http.route('/scita/price_alert/rearm/<int:alert_id>/<string:token>',
                type='http', auth='public', website=True, sitemap=False, methods=['GET', 'POST'])
    def rearm_price_alert(self, alert_id, token, **kw):
        """"Keep watching" link of the price drop email. A GET only asks (mail scanners open
        links), the button POSTs."""
        alert = self._alert_from_token(alert_id, token)
        done = False
        if alert and request.httprequest.method == 'POST' and alert.state != 'pending':
            done = bool(alert._scita_rearm())
        return request.render('scita_smart_commerce.price_alert_rearm', {
            'valid': bool(alert) and alert.state != 'pending',
            'alert': alert or None,
            'done': done,
            'token': token,
        })
