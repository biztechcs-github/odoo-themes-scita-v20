"""OpenAI adapter (official `openai` Python SDK, Chat Completions API)."""
import json
import logging

from .base import AIProviderError, AIResponse, AIToolCall, BaseProvider

_logger = logging.getLogger(__name__)

DEFAULT_MODEL = 'gpt-5'


def _to_openai_messages(system, messages):
    out = [{'role': 'system', 'content': system}] if system else []
    for msg in messages:
        content = msg['content']
        if isinstance(content, str):
            out.append({'role': msg['role'], 'content': content})
            continue
        if msg['role'] == 'assistant':
            text = ''.join(b.get('text', '') for b in content if b['type'] == 'text')
            calls = [{
                'id': b['id'], 'type': 'function',
                'function': {'name': b['name'], 'arguments': json.dumps(b['input'])},
            } for b in content if b['type'] == 'tool_use']
            entry = {'role': 'assistant', 'content': text or None}
            if calls:
                entry['tool_calls'] = calls
            out.append(entry)
            continue
        parts = []
        for b in content:
            if b['type'] == 'tool_result':
                out.append({'role': 'tool', 'tool_call_id': b['tool_use_id'], 'content': b['content']})
            elif b['type'] == 'text':
                parts.append({'type': 'text', 'text': b['text']})
            elif b['type'] == 'image':
                src = b['source']
                parts.append({'type': 'image_url', 'image_url': {
                    'url': 'data:%s;base64,%s' % (src['media_type'], src['data'])}})
        if parts:
            out.append({'role': 'user', 'content': parts})
    return out


class OpenAIProvider(BaseProvider):
    code = 'openai'

    def chat(self, system, messages, tools=None, max_tokens=4096, effort='low', json_schema=None):
        try:
            import openai  # noqa: PLC0415 - optional dependency, only needed for this provider
        except ImportError as e:
            raise AIProviderError("The 'openai' Python package is not installed on the server "
                                  "(pip install openai).", admin=True) from e
        client = openai.OpenAI(api_key=self.api_key, timeout=self.timeout, max_retries=2)
        params = {
            'model': self.model,
            'messages': _to_openai_messages(system, messages),
            'max_completion_tokens': max_tokens,
        }
        if tools:
            params['tools'] = [{'type': 'function', 'function': {
                'name': t['name'], 'description': t['description'], 'parameters': t['input_schema'],
            }} for t in tools]
        if json_schema:
            params['response_format'] = {'type': 'json_schema', 'json_schema': {'name': 'result', 'schema': json_schema}}
        try:
            response = client.chat.completions.create(**params)
        except openai.AuthenticationError as e:
            raise AIProviderError('Invalid OpenAI API key.', admin=True) from e
        except openai.NotFoundError as e:
            raise AIProviderError('Unknown OpenAI model: %s' % self.model, admin=True) from e
        except openai.RateLimitError as e:
            raise AIProviderError('The AI service is busy, please try again in a moment.', retryable=True) from e
        except openai.BadRequestError as e:
            _logger.warning('OpenAI bad request: %s', e)
            raise AIProviderError('The AI request was rejected.', admin=True) from e
        except openai.APIError as e:
            _logger.warning('OpenAI API error: %s', e)
            raise AIProviderError('The AI service is temporarily unavailable.', retryable=True) from e

        choice = response.choices[0]
        msg = choice.message
        tool_calls = []
        raw = []
        if msg.content:
            raw.append({'type': 'text', 'text': msg.content})
        for call in msg.tool_calls or []:
            try:
                args = json.loads(call.function.arguments or '{}')
            except ValueError:
                args = {}
            tool_calls.append(AIToolCall(id=call.id, name=call.function.name, input=args))
            raw.append({'type': 'tool_use', 'id': call.id, 'name': call.function.name, 'input': args})
        usage = response.usage
        return AIResponse(
            text=(msg.content or '').strip(),
            tool_calls=tool_calls,
            stop_reason='tool_use' if tool_calls else ('refusal' if getattr(msg, 'refusal', None) else 'end_turn'),
            raw_content=raw,
            input_tokens=usage.prompt_tokens if usage else 0,
            output_tokens=usage.completion_tokens if usage else 0,
        )
