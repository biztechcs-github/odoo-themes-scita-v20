import hashlib
import logging

from psycopg2 import IntegrityError

from odoo import api, fields, models
from odoo.http import request

from .ai_providers import PROVIDERS, AIProviderError

_logger = logging.getLogger(__name__)

# usage rows keyed by the client IP (instead of the session) start with this prefix
IP_KEY_PREFIX = 'ip:'
AI_FEATURES = ('assistant', 'visual_search', 'compare')


def ip_key():
    """Hashed client IP: clearing the session cookie must not reset a visitor's allowance."""
    ip = request and request.httprequest.remote_addr or 'no-ip'
    return IP_KEY_PREFIX + hashlib.sha256(ip.encode()).hexdigest()[:29]


class ScitaAi(models.AbstractModel):
    """Entry point for every AI call of the smart-commerce features."""
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
    def _visitor_key(self):
        sid = request and request.session.sid or 'no-session'
        return hashlib.sha256(sid.encode()).hexdigest()[:32]

    @api.model
    def _ip_key(self):
        return ip_key()

    def _usage_record(self, website, feature, key=None):
        Usage = self.env['scita.ai.usage'].sudo()
        key = key or self._visitor_key()
        today = fields.Date.context_today(self)
        domain = [('date', '=', today), ('website_id', '=', website.id),
                  ('feature', '=', feature), ('visitor_key', '=', key)]
        usage = Usage.search(domain, limit=1)
        if usage:
            return usage
        try:
            with self.env.cr.savepoint():
                return Usage.create({'date': today, 'website_id': website.id, 'feature': feature, 'visitor_key': key})
        except IntegrityError:
            # a concurrent request of the same visitor created it first
            return Usage.search(domain, limit=1)

    def _site_request_count(self, website):
        """AI requests made today on this website (all AI features and visitors)."""
        groups = self.env['scita.ai.usage'].sudo()._read_group(
            [('date', '=', fields.Date.context_today(self)), ('website_id', '=', website.id),
             ('feature', 'in', AI_FEATURES), ('visitor_key', 'not =like', IP_KEY_PREFIX + '%')],
            [], ['request_count:sum'])
        return groups[0][0] or 0

    @api.model
    def check_rate_limit(self, website, feature):
        """Raise AIProviderError when this visitor (session or IP) or the whole website
        used up today's allowance."""
        website = website.sudo()
        limit_msg = "You've reached today's limit for this feature. Please try again tomorrow."
        limit = website.scita_ai_daily_limit
        if limit and self._usage_record(website, feature).request_count >= limit:
            raise AIProviderError(limit_msg)
        ip_limit = website.scita_ai_ip_daily_limit
        if ip_limit and self._usage_record(website, feature, self._ip_key()).request_count >= ip_limit:
            raise AIProviderError(limit_msg)
        site_limit = website.scita_ai_site_daily_limit
        if site_limit and self._site_request_count(website) >= site_limit:
            _logger.warning('Scita AI: website %s reached its daily cap of %s AI requests', website.id, site_limit)
            raise AIProviderError('This feature is very busy today. Please try again tomorrow.')

    @api.model
    def chat(self, website, feature, system, messages, tools=None, max_tokens=4096, effort='low', json_schema=None):
        """Call the website's AI provider; counts usage for `feature`. Returns an AIResponse."""
        provider = self._provider(website)
        response = provider.chat(system, messages, tools=tools, max_tokens=max_tokens,
                                 effort=effort, json_schema=json_schema)
        usage = self._usage_record(website, feature)
        usage.write({
            'request_count': usage.request_count + 1,
            'input_tokens': usage.input_tokens + response.input_tokens,
            'output_tokens': usage.output_tokens + response.output_tokens,
        })
        # the IP row only counts requests (tokens are already on the session row)
        ip_usage = self._usage_record(website, feature, self._ip_key())
        ip_usage.request_count += 1
        return response

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
