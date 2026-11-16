"""Provider-neutral AI types.

Internal message format (Anthropic-style content blocks), converted by each adapter:
    {'role': 'user'|'assistant', 'content': str | [block, ...]}
    block: {'type': 'text', 'text': ...}
           {'type': 'image', 'source': {'type': 'base64', 'media_type': ..., 'data': ...}}
           {'type': 'tool_use', 'id': ..., 'name': ..., 'input': {...}}
           {'type': 'tool_result', 'tool_use_id': ..., 'content': str, 'is_error': bool}
Tools use the Anthropic definition shape: {'name', 'description', 'input_schema'}.
"""
from dataclasses import dataclass, field


class AIProviderError(Exception):
    """AI call failed. `admin` errors are configuration problems (key, model,
    missing library) that the shop owner must fix; `retryable` ones are transient."""

    def __init__(self, message, admin=False, retryable=False):
        super().__init__(message)
        self.admin = admin
        self.retryable = retryable


@dataclass
class AIToolCall:
    id: str
    name: str
    input: dict


@dataclass
class AIResponse:
    text: str = ''
    tool_calls: list = field(default_factory=list)
    stop_reason: str = ''
    raw_content: list = field(default_factory=list)  # assistant turn to append, internal format
    input_tokens: int = 0
    output_tokens: int = 0


class BaseProvider:
    code = None

    def __init__(self, api_key, model, timeout=30.0):
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def chat(self, system, messages, tools=None, max_tokens=4096, effort='low', json_schema=None,
             allow_tool_calls=True):
        """Return an AIResponse. `json_schema` asks for a JSON object matching the schema
        as the text answer (no tools in that case). `allow_tool_calls=False` keeps the tools
        defined (the history may hold tool calls) but makes the model answer in text."""
        raise NotImplementedError
