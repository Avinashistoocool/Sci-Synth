"""Deterministic, allow-listed parser and compiler for math expression strings.

Model output reaches this module only as data. An expression string is parsed with
``ast.parse(..., mode="eval")`` (parsing only; nothing is executed), every node is checked
against a strict allow-list, and the validated tree is turned into a tree of Python
closures that call fixed numpy functions. No string is ever executed or compiled to bytecode.

Allowed grammar
  number   : int or float literal (finite; not bool, complex or string)
  name     : a declared state variable, a declared parameter, ``t``, ``pi`` or ``e``
  unary    : +x, -x
  binary   : x + y, x - y, x * y, x / y, x ** c   (c a numeric constant, |c| <= MAX_POW)
  call     : f(x) for f in FUNCTIONS (positional arguments only, fixed arity)
Everything else (attributes, subscripts, lambdas, comprehensions, keyword arguments,
strings, f-strings, comparisons, walrus, starred arguments, ...) is rejected.
"""

from __future__ import annotations

import ast
import math
from typing import Callable, Dict, Iterable, Mapping, Tuple

import numpy as np

MAX_LEN = 500
MAX_NODES = 200
MAX_POW = 10.0

# name -> (numpy function, arity)
FUNCTIONS: Dict[str, Tuple[Callable[..., float], int]] = {
    "sin": (np.sin, 1),
    "cos": (np.cos, 1),
    "tan": (np.tan, 1),
    "exp": (np.exp, 1),
    "log": (np.log, 1),
    "sqrt": (np.sqrt, 1),
    "abs": (np.abs, 1),
    "tanh": (np.tanh, 1),
    "sinh": (np.sinh, 1),
    "cosh": (np.cosh, 1),
    "arcsin": (np.arcsin, 1),
    "arccos": (np.arccos, 1),
    "arctan": (np.arctan, 1),
    "min": (np.minimum, 2),
    "max": (np.maximum, 2),
}

CONSTANTS: Dict[str, float] = {"pi": float(np.pi), "e": float(np.e)}
TIME_NAME = "t"
RESERVED_NAMES = frozenset(FUNCTIONS) | frozenset(CONSTANTS) | {TIME_NAME}

_BINOPS = {
    ast.Add: np.add,
    ast.Sub: np.subtract,
    ast.Mult: np.multiply,
    ast.Div: np.true_divide,
    ast.Pow: np.power,
}
_UNARYOPS = {ast.UAdd: np.positive, ast.USub: np.negative}

Env = Mapping[str, float]
Compiled = Callable[[Env], float]


class UnsafeExpression(ValueError):
    """Raised when an expression is not in the allowed grammar."""


def _is_number(node: ast.AST) -> bool:
    if not isinstance(node, ast.Constant) or type(node.value) not in (int, float):
        return False
    try:
        return math.isfinite(float(node.value))
    except OverflowError:
        return False


def _constant_exponent(node: ast.AST) -> float:
    """Return the value of a constant exponent (optionally negated) or raise."""
    sign = 1.0
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
        sign = -1.0 if isinstance(node.op, ast.USub) else 1.0
        node = node.operand
    if not _is_number(node):
        raise UnsafeExpression("exponents must be numeric constants")
    value = sign * float(node.value)  # type: ignore[attr-defined]
    if abs(value) > MAX_POW:
        raise UnsafeExpression(f"exponent magnitude must be <= {MAX_POW:g}")
    return value


def _check(node: ast.AST, names: frozenset) -> None:
    if isinstance(node, ast.BinOp):
        if type(node.op) not in _BINOPS:
            raise UnsafeExpression(f"operator {type(node.op).__name__} is not allowed")
        if isinstance(node.op, ast.Pow):
            _constant_exponent(node.right)
        _check(node.left, names)
        _check(node.right, names)
    elif isinstance(node, ast.UnaryOp):
        if type(node.op) not in _UNARYOPS:
            raise UnsafeExpression(f"operator {type(node.op).__name__} is not allowed")
        _check(node.operand, names)
    elif isinstance(node, ast.Constant):
        if not _is_number(node):
            raise UnsafeExpression("only finite int/float literals are allowed")
    elif isinstance(node, ast.Name):
        if not isinstance(node.ctx, ast.Load):
            raise UnsafeExpression("assignment is not allowed")
        if node.id not in names:
            raise UnsafeExpression(f"unknown name {node.id!r}")
    elif isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in FUNCTIONS:
            raise UnsafeExpression("only calls to allow-listed math functions are allowed")
        if node.keywords:
            raise UnsafeExpression("keyword arguments are not allowed")
        _, arity = FUNCTIONS[node.func.id]
        if len(node.args) != arity:
            raise UnsafeExpression(f"{node.func.id} takes {arity} argument(s)")
        for arg in node.args:
            if isinstance(arg, ast.Starred):
                raise UnsafeExpression("starred arguments are not allowed")
            _check(arg, names)
    else:
        raise UnsafeExpression(f"{type(node).__name__} is not allowed")


def parse_expression(source: str, variables: Iterable[str]) -> ast.Expression:
    """Parse and validate ``source``; return the checked AST or raise UnsafeExpression.

    ``variables`` are the declared state variables and parameters. ``t``, ``pi`` and ``e``
    are always available. Function names are only valid in call position.
    """
    if not isinstance(source, str):
        raise UnsafeExpression("expression must be a string")
    if len(source) > MAX_LEN:
        raise UnsafeExpression(f"expression longer than {MAX_LEN} characters")
    if not source.strip():
        raise UnsafeExpression("expression is empty")
    # ASCII only: blocks Unicode look-alike identifiers (Python NFKC-normalises them).
    if not source.isascii() or any(ord(c) < 32 and c not in " \t" for c in source):
        raise UnsafeExpression("expression must be printable ASCII")
    try:
        tree = ast.parse(source.strip(), mode="eval")
    except (SyntaxError, ValueError, RecursionError, MemoryError) as exc:
        raise UnsafeExpression(f"not a valid expression: {exc.__class__.__name__}") from None

    count = 0
    for _ in ast.walk(tree):
        count += 1
        if count > MAX_NODES:
            raise UnsafeExpression(f"expression has more than {MAX_NODES} nodes")

    names = frozenset(variables) | frozenset(CONSTANTS) | {TIME_NAME}
    _check(tree.body, names)
    return tree


def _build(node: ast.AST) -> Compiled:
    if isinstance(node, ast.Constant):
        value = np.float64(node.value)
        return lambda env: value
    if isinstance(node, ast.Name):
        if node.id in CONSTANTS:
            value = np.float64(CONSTANTS[node.id])
            return lambda env: value
        key = node.id
        return lambda env: env[key]
    if isinstance(node, ast.UnaryOp):
        uop = _UNARYOPS[type(node.op)]
        operand = _build(node.operand)
        return lambda env: uop(operand(env))
    if isinstance(node, ast.BinOp):
        bop = _BINOPS[type(node.op)]
        left = _build(node.left)
        if isinstance(node.op, ast.Pow):
            exponent = np.float64(_constant_exponent(node.right))
            return lambda env: bop(left(env), exponent)
        right = _build(node.right)
        return lambda env: bop(left(env), right(env))
    if isinstance(node, ast.Call):
        fn, _ = FUNCTIONS[node.func.id]  # type: ignore[attr-defined]
        args = tuple(_build(a) for a in node.args)
        if len(args) == 1:
            (a0,) = args
            return lambda env: fn(a0(env))
        a0, a1 = args
        return lambda env: fn(a0(env), a1(env))
    raise UnsafeExpression(f"{type(node).__name__} is not allowed")  # unreachable after _check


def compile_expression(source: str, variables: Iterable[str]) -> Compiled:
    """Validate ``source`` and return a pure function ``f(env) -> float``.

    ``env`` maps every declared name (and ``t``) to a float.
    """
    tree = parse_expression(source, variables)
    return _build(tree.body)
