import hashlib
import ipaddress
import logging
import time

from markupsafe import Markup
from psycopg2 import errors

from odoo import api, fields, models
from odoo.http import request

from .ai_providers import PROVIDERS, AIProviderError

_logger = logging.getLogger(__name__)

# usage rows keyed by the client IP (instead of the session) start with this prefix
IP_KEY_PREFIX = 'ip:'
# logged-in visitors are counted per account (all their devices), guests per session
USER_KEY_PREFIX = 'user:'
AI_FEATURES = ('assistant', 'visual_search', 'compare')
# share of the daily token budget after which only logged-in customers may still use AI
GUEST_BUDGET_SHARE = 0.8
# attempts of the short usage transactions: this cursor is REPEATABLE READ, so two requests
# updating the same row at the same moment make one of them start over
OWN_TRANSACTION_ATTEMPTS = 4
USAGE_UPSERT = """
    INSERT INTO scita_ai_usage AS u
        (date, website_id, feature, visitor_key, action_count, request_count, input_tokens, output_tokens,
         create_uid, write_uid, create_date, write_date)
    VALUES (%(date)s, %(website)s, %(feature)s, %(key)s, GREATEST(%(actions)s, 0), %(requests)s,
            %(input_tokens)s, %(output_tokens)s, %(uid)s, %(uid)s,
            now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC')
    ON CONFLICT (date, website_id, feature, visitor_key) DO UPDATE SET
        action_count = GREATEST(u.action_count + %(actions)s, 0),
        request_count = u.request_count + EXCLUDED.request_count,
        input_tokens = u.input_tokens + EXCLUDED.input_tokens,
        output_tokens = u.output_tokens + EXCLUDED.output_tokens,
        write_uid = EXCLUDED.write_uid,
        write_date = EXCLUDED.write_date
    WHERE %(limit)s = 0 OR u.action_count < %(limit)s
    RETURNING u.id
"""


def ip_key():
    """Hashed client IP: clearing the session cookie must not reset a visitor's allowance.
    One IPv6 customer owns a whole /64, so that is what counts. Salted: the IPv4 space is small
    enough to reverse a plain hash."""
    ip = request and request.httprequest.remote_addr or 'no-ip'
    try:
        address = ipaddress.ip_address(ip)
        address = getattr(address, 'ipv4_mapped', None) or address
        if address.version == 6:
            address = ipaddress.ip_network(f'{address}/64', strict=False).network_address
        ip = str(address)
    except ValueError:
        pass  # 'no-ip'
    salt = request.env['ir.config_parameter'].sudo().get_str('database.secret') if request else ''
    return IP_KEY_PREFIX + hashlib.sha256(f'{salt}:{ip}'.encode()).hexdigest()[:29]


class ScitaAi(models.AbstractModel):
    """Entry point for every AI call of the smart-commerce features.

    What a visitor may use is counted in uses (an assistant message, a photo search, a
    comparison), with separate daily allowances for guests and logged-in customers. What the
    website pays for is counted in tokens, against an optional daily token budget: past
    GUEST_BUDGET_SHARE of it only logged-in customers keep the AI, past 100% nobody does.
    """
    _name = 'scita.ai'
    _description = 'Scita AI Service'

    def _provider(self, website):
        website = website.sudo()
        if not website.scita_ai_api_key:
            raise AIProviderError('No AI API key is configured for this website.', admin=True)
        provider_cls = PROVIDERS.get(website.scita_ai_provider)
        if not provider_cls:
            raise AIProviderError('Unknown AI provider: %s' % website.scita_ai_provider, admin=True)
        return provider_cls(website.scita_ai_api_key, website.scita_ai_model)

    @api.model
    def _is_guest(self):
        return self.env.user._is_public()

    @api.model
    def _visitor_key(self):
        if not self._is_guest():
            return USER_KEY_PREFIX + str(self.env.uid)
        sid = request and request.session.sid or 'no-session'
        return hashlib.sha256(sid.encode()).hexdigest()[:32]

    @api.model
    def _ip_key(self):
        return ip_key()

    @api.model
    def _has_session_cookie(self):
        """The visitor came back with the session cookie a page view gave them. A script that
        drops cookies gets a brand-new session on every request, which would also reset its
        per-visitor allowance: such requests are refused instead."""
        if not request:
            return True
        return request.httprequest.cookies.get('session_id') == request.session.sid

    def _usage_record(self, website, feature, key=None):
        """Today's usage row, to read (empty without any use yet); _bump_usage() writes them."""
        return self.env['scita.ai.usage'].sudo().search([
            ('date', '=', fields.Date.context_today(self)), ('website_id', '=', website.id),
            ('feature', '=', feature), ('visitor_key', '=', key or self._visitor_key())], limit=1)

    def _own_transaction(self, func):
        """func(scita.ai on a new cursor), committed at once. For what a request shares with
        others: its own transaction stays open during the AI call, and a conflict there would
        make Odoo run the whole request (and pay for the AI call) again. None if it kept failing."""
        for attempt in range(OWN_TRANSACTION_ATTEMPTS):
            try:
                with self.env.registry.cursor() as cr:
                    return func(self.with_env(self.env(cr=cr)))
            except (errors.SerializationFailure, errors.DeadlockDetected):
                time.sleep(0.05 * (attempt + 1))
        _logger.warning('Scita AI: usage not recorded, too many concurrent updates')
        return None

    def _bump_usage(self, website, feature, key, actions=0, requests=0, input_tokens=0, output_tokens=0, limit=0):
        """Add to a usage row, atomically. With `limit` (0 = none), a row whose action_count
        reached it stays as it is. Returns whether the row was updated."""
        params = {
            'date': fields.Date.context_today(self), 'website': website.id, 'feature': feature, 'key': key,
            'actions': actions, 'requests': requests, 'input_tokens': input_tokens,
            'output_tokens': output_tokens, 'limit': limit, 'uid': self.env.uid,
        }

        def upsert(ai):
            ai.env.cr.execute(USAGE_UPSERT, params)
            return bool(ai.env.cr.fetchone())
        return bool(self._own_transaction(upsert))

    def _site_totals(self, website):
        """(AI requests, tokens) of this website today, all AI features and visitors."""
        groups = self.env['scita.ai.usage'].sudo()._read_group(
            [('date', '=', fields.Date.context_today(self)), ('website_id', '=', website.id),
             ('feature', 'in', AI_FEATURES), ('visitor_key', 'not =like', IP_KEY_PREFIX + '%')],
            [], ['request_count:sum', 'input_tokens:sum', 'output_tokens:sum'])
        requests_, input_tokens, output_tokens = groups[0]
        return requests_ or 0, (input_tokens or 0) + (output_tokens or 0)

    def _site_request_count(self, website):
        """AI requests made today on this website (all AI features and visitors)."""
        return self._site_totals(website)[0]

    @api.model
    def _use_limit(self, website, feature, guest):
        """Uses per day of `feature` for a guest / a logged-in customer (0 = unlimited)."""
        if feature == 'assistant':
            return website.scita_ai_guest_assistant_limit if guest else website.scita_ai_user_assistant_limit
        return website.scita_ai_guest_action_limit if guest else website.scita_ai_user_action_limit

    @api.model
    def check_rate_limit(self, website, feature):
        """Raise AIProviderError (with a message for the shopper) when this visitor may not use
        `feature` now, else reserve the use: parallel requests can't all pass the limit. Call it
        once per use, before the first AI call; release_use() gives it back if the call fails."""
        website = website.sudo()
        _ = self.env._
        guest = self._is_guest()
        if guest and website.scita_ai_login_required:
            raise AIProviderError(_('Please log in to use this feature.'))
        if guest and not self._has_session_cookie():
            raise AIProviderError(_('Please reload the page and try again.'))

        site_requests, site_tokens = self._site_totals(website)
        budget = website.scita_ai_daily_token_budget
        if budget and site_tokens >= budget:
            _logger.warning('Scita AI: website %s used its daily budget of %s tokens', website.id, budget)
            raise AIProviderError(_('This feature is very busy today. Please try again tomorrow.'))
        if budget and guest and site_tokens >= budget * GUEST_BUDGET_SHARE:
            raise AIProviderError(_('This feature is very busy today. Log in to your account to keep using it.'))
        site_limit = website.scita_ai_site_daily_limit
        if site_limit and site_requests >= site_limit:
            _logger.warning('Scita AI: website %s reached its daily cap of %s AI requests', website.id, site_limit)
            raise AIProviderError(_('This feature is very busy today. Please try again tomorrow.'))

        limit = self._use_limit(website, feature, guest)
        if not self._bump_usage(website, feature, self._visitor_key(), actions=1, limit=limit):
            if guest and self._use_limit(website, feature, False) > limit:
                raise AIProviderError(_("You've reached today's limit for this feature. "
                                        "Log in to your account to continue."))
            raise AIProviderError(_("You've reached today's limit for this feature. Please try again tomorrow."))
        ip_limit = website.scita_ai_ip_daily_limit
        if guest and not self._bump_usage(website, feature, self._ip_key(), actions=1, limit=ip_limit):
            self._bump_usage(website, feature, self._visitor_key(), actions=-1)
            raise AIProviderError(_("You've reached today's limit for this feature. Please try again tomorrow."))

    @api.model
    def release_use(self, website, feature):
        """The AI call failed: the use reserved by check_rate_limit() doesn't count."""
        self._bump_usage(website, feature, self._visitor_key(), actions=-1)
        if self._is_guest():
            self._bump_usage(website, feature, self._ip_key(), actions=-1)

    @api.model
    def chat(self, website, feature, system, messages, tools=None, max_tokens=4096, effort='low', json_schema=None,
             allow_tool_calls=True):
        """Call the website's AI provider; counts usage for `feature`. Returns an AIResponse."""
        provider = self._provider(website)
        response = provider.chat(system, messages, tools=tools, max_tokens=max_tokens,
                                 effort=effort, json_schema=json_schema, allow_tool_calls=allow_tool_calls)
        self._bump_usage(website, feature, self._visitor_key(), requests=1,
                         input_tokens=response.input_tokens, output_tokens=response.output_tokens)
        # the IP row only counts requests (tokens are already on the session row)
        self._bump_usage(website, feature, self._ip_key(), requests=1)
        if website.sudo().scita_ai_daily_token_budget:
            # a new transaction: this request's snapshot is older than the tokens just counted
            self._own_transaction(lambda ai: ai._check_budget_alert(website.with_env(ai.env).sudo()))
        return response

    def _check_budget_alert(self, website):
        """Email the shop once a day when AI usage passes GUEST_BUDGET_SHARE of the token budget
        (guests are paused from then on)."""
        budget = website.scita_ai_daily_token_budget
        today = fields.Date.context_today(self)
        if not budget or website.scita_ai_budget_alert_date == today:
            return
        tokens = self._site_totals(website)[1]
        if tokens < budget * GUEST_BUDGET_SHARE:
            return
        website.scita_ai_budget_alert_date = today
        email_to = website.company_id.email or self.env.ref('base.user_admin').sudo().email
        if not email_to:
            _logger.warning('Scita AI: website %s used %s of its %s daily AI tokens (no email to alert)',
                            website.id, tokens, budget)
            return
        _ = self.env._
        body = Markup('<p>%s</p><p>%s</p>') % (
            _('Your website "%(website)s" has used %(used)s of its %(budget)s daily AI tokens today.',
              website=website.name, used=f'{tokens:,}', budget=f'{budget:,}'),
            _('Until tomorrow the AI features stay available to logged-in customers only. '
              'You can raise the budget in Website > Settings > Scita Smart Commerce.'),
        )
        self.env['mail.mail'].sudo().create({
            'subject': _('AI usage at %(share)s%% of the daily budget on %(website)s',
                         share=int(GUEST_BUDGET_SHARE * 100), website=website.name),
            'email_from': website.company_id.email_formatted or email_to,
            'email_to': email_to,
            'body_html': body,
            'auto_delete': True,
        })

    @api.model
    def public_error(self, error):
        """Message safe to show a shopper; configuration details only go to the log, and
        to staff members testing the shop (so that they know what to fix)."""
        if error.admin:
            _logger.warning('Scita AI configuration problem: %s', error)
            message = self.env._('This feature is not available right now.')
            if self.env.user._is_internal():
                message += ' ' + self.env._('(Only staff see this: %s)', error)
            return message
        return str(error)
