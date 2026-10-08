"""Anthropic Claude adapter (official `anthropic` Python SDK).

The internal message format used by `scita.ai` is the Anthropic one (content blocks
of type text / image / tool_use / tool_result), so this adapter passes messages
through unchanged.
"""
import logging

from .base import AIProviderError, AIResponse, AIToolCall, BaseProvider

_logger = logging.getLogger(__name__)

# Models offered in the settings. claude-opus-5-5 is the default.
MODELS = [
    ('claude-opus-5-5', 'Claude Opus 5.5'),
    ('claude-sonnet-5-5', 'Claude Sonnet 5.5'),
    ('claude-opus-5', 'Claude Opus 5'),
    ('claude-haiku-4-5', 'Claude Haiku 4.5'),
]
DEFAULT_MODEL = 'claude-opus-5-5'

# Server-side refusal fallbacks ("default" routing) on the Claude API.
FALLBACK_MODELS = {'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5'}
FALLBACK_BETA = 'server-side-fallback-2026-07-01'
# output_config.effort is rejected on Haiku 4.5.
NO_EFFORT_MODELS = {'claude-haiku-4-5'}


class AnthropicProvider(BaseProvider):
    code = 'anthropic'

    def _client(self):
        try:
            import anthropic  # noqa: PLC0415 - optional dependency, only needed for this provider
        except ImportError as e:
            raise AIProviderError(
                "The 'anthropic' Python package is not installed on the server "
                "(pip install anthropic).", admin=True) from e
        return anthropic, anthropic.Anthropic(api_key=self.api_key, timeout=self.timeout, max_retries=2)

    def chat(self, system, messages, tools=None, max_tokens=4096, effort='low', json_schema=None):
        anthropic, client = self._client()
        params = {
            'model': self.model,
            'max_tokens': max_tokens,
            'system': system,
            'messages': messages,
        }
        if tools:
            params['tools'] = tools
        output_config = {}
        if effort and self.model not in NO_EFFORT_MODELS:
            output_config['effort'] = effort
        if json_schema:
            output_config['format'] = {'type': 'json_schema', 'schema': json_schema}
        if output_config:
            params['output_config'] = output_config
        if self.model in FALLBACK_MODELS:
            params['betas'] = [FALLBACK_BETA]
            params['fallbacks'] = 'default'
        try:
            response = client.beta.messages.create(**params)
        except anthropic.AuthenticationError as e:
            raise AIProviderError('Invalid Anthropic API key.', admin=True) from e
        except anthropic.PermissionDeniedError as e:
            raise AIProviderError('The Anthropic API key is not allowed to use this model.', admin=True) from e
        except anthropic.NotFoundError as e:
            raise AIProviderError('Unknown Anthropic model: %s' % self.model, admin=True) from e
        except anthropic.RateLimitError as e:
            raise AIProviderError('The AI service is busy, please try again in a moment.', retryable=True) from e
        except anthropic.BadRequestError as e:
            _logger.warning('Anthropic bad request: %s', e.message)
            raise AIProviderError('The AI request was rejected.', admin=True) from e
        except anthropic.APIStatusError as e:
            _logger.warning('Anthropic API error %s: %s', e.status_code, e.message)
            raise AIProviderError('The AI service is temporarily unavailable.', retryable=True) from e
        except anthropic.APIConnectionError as e:
            raise AIProviderError('Could not reach the AI service.', retryable=True) from e

        # A refusal (after server-side fallbacks, when enabled) carries no usable answer.
        if response.stop_reason == 'refusal':
            return AIResponse(text='', stop_reason='refusal', raw_content=[],
                              input_tokens=response.usage.input_tokens, output_tokens=response.usage.output_tokens)

        text_parts, tool_calls = [], []
        for block in response.content:
            if block.type == 'text':
                text_parts.append(block.text)
            elif block.type == 'tool_use':
                tool_calls.append(AIToolCall(id=block.id, name=block.name, input=block.input))
        return AIResponse(
            text='\n'.join(text_parts).strip(),
            tool_calls=tool_calls,
            stop_reason=response.stop_reason,
            # appended back verbatim as the assistant turn (keeps tool_use ids, thinking blocks)
            raw_content=[block.model_dump(exclude_none=True) for block in response.content
                         if block.type in ('text', 'tool_use', 'thinking', 'redacted_thinking')],
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )
