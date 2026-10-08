"""Google Gemini adapter (Generative Language REST API through `requests`,
so no extra Python package is needed)."""
import logging
import time
import uuid

import requests

from .base import AIProviderError, AIResponse, AIToolCall, BaseProvider

_logger = logging.getLogger(__name__)

DEFAULT_MODEL = 'gemini-3.8-flash'
# Google retires models for new accounts (404) and a model can be overloaded (503): then
# the next of these current models answers instead (the setting keeps working)
FALLBACK_MODELS = ('gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest')
# model that answered last time for a configured one (saves a failing call per request)
_working_model = {}
ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent'
# an overloaded model may hang instead of answering 503: give each model at most this many
# seconds, then try the next one, within the provider's overall timeout
ATTEMPT_TIMEOUT = 30.0
# thoughtSignature value Google documents for function calls whose signature is unknown
# (history from another model, or built without one): skips the signature check
SKIP_SIGNATURE = 'skip_thought_signature_validator'

# JSON-schema keys the Gemini `parameters` / `responseSchema` subset does not accept
_UNSUPPORTED_SCHEMA_KEYS = {'additionalProperties', '$schema', 'strict'}


def _error_message(response):
    try:
        return (response.json().get('error') or {}).get('message') or ''
    except ValueError:
        return response.text[:300]


def _clean_schema(schema):
    if isinstance(schema, dict):
        return {k: _clean_schema(v) for k, v in schema.items() if k not in _UNSUPPORTED_SCHEMA_KEYS}
    if isinstance(schema, list):
        return [_clean_schema(v) for v in schema]
    return schema


def _to_gemini_contents(messages, model=None):
    """Internal messages -> Gemini `contents`, for a request to `model`.

    Gemini 3 models return a `thoughtSignature` with their parts (always on the first
    function call of a turn) and require it back, unchanged, on the same part of the history:
    without it the request fails ("Function call is missing a thought_signature"). A
    signature only validates against the model that issued it; for a turn from another
    model (fallback after a 503) or without one, the first function call gets the bypass
    value documented by Google instead.
    """
    tool_names = {}  # tool_use id -> function name (Gemini responses are keyed by name)
    contents = []
    for msg in messages:
        role = 'model' if msg['role'] == 'assistant' else 'user'
        content = msg['content']
        if isinstance(content, str):
            contents.append({'role': role, 'parts': [{'text': content}]})
            continue
        parts = []
        first_call = None
        for b in content:
            signature = b.get('gemini_signature') if b.get('gemini_model') == model else None
            if b['type'] == 'text':
                part = {'text': b['text']}
                if b.get('gemini_thought'):
                    part['thought'] = True
            elif b['type'] == 'image':
                part = {'inlineData': {'mimeType': b['source']['media_type'], 'data': b['source']['data']}}
            elif b['type'] == 'tool_use':
                tool_names[b['id']] = b['name']
                part = {'functionCall': {'name': b['name'], 'args': b['input']}}
                if first_call is None:
                    first_call = part
            elif b['type'] == 'tool_result':
                part = {'functionResponse': {
                    'name': tool_names.get(b['tool_use_id'], 'tool'),
                    'response': {'content': b['content'], 'is_error': bool(b.get('is_error'))},
                }}
            else:
                continue
            if signature:
                part['thoughtSignature'] = signature
            parts.append(part)
        if role == 'model' and first_call is not None and 'thoughtSignature' not in first_call:
            first_call['thoughtSignature'] = SKIP_SIGNATURE
        if parts:
            contents.append({'role': role, 'parts': parts})
    return contents


class GeminiProvider(BaseProvider):
    code = 'gemini'

    def _post(self, build_body):
        """POST the request (`build_body(model)` -> JSON body) to the configured model, or to
        a current one when Google retired it (404), it is overloaded (503) or it does not
        answer in time (timeout, dropped connection). Returns the response and the model that
        answered."""
        candidates = [_working_model.get(self.model, self.model)]
        candidates += [m for m in (self.model, *FALLBACK_MODELS) if m not in candidates]
        last_error = None
        network_error = None
        statuses = set()
        deadline = time.monotonic() + self.timeout
        for model in candidates:
            remaining = deadline - time.monotonic()
            if remaining < 5:
                break  # the shopper has waited long enough
            try:
                # key in a header, not the URL (URLs end up in proxy and server logs)
                r = requests.post(ENDPOINT % model, headers={'x-goog-api-key': self.api_key},
                                  json=build_body(model), timeout=min(ATTEMPT_TIMEOUT, remaining))
            except (requests.Timeout, requests.ConnectionError) as e:
                network_error = e
                _logger.warning('Gemini model %s did not answer (%s: %s): trying another one.',
                                model, type(e).__name__, e)
                continue
            except requests.RequestException as e:
                _logger.warning('Gemini request to %s failed: %s: %s', model, type(e).__name__, e)
                raise AIProviderError('Could not reach the AI service.', retryable=True) from e
            if r.status_code in (401, 403):
                raise AIProviderError('Invalid Gemini API key (%s).' % _error_message(r)[:150], admin=True)
            if r.status_code in (404, 429, 503):
                # 429: this model's request quota (Google counts it per model) is used up
                last_error = r
                statuses.add(r.status_code)
                _logger.warning('Gemini model %s unavailable (%s: %s)%s', model, r.status_code,
                                _error_message(r)[:200],
                                ': trying another one. Update the AI model in Website settings.'
                                if r.status_code == 404 else '')
                continue
            if r.status_code >= 400:
                _logger.warning('Gemini API error %s: %s', r.status_code, r.text[:500])
                raise AIProviderError('The AI service is temporarily unavailable.', retryable=r.status_code >= 500)
            if model != self.model:
                _working_model[self.model] = model
            return r, model
        if 429 in statuses and 503 not in statuses and network_error is None:
            # no model is busy: the key's quota is used up (it resets daily, or needs billing)
            raise AIProviderError('The Gemini API quota of this key is used up (%s). It resets daily; '
                                  'enable billing on the key for more requests.'
                                  % _error_message(last_error)[:120], admin=True)
        if last_error is not None and last_error.status_code in (429, 503):
            raise AIProviderError('The AI service is busy, please try again in a moment.', retryable=True)
        if network_error is not None:
            raise AIProviderError('Could not reach the AI service.', retryable=True) from network_error
        raise AIProviderError('Gemini model "%s" is not available for this API key (%s) and no current model '
                              'answered either: choose another model in Website settings.'
                              % (self.model, _error_message(last_error)[:150] if last_error is not None else ''),
                              admin=True)

    def chat(self, system, messages, tools=None, max_tokens=4096, effort='low', json_schema=None):
        def build_body(model):
            body = {
                'contents': _to_gemini_contents(messages, model),
                'generationConfig': {'maxOutputTokens': max_tokens},
            }
            if system:
                body['systemInstruction'] = {'parts': [{'text': system}]}
            if tools:
                body['tools'] = [{'functionDeclarations': [{
                    'name': t['name'], 'description': t['description'],
                    'parameters': _clean_schema(t['input_schema']),
                } for t in tools]}]
            if json_schema:
                body['generationConfig'].update({'responseMimeType': 'application/json',
                                                 'responseSchema': _clean_schema(json_schema)})
            return body

        r, model = self._post(build_body)
        data = r.json()
        candidate = (data.get('candidates') or [{}])[0]
        if candidate.get('finishReason') in ('SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST'):
            return AIResponse(stop_reason='refusal')
        text_parts, tool_calls, raw = [], [], []
        for part in (candidate.get('content') or {}).get('parts', []):
            # kept with the history and sent back with this part on the next request
            extra = {'gemini_signature': part['thoughtSignature'], 'gemini_model': model} \
                if part.get('thoughtSignature') else {}
            if 'functionCall' in part:
                call_id = 'gm_%s' % uuid.uuid4().hex[:12]
                args = part['functionCall'].get('args') or {}
                tool_calls.append(AIToolCall(id=call_id, name=part['functionCall']['name'], input=args))
                raw.append({'type': 'tool_use', 'id': call_id, 'name': part['functionCall']['name'],
                            'input': args, **extra})
            elif 'text' in part:
                if part.get('thought'):
                    # the model's reasoning summary: history only, never shown to the shopper
                    raw.append({'type': 'text', 'text': part['text'], 'gemini_thought': True, **extra})
                    continue
                text_parts.append(part['text'])
                raw.append({'type': 'text', 'text': part['text'], **extra})
        usage = data.get('usageMetadata') or {}
        return AIResponse(
            text='\n'.join(text_parts).strip(),
            tool_calls=tool_calls,
            stop_reason='tool_use' if tool_calls else 'end_turn',
            raw_content=raw,
            input_tokens=usage.get('promptTokenCount', 0),
            output_tokens=usage.get('candidatesTokenCount', 0),
        )
