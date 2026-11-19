"""POST /api/simulate: validated OdeSpec -> fixed SciPy solver -> NDJSON stream.

No model output is executed. The request body is validated against ``OdeSpec`` again (the
client may have been tampered with), each right-hand side is compiled by the allow-listed
``safe_expr`` compiler, and ``solver.solve`` integrates it with time and step limits.

Response (application/x-ndjson): one ``{"t","x","y"}`` line per sample, an optional
``{"status","message","warnings"}`` line if the run stopped early, then ``DONE``.
"""

from __future__ import annotations

import threading

from fastapi import APIRouter, Body
from fastapi.responses import StreamingResponse

from routes.extract import validate_spec
from solver import ndjson_lines, solve

router = APIRouter()

# One solve at a time keeps a local backend responsive.
_LOCK = threading.Lock()


@router.post("/api/simulate")
def simulate(payload: dict = Body(...)) -> StreamingResponse:
    spec = validate_spec(payload)
    with _LOCK:
        sol = solve(spec)
    return StreamingResponse(ndjson_lines(sol), media_type="application/x-ndjson")
