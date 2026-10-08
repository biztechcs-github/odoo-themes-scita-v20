from odoo import http
from odoo.http import request

from odoo.addons.portal.controllers.portal import CustomerPortal

from .price_alert import ScitaPriceAlertController

# Alerts listed on /my/price-alerts (newest first)
MAX_LISTED_ALERTS = 100


class ScitaPriceAlertPortal(CustomerPortal):
    """My Account > Price Alerts: follow, stop or restart one's price drop alerts."""

    def _prepare_portal_counter_values(self, counter):
        if counter == 'scita_price_alert_count':
            # only shown once the website uses price alerts
            if not request.env.website.scita_price_alert_enabled:
                return False, False, False
            return 'scita.price.alert', self._scita_price_alert_domain() + [('state', 'in', ('pending', 'active'))], 'sudo'
        return super()._prepare_portal_counter_values(counter)

    def _scita_price_alert_domain(self):
        return ScitaPriceAlertController._my_alerts_domain(request.env.user.partner_id) + [
            ('website_id', '=', request.env.website.id)]

    @http.route('/my/price-alerts', type='http', auth='user', website=True)
    def portal_my_price_alerts(self, **kw):
        alerts = request.env['scita.price.alert'].sudo().search(
            self._scita_price_alert_domain(), limit=MAX_LISTED_ALERTS,
            order='create_date desc, id desc')
        values = self._prepare_portal_layout_values()
        values.update({
            'page_name': 'scita_price_alerts',
            'alerts': alerts,
            'message': kw.get('message'),
        })
        return request.render('scita_smart_commerce.portal_my_price_alerts', values)

    @http.route('/my/price-alerts/<int:alert_id>/<string:action>', type='http', auth='user',
                website=True, methods=['POST'])
    def portal_my_price_alert_action(self, alert_id, action, **kw):
        alert = ScitaPriceAlertController()._my_alert(alert_id)
        message = ''
        if alert and action == 'stop' and alert.state in ('pending', 'active'):
            alert.action_cancel()
            message = 'stopped'
        elif alert and action == 'watch' and alert.state in ('notified', 'expired', 'cancelled'):
            message = 'watching' if alert._scita_rearm() else ''
        return request.redirect('/my/price-alerts' + ('?message=%s' % message if message else ''))
