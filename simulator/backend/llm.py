"""Thin wrapper around the Groq chat API. Its output is always treated as untrusted data."""

from __future__ import annotations

import os
import time
from typing import Optional

from fastapi import HTTPException

_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
_client = None


def _get_client():
    global _client
    if _client is None:
        key = os.getenv("GROQ_API_KEY", "").strip()
        if not key:
            raise HTTPException(status_code=503, detail="GROQ_API_KEY is not set in simulator/backend/.env.")
        from groq import Groq

        _client = Groq(api_key=key)
    return _client


def chat_json(system: str, user: str, retries: int = 4, model: Optional[str] = None) -> str:
    """Return the raw text of a JSON-mode completion. Retries on rate limits."""
    client = _get_client()
    delay = 5.0
    for attempt in range(retries):
        try:
            response = client.chat.completions.create(
                model=model or _MODEL,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0,
                max_tokens=2048,
                response_format={"type": "json_object"},
            )
            return response.choices[0].message.content or ""
        except Exception as exc:  # noqa: BLE001 - the SDK raises several types
            msg = str(exc).lower()
            if ("429" in msg or "rate" in msg) and attempt < retries - 1:
                time.sleep(delay)
                delay *= 2
                continue
            raise HTTPException(status_code=502, detail="The Groq API request failed.") from exc
    raise HTTPException(status_code=502, detail="Groq rate limit: retries exhausted.")
