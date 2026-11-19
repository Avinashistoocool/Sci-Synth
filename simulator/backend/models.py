from __future__ import annotations

from typing import Dict, Tuple

from pydantic import BaseModel, validator

_VALID_EQ_TYPES = {"ODE", "PDE", "quantum", "statistical"}


class Manifest(BaseModel):
    eq_type: str = "ODE"
    description: str
    variables: Dict[str, float]
    t_span: Tuple[float, float]
    t_points: int

    @validator("eq_type", pre=True)
    def coerce_eq_type(cls, v: str) -> str:
        return v if v in _VALID_EQ_TYPES else "ODE"

    @validator("t_points", pre=True)
    def clamp_t_points(cls, v: int) -> int:
        return max(100, min(5000, int(v)))

    @validator("variables", pre=True)
    def coerce_variable_values(cls, v: dict) -> dict:
        return {k: float(val) for k, val in v.items()}
