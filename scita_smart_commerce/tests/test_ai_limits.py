import base64
import io
import json

from PIL import Image

from odoo.tests import HttpCase, new_test_user, tagged

from odoo.addons.scita_smart_commerce.models.ai_providers import AIProviderError
from odoo.addons.scita_smart_commerce.models.ai_providers.base import AIResponse, AIToolCall


class FakeProvider:
    """Stands in for the AI provider: answers instantly with fixed token counts and records
    what it was sent."""

    def __init__(self, tokens=(300, 100)):
        self.calls = []
        self.tokens = tokens
        self.tool_rounds = 0  # assistant: answer with this many search_products calls first
        self.tool_query = 'sofa'
        self.fail = False

    def chat(self, system, messages, tools=None, max_tokens=4096, effort='low', json_schema=None,
             allow_tool_calls=True):
        self.calls.append({'messages': messages, 'tools': tools, 'json_schema': json_schema,
                           'allow_tool_calls': allow_tool_calls})
        if self.fail:
            raise AIProviderError('The AI service is temporarily unavailable.', retryable=True)
        usage = {'input_tokens': self.tokens[0], 'output_tokens': self.tokens[1]}
        if tools and allow_tool_calls and self.tool_rounds:
            self.tool_rounds -= 1
            call = AIToolCall(id='t%s' % len(self.calls), name='search_products', input={'query': self.tool_query})
            return AIResponse(tool_calls=[call], stop_reason='tool_use', raw_content=[
                {'type': 'tool_use', 'id': call.id, 'name': call.name, 'input': call.input}], **usage)
        if json_schema and 'differences' in json_schema.get('properties', {}):
            return AIResponse(text='{"summary": "They differ.", "differences": [], "best_for": [], '
                                   '"not_specified": []}', stop_reason='end_turn', **usage)
        if json_schema:
            return AIResponse(text='{}', stop_reason='end_turn', **usage)
        return AIResponse(text='Here are some sofas.', stop_reason='end_turn',
                          raw_content=[{'type': 'text', 'text': 'Here are some sofas.'}], **usage)


@tagged('post_install', '-at_install')
class TestAiLimits(HttpCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.website = cls.env.ref('base.default_website')
        cls.website.write({
            'scita_ai_api_key': 'test-key',
            'scita_assistant_enabled': True,
            'scita_visual_search_enabled': True,
            'scita_compare_ai_enabled': True,
            'scita_ai_guest_assistant_limit': 10,
            'scita_ai_user_assistant_limit': 30,
            'scita_ai_guest_action_limit': 5,
            'scita_ai_user_action_limit': 20,
            'scita_ai_ip_daily_limit': 100,
            'scita_ai_daily_token_budget': 0,
            'scita_ai_site_daily_limit': 0,
            'scita_ai_login_required': False,
        })
        cls.customer = new_test_user(cls.env, login='ai_customer', groups='base.group_portal',
                                     password='ai_customer_pw', email='ai_customer@example.com')
        cls.manager = new_test_user(cls.env, login='ai_manager', groups='base.group_system,website.group_website_designer',
                                    password='ai_manager_pw')
        cls.env['scita.ai.usage'].sudo().search([]).unlink()
        cls.products = cls.env['product.product'].create([
            {'name': 'AI Test Sofa %s' % i, 'list_price': 100 + i, 'website_published': True, 'sale_ok': True}
            for i in range(2)])

    def setUp(self):
        super().setUp()
        self.fake = FakeProvider()
        self.patch(self.registry['scita.ai'], '_provider', lambda _self, website: self.fake)

    # ------------------------------------------------------------ helpers

    def guest(self):
        """A new guest who viewed a page first (and so has the session cookie)."""
        self.authenticate(None, None)
        self.url_open('/')

    def ask(self, text='Do you have a green sofa?', history=None):
        messages = (history or []) + [{'role': 'user', 'content': text}]
        return self.make_jsonrpc_request('/scita/assistant/chat', {'messages': messages})

    def usage(self, feature='assistant'):
        Usage = self.env['scita.ai.usage'].sudo()
        rows = Usage.search([('feature', '=', feature), ('visitor_key', 'not =like', 'ip:%')])
        return sum(rows.mapped('action_count')), sum(rows.mapped('request_count'))

    @staticmethod
    def png():
        buf = io.BytesIO()
        Image.new('RGB', (8, 8), (0, 120, 60)).save(buf, 'PNG')
        return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()

    # ------------------------------------------------------------ tests

    def test_guest_message_limit(self):
        self.guest()
        for _i in range(10):
            self.assertEqual(self.ask().get('reply'), 'Here are some sofas.')
        result = self.ask()
        self.assertIn("today's limit", result['error'])
        self.assertIn('Log in', result['error'], 'customers get more: tell the guest')
        self.assertEqual(len(self.fake.calls), 10, 'the refused message never reached the AI')
        self.assertEqual(self.usage(), (10, 10))

    def test_one_message_is_one_use_whatever_its_tool_calls(self):
        self.guest()
        self.fake.tool_rounds = 10
        result = self.ask()
        # MAX_TOOL_ITERATIONS: 3 calls at most, and they count as one message
        self.assertEqual(len(self.fake.calls), 3)
        self.assertEqual(self.usage(), (1, 3))
        # the last round may not search again: the shopper gets a real answer
        self.assertEqual([c['allow_tool_calls'] for c in self.fake.calls], [True, True, False])
        self.assertIn('do not search again', self.fake.calls[-1]['messages'][-1]['content'][-1]['text'])
        self.assertNotIn('do not search again', json.dumps(self.fake.calls[1]['messages']),
                         'the note is only sent with the last round')
        self.assertEqual(result['reply'], 'Here are some sofas.')

    def test_search_results_include_product_options(self):
        color = self.env['product.attribute'].create({'name': 'AI Test Colour', 'value_ids': [
            (0, 0, {'name': 'Emerald'}), (0, 0, {'name': 'Navy'})]})
        self.env['product.template'].create({
            'name': 'AI Test Velvet Sofa', 'is_published': True, 'sale_ok': True, 'list_price': 900,
            'attribute_line_ids': [(0, 0, {'attribute_id': color.id, 'value_ids': [(6, 0, color.value_ids.ids)]})],
        })
        self.guest()
        self.fake.tool_rounds = 1
        self.fake.tool_query = 'AI Test Velvet Sofa'
        self.ask()
        results = json.loads(self.fake.calls[1]['messages'][-1]['content'][0]['content'])
        sofa = next(p for p in results['products'] if p['name'] == 'AI Test Velvet Sofa')
        self.assertEqual(sofa['options'], {'AI Test Colour': ['Emerald', 'Navy']})

    def test_failed_call_does_not_use_the_allowance(self):
        self.guest()
        self.fake.fail = True
        self.assertIn('error', self.ask())
        self.assertEqual(self.usage()[0], 0)

    def test_request_without_session_cookie_is_refused(self):
        self.authenticate(None, None)
        self.opener.cookies.pop('session_id', None)  # a script that keeps no cookies
        result = self.ask()
        self.assertIn('reload the page', result['error'])
        self.assertFalse(self.fake.calls)

    def test_new_sessions_are_stopped_by_the_ip_limit(self):
        self.website.scita_ai_ip_daily_limit = 3
        for _i in range(3):
            self.guest()  # cookie dropped, new session from a page view: per-session count restarts
            self.assertIn('reply', self.ask())
        self.guest()
        self.assertIn("today's limit", self.ask()['error'])
        self.assertEqual(len(self.fake.calls), 3)

    def test_customer_limit_follows_the_account(self):
        self.website.scita_ai_user_assistant_limit = 4
        self.authenticate('ai_customer', 'ai_customer_pw')
        for _i in range(2):
            self.assertIn('reply', self.ask())
        # another device / session of the same customer
        self.authenticate('ai_customer', 'ai_customer_pw')
        for _i in range(2):
            self.assertIn('reply', self.ask())
        result = self.ask()
        self.assertIn('try again tomorrow', result['error'])
        usage = self.env['scita.ai.usage'].sudo().search([('visitor_key', '=', 'user:%s' % self.customer.id)])
        self.assertEqual(usage.action_count, 4)

    def test_customer_is_not_limited_by_the_ip(self):
        self.website.scita_ai_ip_daily_limit = 1
        self.authenticate('ai_customer', 'ai_customer_pw')
        for _i in range(3):
            self.assertIn('reply', self.ask())

    def test_token_budget(self):
        # 400 tokens per call; budget 2000: guests stop at 80% (1600), customers at 100%
        self.website.scita_ai_daily_token_budget = 2000
        self.guest()
        replies = [self.ask() for _i in range(5)]
        self.assertEqual(sum('reply' in r for r in replies), 4)
        self.assertIn('Log in to your account to keep using it', replies[-1]['error'])
        mails = self.env['mail.mail'].sudo().search([('subject', 'like', 'daily budget')])
        self.assertEqual(len(mails), 1, 'one alert email when crossing 80%')
        self.assertIn(self.website.name, mails.subject)

        self.authenticate('ai_customer', 'ai_customer_pw')
        self.assertIn('reply', self.ask())  # 2000 tokens used now
        self.assertIn('very busy today', self.ask()['error'])
        self.assertEqual(self.env['mail.mail'].sudo().search_count([('subject', 'like', 'daily budget')]), 1,
                         'no second email the same day')

    def test_login_required(self):
        self.authenticate(None, None)
        # the guest page is now in Odoo's page cache (kept an hour)
        self.assertIn('o_scita_assistant_toggle', self.url_open('/').text)
        # saved by the shop owner (a request, so it reaches the page cache as in production)
        self.authenticate('ai_manager', 'ai_manager_pw')
        self.make_jsonrpc_request('/web/dataset/call_kw/website/write', {
            'model': 'website', 'method': 'write',
            'args': [[self.website.id], {'scita_ai_login_required': True}], 'kwargs': {}})
        self.authenticate(None, None)
        page = self.url_open('/').text
        self.assertNotIn('o_scita_assistant_toggle', page)
        self.assertNotIn('o_scita_visual_search_btn', page)
        self.assertIn('not available', self.ask()['error'])
        self.assertFalse(self.fake.calls)

        self.authenticate('ai_customer', 'ai_customer_pw')
        self.assertIn('o_scita_assistant_toggle', self.url_open('/').text)
        self.assertIn('reply', self.ask())

    def test_widgets_shown_to_guests_by_default(self):
        self.authenticate(None, None)
        page = self.url_open('/').text
        self.assertIn('o_scita_assistant_toggle', page)
        self.assertIn('o_scita_visual_search_btn', page)

    def test_history_and_message_size_are_capped(self):
        self.guest()
        history = []
        for i in range(10):
            history += [{'role': 'user', 'content': 'question %s' % i}, {'role': 'assistant', 'content': 'answer %s' % i}]
        self.ask('x' * 3000, history=history)
        sent = self.fake.calls[0]['messages']
        self.assertLessEqual(len(sent), 8)
        self.assertEqual(len(sent[-1]['content']), 500)

    def test_visual_search_limit(self):
        self.guest()
        for _i in range(5):
            self.assertNotIn('error', self.make_jsonrpc_request('/scita/visual_search', {'image': self.png()}))
        result = self.make_jsonrpc_request('/scita/visual_search', {'image': self.png()})
        self.assertIn("today's limit", result['error'])
        self.assertEqual(self.usage('visual_search')[0], 5)
        # the assistant has its own allowance
        self.assertIn('reply', self.ask())

    def test_compare_cached_answer_is_free(self):
        self.guest()
        params = {'product_ids': self.products.ids}
        first = self.make_jsonrpc_request('/scita/compare/explain', params)
        self.assertFalse(first.get('cached'), first)
        for _i in range(6):
            self.assertTrue(self.make_jsonrpc_request('/scita/compare/explain', params).get('cached'))
        self.assertEqual(len(self.fake.calls), 1)
        self.assertEqual(self.usage('compare')[0], 1)

    def test_usage_report_hides_ip_rows(self):
        self.guest()
        self.ask()
        action = self.env.ref('scita_smart_commerce.scita_ai_usage_action')
        rows = self.env['scita.ai.usage'].search(eval(action.domain))  # noqa: S307 - our own constant
        self.assertEqual(sum(rows.mapped('request_count')), 1, 'the IP row must not double the requests')

    def test_settings(self):
        self.guest()
        self.ask()
        settings = self.env['res.config.settings'].create({'website_id': self.website.id})
        self.assertEqual(settings.scita_ai_tokens_today, 400)
        self.assertFalse(settings.scita_ai_proxy_warning)
        settings.scita_ai_guest_assistant_limit = 5
        settings.execute()
        self.assertEqual(self.website.scita_ai_guest_assistant_limit, 5)
        self.env['res.config.settings'].get_views([(False, 'form')])  # the form view still renders
