from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderConfig:
    id: str
    label: str
    base_url: str
    default_model: str
    models: tuple[str, ...]


PROVIDERS: dict[str, ProviderConfig] = {
    "openrouter": ProviderConfig(
        id="openrouter",
        label="OpenRouter",
        base_url="https://openrouter.ai/api/v1",
        default_model="google/gemini-2.5-flash-lite",
        models=(
            "google/gemini-2.5-flash-lite",
            "google/gemini-2.5-flash",
            "openai/gpt-4o-mini",
            "anthropic/claude-3.5-haiku",
        ),
    ),
    "google": ProviderConfig(
        id="google",
        label="Google AI Studio",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai",
        default_model="gemini-2.5-flash-lite",
        models=("gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro"),
    ),
    "openai": ProviderConfig(
        id="openai",
        label="OpenAI",
        base_url="https://api.openai.com/v1",
        default_model="gpt-4o-mini",
        models=("gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"),
    ),
}

DEFAULT_PROVIDER = "openrouter"


def resolve_provider(provider: str | None) -> ProviderConfig:
    return PROVIDERS.get((provider or DEFAULT_PROVIDER).lower(), PROVIDERS[DEFAULT_PROVIDER])