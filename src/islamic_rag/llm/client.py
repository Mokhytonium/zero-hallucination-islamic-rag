import json
import time
from collections.abc import Iterator
from dataclasses import dataclass

import httpx
from pydantic import SecretStr

from .sanitize import redact_secrets

_MAX_RETRY_WAIT_S = 30.0


@dataclass
class CompletionResult:
    content: str
    prompt_tokens: int
    completion_tokens: int
    model: str


def _error_detail(resp: httpx.Response, key: str) -> str:
    try:
        err = resp.json().get("error", {})
        msg = err.get("message", "") if isinstance(err, dict) else str(err)
    except (ValueError, AttributeError):
        msg = resp.text
    msg = msg or resp.reason_phrase or ""
    return redact_secrets(msg, key)[:200]


class OpenAICompatClient:
    """BYOK OpenAI-compatible chat client. The key is supplied per request by the
    caller (X-LLM-Key); it is never read from project settings, never logged, and
    redacted from every error message. trust_env=False bypasses the local NO_PROXY
    quirk that otherwise breaks loopback calls."""

    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        *,
        timeout: float = 90.0,
        max_retry_wait_s: float = _MAX_RETRY_WAIT_S,
    ) -> None:
        if not api_key:
            raise ValueError("کلید API ارائه نشده است.")
        self._key = SecretStr(api_key)
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.max_retry_wait_s = max_retry_wait_s

    @property
    def key(self) -> SecretStr:
        return self._key

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._key.get_secret_value()}",
            "Content-Type": "application/json",
        }

    def _body(
        self,
        messages: list[dict],
        temperature: float,
        max_tokens: int,
        response_format: dict | None,
        stream: bool,
    ) -> dict:
        body: dict = {
            "model": self.model,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "messages": messages,
            "stream": stream,
        }
        if response_format is not None:
            body["response_format"] = response_format
        return body

    def complete(
        self,
        messages: list[dict],
        *,
        temperature: float = 0.0,
        max_tokens: int = 2500,
        response_format: dict | None = None,
    ) -> CompletionResult:
        body = self._body(messages, temperature, max_tokens, response_format, stream=False)
        key = self._key.get_secret_value()
        waited = 0.0
        for attempt in range(5):
            try:
                resp = httpx.post(
                    f"{self.base_url}/chat/completions",
                    json=body,
                    headers=self._headers(),
                    timeout=self.timeout,
                    trust_env=False,
                )
            except httpx.HTTPError as exc:
                delay = 2 * (attempt + 1)
                if waited + delay > self.max_retry_wait_s:
                    raise RuntimeError(
                        f"ارتباط با مدل برقرار نشد: {redact_secrets(str(exc), key)}"
                    ) from exc
                time.sleep(delay)
                waited += delay
                continue
            if resp.status_code == 429 or resp.status_code >= 500:
                try:
                    delay = float(resp.headers.get("retry-after", "")) + 1
                except ValueError:
                    delay = 3 * (attempt + 1)
                delay = min(delay, 30)
                if waited + delay > self.max_retry_wait_s:
                    raise RuntimeError(
                        f"مدل در دسترس نیست (HTTP {resp.status_code})؛ سقف انتظار پر شد."
                    )
                time.sleep(delay)
                waited += delay
                continue
            if resp.status_code >= 400:
                raise RuntimeError(f"مدل HTTP {resp.status_code}: {_error_detail(resp, key)}")
            data = resp.json()
            usage = data.get("usage", {})
            content = data["choices"][0]["message"]["content"] or ""
            return CompletionResult(
                content=content,
                prompt_tokens=usage.get("prompt_tokens", 0),
                completion_tokens=usage.get("completion_tokens", 0),
                model=data.get("model", self.model),
            )
        raise RuntimeError("مدل پس از چند تلاش پاسخ نداد.")

    def stream(
        self,
        messages: list[dict],
        *,
        temperature: float = 0.0,
        max_tokens: int = 2500,
    ) -> Iterator[str]:
        body = self._body(messages, temperature, max_tokens, None, stream=True)
        key = self._key.get_secret_value()
        with httpx.stream(
            "POST",
            f"{self.base_url}/chat/completions",
            json=body,
            headers=self._headers(),
            timeout=self.timeout,
            trust_env=False,
        ) as resp:
            if resp.status_code >= 400:
                resp.read()
                raise RuntimeError(f"مدل HTTP {resp.status_code}: {_error_detail(resp, key)}")
            for line in resp.iter_lines():
                if not line or not line.startswith("data:"):
                    continue
                payload = line[len("data:") :].strip()
                if payload == "[DONE]":
                    break
                try:
                    chunk = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta", {}).get("content")
                if delta:
                    yield delta

    def list_models(self) -> list[dict]:
        """Fetch the provider's active model catalogue (GET /models). The BYOK key
        travels only in the Authorization header; every error is redacted."""
        key = self._key.get_secret_value()
        try:
            resp = httpx.get(
                f"{self.base_url}/models",
                headers=self._headers(),
                timeout=self.timeout,
                trust_env=False,
            )
        except httpx.HTTPError as exc:
            raise RuntimeError(
                f"دریافت لیست مدل‌ها ممکن نشد: {redact_secrets(str(exc), key)}"
            ) from exc
        if resp.status_code >= 400:
            raise RuntimeError(f"لیست مدل‌ها HTTP {resp.status_code}: {_error_detail(resp, key)}")
        data = resp.json()
        items = data.get("data") if isinstance(data, dict) else data
        if not isinstance(items, list):
            return []
        return [m for m in items if isinstance(m, dict)]