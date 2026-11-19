import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("SCISYNTH_REVIEW", raising=False)
    from fastapi.testclient import TestClient

    import main

    return TestClient(main.app)


def harmonic(**over):
    spec = {
        "spec_version": 1,
        "eq_type": "ODE",
        "description": "harmonic oscillator",
        "state": ["x", "v"],
        "params": {"k": 4.0, "m": 1.0},
        "equations": {"x": "v", "v": "-(k/m)*x"},
        "initial": {"x": 1.0, "v": 0.0},
        "t_span": [0.0, 10.0],
        "t_points": 501,
        "plot": ["t", "x"],
        "method": "RK45",
    }
    spec.update(over)
    return spec
