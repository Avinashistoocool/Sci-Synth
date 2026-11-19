"""The expression parser must reject everything outside the allow-listed grammar."""

import math

import numpy as np
import pytest

from safe_expr import MAX_LEN, UnsafeExpression, compile_expression, parse_expression

NAMES = ["x", "v", "k", "m"]

ADVERSARIAL = [
    "__import__('os').system('x')",
    "().__class__.__bases__",
    "().__class__.__bases__[0].__subclasses__()",
    "open('f')",
    "exec('print(1)')",
    "eval('1')",
    "compile('1','f','eval')",
    "exec",
    "lambda: 1",
    "(lambda q: q)(1)",
    "x.real",
    "sin.__self__",
    "e.__class__",
    "pi.__class__.__mro__",
    "x[0]",
    "[1, 2][0]",
    "f'{x}'",
    "'abc'",
    "b'abc'",
    "(y := 3)",
    "[q for q in range(3)]",
    "{q for q in (1,)}",
    "{q: q for q in (1,)}",
    "sum(q for q in (1, 2))",
    "9**9**9",
    "x**x",
    "x**11",
    "x**-11",
    "2**1000",
    "'a' * 10**9",
    "unknown + 1",
    "os",
    "globals()",
    "getattr(x, 'real')",
    "sin(x=1)",
    "max(x, v, key=abs)",
    "sin(*[x])",
    "sin(open('f'))",
    "sin(cos(print(1)))",
    "exp(len('aaaa'))",
    "sin",
    "\u0455in(x)",  # Cyrillic small dze, looks like 's'
    "\uff58 + 1",  # fullwidth 'x'; Python would NFKC-normalise it to x
    "x if v else k",
    "x < v",
    "x and v",
    "not x",
    "x // v",
    "x % v",
    "x @ v",
    "x << 1",
    "~x",
    "x, v",
    "{}",
    "None",
    "True + 1",
    "1j",
    "x; import os",
    "import os",
    "x\n__import__('os')",
    "await x",
    "yield x",
    "...",
    "1e999",
    "1" + "0" * 400,
    "x**1e999",
    "sin(x, v)",
    "max(x)",
]


@pytest.mark.parametrize("expr", ADVERSARIAL)
def test_adversarial_rejected(expr):
    with pytest.raises(UnsafeExpression):
        parse_expression(expr, NAMES)


def test_huge_string_rejected():
    with pytest.raises(UnsafeExpression):
        parse_expression("x+" * (MAX_LEN // 2) + "x", NAMES)
    with pytest.raises(UnsafeExpression):
        parse_expression("'" + "a" * 10_000 + "'", NAMES)


def test_node_limit():
    expr = "+".join(["x"] * 120)  # 239 nodes, under the length limit
    assert len(expr) < MAX_LEN
    with pytest.raises(UnsafeExpression, match="nodes"):
        parse_expression(expr, NAMES)


def test_deep_nesting_rejected_not_crash():
    with pytest.raises(UnsafeExpression):
        parse_expression("-" * 400 + "x", NAMES)
    with pytest.raises(UnsafeExpression):
        parse_expression("sin(" * 120 + "x" + ")" * 120, NAMES)


@pytest.mark.parametrize(
    "expr,expected",
    [
        ("-(k/m)*x", -4.0),
        ("x**2 + v**-1", 1.0 + 0.5),
        ("sin(pi/2) + cos(0) + exp(0) + log(e)", 4.0),
        ("sqrt(k) * abs(-x) + tanh(0) + sinh(0) + cosh(0)", 3.0),
        ("arcsin(1) + arccos(1) + arctan(0)", math.pi / 2),
        ("min(x, v) + max(x, v)", 3.0),
        ("t * 2 + +x - -1.5", 2 * 3 + 1 + 1.5),
        ("tan(0) + 2.5e-1", 0.25),
    ],
)
def test_allowed_math(expr, expected):
    f = compile_expression(expr, NAMES)
    env = {"x": 1.0, "v": 2.0, "k": 4.0, "m": 1.0, "t": 3.0}
    assert float(f(env)) == pytest.approx(expected)


def test_compiled_function_never_calls_eval_or_exec(monkeypatch):
    import builtins

    f = compile_expression("sin(x) + k * v**2", NAMES)

    def boom(*a, **k):
        raise AssertionError("eval/exec must not be called")

    monkeypatch.setattr(builtins, "eval", boom)
    monkeypatch.setattr(builtins, "exec", boom)
    assert float(f({"x": 0.0, "v": 1.0, "k": 2.0, "m": 1.0, "t": 0.0})) == 2.0


def test_function_name_not_usable_as_value():
    with pytest.raises(UnsafeExpression):
        parse_expression("exp + 1", NAMES)


def test_nan_inputs_propagate_without_error():
    f = compile_expression("log(x)", NAMES)
    with np.errstate(all="ignore"):
        assert math.isnan(float(f({"x": -1.0, "v": 0, "k": 0, "m": 0, "t": 0})))
