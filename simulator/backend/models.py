"""Pydantic models for the declarative ODE spec (spec_version 1).

The spec is pure data. Every expression string is checked by ``safe_expr`` during
validation, so a spec that passes validation contains only allow-listed math.
"""

from __future__ import annotations

import keyword
import math
import re
from typing import Dict, List, Literal, Tuple

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from safe_expr import RESERVED_NAMES, UnsafeExpression, parse_expression

MAX_STATE = 8
MAX_PARAMS = 32
MAX_T_POINTS = 5000
MAX_T_ABS = 1e6
MAX_VALUE_ABS = 1e12
MAX_DESCRIPTION = 500

_IDENT = r"[A-Za-z][A-Za-z0-9_]{0,31}"


def _check_name(name: object) -> str:
    if not isinstance(name, str) or not re.fullmatch(_IDENT, name):
        raise ValueError("names must match [A-Za-z][A-Za-z0-9_]{0,31}")
    if keyword.iskeyword(name) or name in RESERVED_NAMES:
        raise ValueError(f"name {name!r} is reserved")
    return name


def _check_number(value: object) -> float:
    # Reject bools and strings: the spec must contain real JSON numbers.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("values must be JSON numbers")
    v = float(value)
    if not math.isfinite(v):
        raise ValueError("values must be finite")
    if abs(v) > MAX_VALUE_ABS:
        raise ValueError(f"values must satisfy |v| <= {MAX_VALUE_ABS:g}")
    return v


class OdeSpec(BaseModel):
    """A system dy_i/dt = f_i(t, y, params), solved by a fixed SciPy integrator."""

    model_config = ConfigDict(extra="forbid")

    spec_version: Literal[1] = 1
    eq_type: Literal["ODE"] = "ODE"
    description: str = Field("", max_length=MAX_DESCRIPTION)
    state: List[str] = Field(..., min_length=1, max_length=MAX_STATE)
    params: Dict[str, float] = Field(default_factory=dict)
    equations: Dict[str, str]
    initial: Dict[str, float]
    t_span: Tuple[float, float]
    t_points: int = Field(500, ge=2, le=MAX_T_POINTS)
    plot: Tuple[str, str]
    method: Literal["RK45", "LSODA"] = "LSODA"

    @field_validator("state", mode="before")
    @classmethod
    def _state(cls, v: object) -> object:
        if isinstance(v, list):
            if len(v) > MAX_STATE:
                raise ValueError(f"at most {MAX_STATE} state variables")
            for name in v:
                _check_name(name)
            if len(set(v)) != len(v):
                raise ValueError("state variable names must be unique")
        return v

    @field_validator("params", "initial", mode="before")
    @classmethod
    def _numbers(cls, v: object) -> object:
        if not isinstance(v, dict):
            raise ValueError("must be an object of name -> number")
        if len(v) > MAX_PARAMS:
            raise ValueError(f"at most {MAX_PARAMS} entries")
        return {_check_name(k): _check_number(val) for k, val in v.items()}

    @field_validator("equations", mode="before")
    @classmethod
    def _equations(cls, v: object) -> object:
        if not isinstance(v, dict) or len(v) > MAX_STATE:
            raise ValueError(f"equations must be an object with at most {MAX_STATE} entries")
        for k, expr in v.items():
            _check_name(k)
            if not isinstance(expr, str):
                raise ValueError("equation right-hand sides must be strings")
        return v

    @field_validator("t_span", mode="before")
    @classmethod
    def _t_span(cls, v: object) -> object:
        if not isinstance(v, (list, tuple)) or len(v) != 2:
            raise ValueError("t_span must be [t0, t1]")
        t0, t1 = (_check_number(x) for x in v)
        if abs(t0) > MAX_T_ABS or abs(t1) > MAX_T_ABS:
            raise ValueError(f"t_span values must satisfy |t| <= {MAX_T_ABS:g}")
        if not t1 > t0:
            raise ValueError("t_span must satisfy t1 > t0")
        return (t0, t1)

    @field_validator("t_points", mode="before")
    @classmethod
    def _t_points(cls, v: object) -> object:
        if isinstance(v, bool) or not isinstance(v, int):
            raise ValueError("t_points must be an integer")
        return v

    @model_validator(mode="after")
    def _cross_check(self) -> "OdeSpec":
        state = set(self.state)
        if state & set(self.params):
            raise ValueError("a name cannot be both a state variable and a parameter")
        if set(self.equations) != state:
            raise ValueError("equations must have exactly one entry per state variable")
        if set(self.initial) != state:
            raise ValueError("initial must have exactly one value per state variable")
        for axis in self.plot:
            if axis != "t" and axis not in state:
                raise ValueError("plot axes must be 't' or state variables")
        names = list(self.state) + list(self.params)
        for var, expr in self.equations.items():
            try:
                parse_expression(expr, names)
            except UnsafeExpression as exc:
                raise ValueError(f"equation for {var!r} rejected: {exc}") from None
        return self


class Review(BaseModel):
    """Advisory output of the optional physics reviewer. Never affects execution."""

    enabled: bool = False
    warnings: List[str] = Field(default_factory=list)
    note: str = ""


class ExtractResponse(BaseModel):
    spec: OdeSpec
    review: Review
