"""Simulation endpoint.

The earlier prototype executed LLM-generated Python. That path is removed: this module
never runs model output (no subprocess, exec or eval).

Planned safe solver (to be added here):
  1. The LLM returns a JSON equation spec (see models.Manifest; a spec model will extend it).
  2. A deterministic, whitelisted parser turns the spec into a right-hand-side function.
  3. A fixed SciPy solver (solve_ivp) integrates it and streams {"t", "x", "y"} NDJSON lines,
     followed by a final "DONE" line.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from models import Manifest

router = APIRouter()

DISABLED_MESSAGE = (
    "Simulation is disabled pending a safe solver (no LLM-generated code is executed)"
)


@router.post("/api/simulate", status_code=501)
def simulate(manifest: Manifest) -> None:
    raise HTTPException(status_code=501, detail=DISABLED_MESSAGE)
