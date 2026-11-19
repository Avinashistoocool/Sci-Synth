from __future__ import annotations

import json
import os
import re
import subprocess
import sys

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from groq import Groq

from models import Manifest

router = APIRouter()

_API_KEY = os.getenv("GROQ_API_KEY")
if not _API_KEY:
    raise RuntimeError(
        "GROQ_API_KEY is not set. Add it to backend/.env before starting the server."
    )

_client = Groq(api_key=_API_KEY)
_MAX_RETRIES = 3
_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

CODEGEN_PROMPT = """\
Write a self-contained Python script that numerically simulates the following:

{description}

Physical parameters (use these exact variable names and values):
{variables}

Simulation time span: {t_start} to {t_end} with {t_points} evenly-spaced points.
Equation type hint: {eq_type}

STRICT requirements — the script must:
1. Import ONLY numpy, scipy, and math (no other packages)
2. Use scipy.integrate.solve_ivp (preferred) or scipy.integrate.odeint
3. For EVERY time point, print exactly one JSON line:
       {{"t": <float>, "x": <float>, "y": <float>}}
   where x and y are the two most physically meaningful state variables
4. Print the string DONE as the very last line
5. Produce NO other output whatsoever (no progress bars, no headers, no blank lines)
6. Require NO user input — run completely unattended

Return ONLY the Python source code. No markdown fences. No explanation.
"""

FIX_PROMPT = """\
The Python simulation script below failed with this error:

--- ERROR ---
{error}
--- END ERROR ---

--- SCRIPT ---
{code}
--- END SCRIPT ---

Fix every bug. Return ONLY the corrected Python source code. No markdown fences.
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _clean_code(raw: str) -> str:
    """Strip markdown fences that the model sometimes adds."""
    raw = re.sub(r"^```(?:python)?\s*", "", raw.strip(), flags=re.MULTILINE)
    raw = re.sub(r"\s*```\s*$", "", raw, flags=re.MULTILINE)
    return raw.strip()


def _chat(prompt: str) -> str:
    response = _client.chat.completions.create(
        model=_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
    )
    return response.choices[0].message.content or ""


def _generate_code(manifest: Manifest) -> str:
    variables_block = "\n".join(
        f"  {k} = {v}" for k, v in manifest.variables.items()
    )
    prompt = CODEGEN_PROMPT.format(
        description=manifest.description,
        variables=variables_block,
        t_start=manifest.t_span[0],
        t_end=manifest.t_span[1],
        t_points=manifest.t_points,
        eq_type=manifest.eq_type,
    )
    return _clean_code(_chat(prompt))


def _fix_code(code: str, error: str) -> str:
    prompt = FIX_PROMPT.format(error=error, code=code)
    return _clean_code(_chat(prompt))


def _run_code(code: str) -> dict:
    """Execute the generated script in a stripped subprocess. Returns
    {"success": True, "lines": [...]} or {"success": False, "error": "..."}."""
    # Provide only the minimal environment needed for Python to execute.
    # On Windows SYSTEMROOT / TEMP are required for the stdlib to load.
    safe_env = {k: os.environ[k] for k in ("PATH", "SYSTEMROOT", "TEMP", "TMP") if k in os.environ}

    try:
        proc = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            timeout=30,
            env=safe_env,
        )
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Simulation timed out after 30 seconds."}

    if proc.returncode != 0:
        # Include stderr in the error message, falling back to the exit code.
        # We deliberately do NOT fail on stderr alone: scipy/numpy routinely emit
        # IntegrationWarning / RuntimeWarning to stderr while still exiting 0 and
        # producing valid output.  Treating warnings as errors would cause the
        # retry loop to burn three API calls and then surface a false failure.
        return {"success": False, "error": proc.stderr or f"Exit code {proc.returncode}"}

    lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    return {"success": True, "lines": lines}


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post("/api/simulate")
def simulate(manifest: Manifest) -> StreamingResponse:
    def generate():
        code = _generate_code(manifest)
        error: str | None = None

        for attempt in range(_MAX_RETRIES):
            result = _run_code(code)

            if result["success"]:
                for line in result["lines"]:
                    yield line + "\n"
                return

            error = result["error"]
            if attempt < _MAX_RETRIES - 1:
                try:
                    code = _fix_code(code, error)
                except Exception as exc:
                    error = f"Groq fix call failed: {exc}"
                    break

        # All retries exhausted — surface the last error to the frontend
        yield json.dumps({"error": error}) + "\n"
        yield "DONE\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")
