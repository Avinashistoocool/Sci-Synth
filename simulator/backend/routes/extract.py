from __future__ import annotations

import io
import json
import os
import re
import time

import pypdf
from fastapi import APIRouter, File, HTTPException, UploadFile
from groq import Groq

from models import Manifest

router = APIRouter()

_API_KEY = os.getenv("GROQ_API_KEY")
if not _API_KEY:
    raise RuntimeError(
        "GROQ_API_KEY is not set. Add it to backend/.env before starting the server."
    )

_client = Groq(api_key=_API_KEY)
_MAX_BYTES = 20 * 1024 * 1024  # 20 MB
_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
# Groq free tier: 14 400 req/day, 6 000 tokens/min — much more generous than Gemini free tier.


def _extract_pdf_text(pdf_bytes: bytes) -> str:
    """Extract plain text from a PDF using pypdf."""
    reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    pages = [page.extract_text() or "" for page in reader.pages]
    text = "\n\n".join(pages)
    # Truncate to ~80 000 chars to stay well inside the 128 k-token context window.
    return text[:80_000]


def _call_with_backoff(prompt: str, retries: int = 4) -> str:
    """Call Groq chat completions with exponential back-off on 429s."""
    delay = 10.0
    for attempt in range(retries):
        try:
            response = _client.chat.completions.create(
                model=_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
            )
            return response.choices[0].message.content or ""
        except Exception as exc:
            msg = str(exc)
            is_quota = "429" in msg or "quota" in msg.lower() or "rate" in msg.lower()
            if is_quota and attempt < retries - 1:
                time.sleep(delay)
                delay *= 2
                continue
            raise HTTPException(status_code=502, detail=f"Groq API error: {exc}") from exc
    raise HTTPException(status_code=502, detail="Groq quota exceeded after retries.")


EXTRACT_PROMPT = """\
You are a physics equation extractor. Read this research paper and identify the core \
dynamical system suitable for numerical simulation.

Return ONLY a single valid JSON object — no markdown fences, no prose, nothing else — \
with this exact structure:

{{
  "eq_type": "ODE",
  "description": "one sentence telling a SciPy solver exactly what physics to simulate",
  "variables": {{"python_safe_name": numeric_value}},
  "t_span": [start_float, end_float],
  "t_points": integer
}}

Rules:
- eq_type must be one of: ODE, PDE, quantum, statistical
- Every key in variables must be a valid Python identifier (theta not θ, alpha not α)
- Every value in variables must be a bare number (no units, no strings)
- t_points must be between 100 and 5000
- description must guide a SciPy solver: mention the physical system and key equation

--- PAPER TEXT ---
{paper_text}
--- END PAPER TEXT ---
"""


@router.post("/api/extract")
def extract(file: UploadFile = File(...)) -> Manifest:
    if file.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted.")

    pdf_bytes = file.file.read()
    if len(pdf_bytes) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 20 MB limit.")

    paper_text = _extract_pdf_text(pdf_bytes)
    if not paper_text.strip():
        raise HTTPException(status_code=422, detail="Could not extract any text from the PDF.")

    prompt = EXTRACT_PROMPT.format(paper_text=paper_text)
    raw = _call_with_backoff(prompt).strip()

    # Strip accidental markdown fences
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    raw = re.sub(r"\s*```\s*$", "", raw, flags=re.MULTILINE)

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Groq returned non-JSON. Raw response: {raw[:300]}",
        ) from exc

    try:
        manifest = Manifest(**payload)
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"Manifest validation failed: {exc}"
        ) from exc

    return manifest
