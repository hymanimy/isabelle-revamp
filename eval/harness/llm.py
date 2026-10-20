"""Single-request providers. No implicit HTTP retries and no embedded credentials."""
from __future__ import annotations

from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import time
from typing import Protocol

import httpx


@dataclass
class Completion:
    text: str
    prompt_tokens: int
    completion_tokens: int
    model_id: str | None
    wall_s: float
    raw_response: dict | str = field(default_factory=dict)
    request: dict = field(default_factory=dict)
    error: str = ""
    usage_known: bool = True


class Provider(Protocol):
    def complete(self, messages: list[dict], model: str) -> Completion: ...


class OpenAICompatible:
    def __init__(self, *, max_tokens: int = 2048, timeout_s: float = 120,
                 supports_temperature: bool = True, token_parameter: str = "max_completion_tokens",
                 transport: httpx.BaseTransport | None = None):
        if token_parameter not in {"max_tokens", "max_completion_tokens"}:
            raise ValueError("Invalid output token parameter")
        self.max_tokens, self.timeout_s = max_tokens, timeout_s
        self.supports_temperature, self.token_parameter = supports_temperature, token_parameter
        self.transport = transport

    def endpoint(self) -> tuple[str, dict]:
        base = os.environ["OPENAI_BASE_URL"].rstrip("/")
        if not base.endswith("/v1"):
            base += "/v1"
        return base + "/chat/completions", {"Authorization": "Bearer " + os.environ["OPENAI_API_KEY"]}

    def payload(self, messages: list[dict], model: str) -> dict:
        data = {"model": model, "messages": messages, self.token_parameter: self.max_tokens}
        if self.supports_temperature:
            data["temperature"] = 0
        return data

    def decode(self, data: dict) -> tuple[str, int, int, str]:
        return (data["choices"][0]["message"]["content"], data["usage"]["prompt_tokens"],
                data["usage"]["completion_tokens"], data["model"])

    def complete(self, messages: list[dict], model: str) -> Completion:
        start = time.monotonic()
        payload = self.payload(messages, model)
        raw: dict | str = ""
        try:
            url, headers = self.endpoint()
            # No redirects, tool calls, streaming, automatic retries or prompt caching.
            with httpx.Client(timeout=self.timeout_s, transport=self.transport) as client:
                response = client.post(url, headers=headers, json=payload)
            raw = response.text
            response.raise_for_status()
            raw = response.json()
            text, pt, ct, actual = self.decode(raw)
            if not isinstance(text, str) or not actual or min(pt, ct) < 0:
                raise ValueError("Missing text, exact model id, or valid usage")
            return Completion(text, pt, ct, actual, time.monotonic()-start, raw, payload)
        except (httpx.HTTPError, KeyError, ValueError, TypeError, IndexError) as exc:
            # Never serialize exception text that might contain request headers/keys.
            status = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
            known_free = isinstance(exc, KeyError) and raw == "" or status in {400, 401, 403, 404, 422, 429}
            return Completion("", 0, 0, None, time.monotonic()-start, raw, payload,
                              f"{type(exc).__name__}; HTTP status={status}", known_free)


class Anthropic(OpenAICompatible):
    def endpoint(self) -> tuple[str, dict]:
        return "https://api.anthropic.com/v1/messages", {
            "x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"}

    def payload(self, messages: list[dict], model: str) -> dict:
        data = {"model": model, "max_tokens": self.max_tokens,
                "system": "\n".join(m["content"] for m in messages if m["role"] == "system"),
                "messages": [m for m in messages if m["role"] != "system"]}
        if self.supports_temperature:
            data["temperature"] = 0
        return data

    def decode(self, data: dict) -> tuple[str, int, int, str]:
        usage = data["usage"]
        return ("".join(b["text"] for b in data["content"] if b["type"] == "text"),
                usage["input_tokens"], usage["output_tokens"], data["model"])


class Fake:
    def __init__(self, policy: str, proof: str = ""):
        if policy not in {"held_out", "simp", "sorry", "garbage"}:
            raise ValueError("Unknown fake policy")
        self.policy, self.proof, self.calls = policy, proof, 0

    @classmethod
    def from_corpus(cls, policy: str, paths: list[str], lemma_id: str) -> Fake:
        if policy != "held_out":
            return cls(policy)
        for path in paths:
            for line in Path(path).read_text().splitlines():
                row = json.loads(line)
                if row["id"] == lemma_id:
                    return cls(policy, row["held_out_proof"])
        raise ValueError("Fake held-out fixture not found")

    def complete(self, messages: list[dict], model: str) -> Completion:
        self.calls += 1
        text = {"held_out": self.proof, "simp": "by simp", "sorry": "sorry",
                "garbage": "not an XML proof"}[self.policy]
        response = text if self.policy == "garbage" else f"<proof>{text}</proof>"
        return Completion(response, 0, 0, "fake/" + self.policy, 0, {"text": response})
