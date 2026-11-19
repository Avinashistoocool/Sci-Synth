"""Fixed numerical solver for a validated OdeSpec.

Only SciPy's ``solve_ivp`` runs here, with a right-hand side assembled from closures built by
``safe_expr``. Resource limits: wall-clock timeout checked on every RHS call, a cap on RHS
evaluations, ``max_step``, and a terminal event when the state leaves a finite bound.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Iterator, List, Optional

import numpy as np
from scipy.integrate import solve_ivp

from models import OdeSpec
from safe_expr import TIME_NAME, compile_expression

TIMEOUT_S = 5.0
MAX_RHS_CALLS = 2_000_000
STATE_BOUND = 1e12


class SolverAbort(RuntimeError):
    """Raised inside the RHS to stop the integration (timeout, budget or non-finite values)."""


@dataclass
class Solution:
    t: np.ndarray
    x: np.ndarray
    y: np.ndarray
    status: str  # "ok" | "diverged" | "stopped"
    message: str = ""
    warnings: List[str] = field(default_factory=list)


def _axis(name: str, t: np.ndarray, ys: np.ndarray, index: dict) -> np.ndarray:
    return t if name == TIME_NAME else ys[index[name]]


def solve(spec: OdeSpec, timeout_s: float = TIMEOUT_S, max_rhs_calls: int = MAX_RHS_CALLS) -> Solution:
    names = list(spec.state) + list(spec.params)
    rhs_funcs = [compile_expression(spec.equations[v], names) for v in spec.state]
    env = dict(spec.params)
    state = list(spec.state)
    deadline = time.monotonic() + timeout_s
    calls = 0

    def rhs(t: float, y: np.ndarray) -> np.ndarray:
        nonlocal calls
        calls += 1
        if calls > max_rhs_calls:
            raise SolverAbort(f"stopped after {max_rhs_calls} right-hand-side evaluations")
        if time.monotonic() > deadline:
            raise SolverAbort(f"stopped after the {timeout_s:g} s time limit")
        env[TIME_NAME] = float(t)
        for name, value in zip(state, y):
            env[name] = float(value)
        with np.errstate(all="ignore"):
            out = np.array([float(f(env)) for f in rhs_funcs], dtype=float)
        if not np.all(np.isfinite(out)):
            raise SolverAbort(f"non-finite derivative at t = {t:.6g}")
        return out

    def bound(t: float, y: np.ndarray) -> float:
        if not np.all(np.isfinite(y)):
            return -1.0
        return STATE_BOUND - float(np.max(np.abs(y)))

    bound.terminal = True  # type: ignore[attr-defined]
    bound.direction = -1  # type: ignore[attr-defined]

    t0, t1 = spec.t_span
    t_eval = np.linspace(t0, t1, spec.t_points)
    y0 = np.array([spec.initial[v] for v in state], dtype=float)
    index = {v: i for i, v in enumerate(state)}

    try:
        sol = solve_ivp(
            rhs,
            (t0, t1),
            y0,
            method=spec.method,
            t_eval=t_eval,
            events=bound,
            max_step=(t1 - t0) / 100.0,
            rtol=1e-6,
            atol=1e-9,
        )
    except SolverAbort as exc:
        empty = np.empty(0)
        return Solution(empty, empty, empty, status="stopped", message=str(exc))

    ys = sol.y
    t = sol.t
    finite = np.all(np.isfinite(ys), axis=0) if ys.size else np.zeros(0, dtype=bool)
    t, ys = t[finite], ys[:, finite]

    status, message = "ok", ""
    if sol.status == 1:
        status, message = "diverged", f"state exceeded |y| > {STATE_BOUND:g}; integration stopped early"
    elif sol.status != 0:
        status, message = "stopped", f"solver did not finish: {sol.message}"

    return Solution(
        t=t,
        x=_axis(spec.plot[0], t, ys, index),
        y=_axis(spec.plot[1], t, ys, index),
        status=status,
        message=message,
    )


def ndjson_lines(sol: Solution, warnings: Optional[List[str]] = None) -> Iterator[str]:
    """Yield ``{"t","x","y"}`` lines, an optional ``{"status",...}`` line, then ``DONE``."""
    for t, x, y in zip(sol.t, sol.x, sol.y):
        yield json.dumps({"t": float(t), "x": float(x), "y": float(y)}) + "\n"
    if sol.status != "ok" or warnings:
        yield json.dumps({"status": sol.status, "message": sol.message, "warnings": warnings or []}) + "\n"
    yield "DONE\n"
