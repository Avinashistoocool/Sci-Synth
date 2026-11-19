"""Numerical correctness and resource limits of the fixed solver."""

import time

import numpy as np
import pytest
from pydantic import ValidationError

from conftest import harmonic
from models import OdeSpec
from solver import ndjson_lines, solve


def test_harmonic_oscillator_matches_analytic():
    spec = OdeSpec.model_validate(harmonic())
    sol = solve(spec)
    assert sol.status == "ok"
    assert len(sol.t) == 501
    np.testing.assert_allclose(sol.y, np.cos(2.0 * sol.t), atol=1e-4)


def test_damped_pendulum_small_angle_matches_linearised_solution():
    g, L, c, th0 = 9.81, 1.0, 0.5, 0.01
    spec = OdeSpec.model_validate(
        {
            "state": ["theta", "omega"],
            "params": {"g": g, "L": L, "c": c},
            "equations": {"theta": "omega", "omega": "-(g/L)*sin(theta) - c*omega"},
            "initial": {"theta": th0, "omega": 0.0},
            "t_span": [0, 10],
            "t_points": 1000,
            "plot": ["t", "theta"],
        }
    )
    sol = solve(spec)
    assert sol.status == "ok"
    w0 = np.sqrt(g / L)
    gamma = c / 2
    wd = np.sqrt(w0**2 - gamma**2)
    expected = th0 * np.exp(-gamma * sol.t) * (np.cos(wd * sol.t) + gamma / wd * np.sin(wd * sol.t))
    np.testing.assert_allclose(sol.y, expected, atol=2e-5)
    assert abs(sol.y[-1]) < th0 * 0.1  # envelope exp(-2.5) ~ 0.08


def test_lotka_volterra_conserves_invariant():
    a, b, c, d = 1.0, 0.1, 1.5, 0.075
    spec = OdeSpec.model_validate(
        {
            "state": ["prey", "pred"],
            "params": {"a": a, "b": b, "c": c, "d": d},
            "equations": {"prey": "a*prey - b*prey*pred", "pred": "d*prey*pred - c*pred"},
            "initial": {"prey": 10.0, "pred": 5.0},
            "t_span": [0, 15],
            "t_points": 800,
            "plot": ["prey", "pred"],
            "method": "RK45",
        }
    )
    sol = solve(spec)
    assert sol.status == "ok"
    x, y = sol.x, sol.y
    V = d * x - c * np.log(x) + b * y - a * np.log(y)
    np.testing.assert_allclose(V, V[0], rtol=1e-4)
    # Equilibrium is (c/d, a/b) = (20, 10); the orbit must go around it.
    assert x.min() < 20 < x.max() and y.min() < 10 < y.max()


def test_stiff_system_lsoda():
    spec = OdeSpec.model_validate(
        {
            "state": ["y1", "y2", "y3"],
            "params": {},
            "equations": {
                "y1": "-0.04*y1 + 1e4*y2*y3",
                "y2": "0.04*y1 - 1e4*y2*y3 - 3e7*y2**2",
                "y3": "3e7*y2**2",
            },
            "initial": {"y1": 1.0, "y2": 0.0, "y3": 0.0},
            "t_span": [0, 40],
            "t_points": 100,
            "plot": ["t", "y1"],
            "method": "LSODA",
        }
    )
    sol = solve(spec, timeout_s=20)
    assert sol.status == "ok"
    assert sol.y[-1] == pytest.approx(0.7158, abs=1e-3)  # Robertson problem, known value at t=40


def test_diverging_system_ends_gracefully():
    spec = OdeSpec.model_validate(
        harmonic(state=["y"], params={}, equations={"y": "y**2"}, initial={"y": 1.0}, t_span=[0, 2], plot=["t", "y"])
    )
    sol = solve(spec)
    assert sol.status in ("diverged", "stopped")
    assert np.all(np.isfinite(sol.y))
    lines = list(ndjson_lines(sol))
    assert lines[-1] == "DONE\n"
    assert '"status"' in lines[-2]


def test_timeout_is_enforced():
    spec = OdeSpec.model_validate(harmonic(t_span=[0, 1e6], t_points=5000))
    start = time.monotonic()
    sol = solve(spec, timeout_s=0.5)
    assert time.monotonic() - start < 5
    assert sol.status == "stopped"
    assert "time limit" in sol.message


def test_rhs_call_budget():
    sol = solve(OdeSpec.model_validate(harmonic()), max_rhs_calls=50)
    assert sol.status == "stopped" and "evaluations" in sol.message


def test_ndjson_format():
    sol = solve(OdeSpec.model_validate(harmonic(t_points=3)))
    lines = list(ndjson_lines(sol))
    assert lines == [
        '{"t": 0.0, "x": 0.0, "y": 1.0}\n',
        lines[1],
        lines[2],
        "DONE\n",
    ]
    assert lines[2].startswith('{"t": 10.0')


@pytest.mark.parametrize(
    "over",
    [
        {"state": [f"s{i}" for i in range(9)]},
        {"t_points": 5001},
        {"t_points": 1},
        {"t_points": True},
        {"t_points": 10.5},
        {"params": {"k": float("inf"), "m": 1.0}},
        {"params": {"k": float("nan"), "m": 1.0}},
        {"params": {"k": "4", "m": 1.0}},
        {"params": {"k": 1e13, "m": 1.0}},
        {"params": {f"p{i}": 1.0 for i in range(33)}},
        {"initial": {"x": float("inf"), "v": 0.0}},
        {"initial": {"x": 1.0}},
        {"t_span": [0, 1e7]},
        {"t_span": [5, 1]},
        {"t_span": [0, 1, 2]},
        {"equations": {"x": "v"}},
        {"equations": {"x": "v", "v": 3}},
        {"plot": ["t", "z"]},
        {"state": ["x", "x"]},
        {"state": ["import", "v"]},
        {"state": ["t", "v"]},
        {"state": ["__class__", "v"]},
        {"params": {"x": 1.0, "k": 4.0, "m": 1.0}},
        {"method": "Radau"},
        {"spec_version": 2},
        {"eq_type": "PDE"},
        {"code": "print(1)"},
        {"description": "x" * 501},
        {"equations": {"x": "v", "v": "__import__('os').system('calc')"}},
    ],
)
def test_spec_limits_rejected(over):
    with pytest.raises(ValidationError):
        OdeSpec.model_validate(harmonic(**over))
