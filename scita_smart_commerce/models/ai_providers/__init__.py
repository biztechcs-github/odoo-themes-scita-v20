from .base import AIProviderError, AIResponse, AIToolCall  # noqa: F401
from .anthropic_provider import AnthropicProvider
from .gemini_provider import GeminiProvider
from .openai_provider import OpenAIProvider

PROVIDERS = {
    'anthropic': AnthropicProvider,
    'openai': OpenAIProvider,
    'gemini': GeminiProvider,
}

# Python package each provider needs on the server (None: plain `requests`, always there)
PYTHON_PACKAGES = {
    'anthropic': 'anthropic',
    'openai': 'openai',
    'gemini': None,
}
