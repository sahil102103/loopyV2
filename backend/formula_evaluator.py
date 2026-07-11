"""Restricted evaluator for FlowCLD's notebook-style numeric expressions.

Models are user supplied, so expressions must never run with Python builtins or
module access.  The evaluator deliberately supports only arithmetic, boolean
comparisons, indexing the documented simulation context, and a small allowlist
of math functions.
"""

from __future__ import annotations

import ast
import math
from types import SimpleNamespace
from typing import Any, Mapping

import numpy as np


class FormulaEvaluationError(ValueError):
    """Raised when an expression is outside the supported formula language."""


_MATH_FUNCTIONS = {
    name: getattr(math, name)
    for name in (
        "acos", "asin", "atan", "atan2", "ceil", "cos", "cosh", "exp",
        "fabs", "floor", "log", "log10", "pow", "sin", "sinh", "sqrt",
        "tan", "tanh",
    )
}
_MATH_FUNCTIONS.update({"abs": abs, "min": min, "max": max, "round": round})
_MATH_NAMESPACE = SimpleNamespace(**_MATH_FUNCTIONS, e=math.e, pi=math.pi, tau=math.tau)

_NP_FUNCTIONS = {
    "abs": np.abs,
    "ceil": np.ceil,
    "clip": np.clip,
    "cos": np.cos,
    "exp": np.exp,
    "floor": np.floor,
    "log": np.log,
    "log10": np.log10,
    "maximum": np.maximum,
    "minimum": np.minimum,
    "power": np.power,
    "sin": np.sin,
    "sqrt": np.sqrt,
    "tan": np.tan,
    "tanh": np.tanh,
}
_NP_NAMESPACE = SimpleNamespace(**_NP_FUNCTIONS)

_DIRECT_FUNCTIONS = {
    "abs": abs,
    "min": min,
    "max": max,
    "pow": pow,
    "round": round,
    "sum": sum,
}
_CONTEXT_NAMES = {"t", "x", "val", "e", "history", "raw", "nxt", "inputs"}
_ALLOWED_NAMES = _CONTEXT_NAMES | {"math", "np"} | set(_DIRECT_FUNCTIONS)
_ALLOWED_MATH_ATTRS = set(_MATH_FUNCTIONS) | {"e", "pi", "tau"}
_ALLOWED_NP_ATTRS = set(_NP_FUNCTIONS)


class _FormulaValidator(ast.NodeVisitor):
    """Validate a parsed Python expression before compiling it."""

    _ALLOWED_NODES = (
        ast.Expression,
        ast.BinOp,
        ast.BoolOp,
        ast.Compare,
        ast.Constant,
        ast.IfExp,
        ast.List,
        ast.Load,
        ast.Name,
        ast.Subscript,
        ast.Tuple,
        ast.UnaryOp,
        ast.Attribute,
        ast.Call,
        ast.Add,
        ast.And,
        ast.Div,
        ast.Eq,
        ast.FloorDiv,
        ast.Gt,
        ast.GtE,
        ast.Lt,
        ast.LtE,
        ast.Mod,
        ast.Mult,
        ast.Not,
        ast.NotEq,
        ast.Or,
        ast.Pow,
        ast.Sub,
        ast.UAdd,
        ast.USub,
    )

    def generic_visit(self, node: ast.AST) -> None:
        if not isinstance(node, self._ALLOWED_NODES):
            raise FormulaEvaluationError(f"Unsupported expression syntax: {type(node).__name__}")
        super().generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        if node.id not in _ALLOWED_NAMES:
            raise FormulaEvaluationError(f"Unknown or disallowed symbol: {node.id}")

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if not isinstance(node.value, ast.Name) or node.value.id not in {"math", "np"}:
            raise FormulaEvaluationError("Only math.* and np.* attributes are allowed")
        allowed = _ALLOWED_MATH_ATTRS if node.value.id == "math" else _ALLOWED_NP_ATTRS
        if node.attr not in allowed:
            raise FormulaEvaluationError(f"Disallowed function: {node.value.id}.{node.attr}")
        self.visit(node.value)

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name):
            if node.func.id not in _DIRECT_FUNCTIONS:
                raise FormulaEvaluationError(f"Disallowed function: {node.func.id}")
        elif isinstance(node.func, ast.Attribute):
            self.visit_Attribute(node.func)
        else:
            raise FormulaEvaluationError("Only named math functions can be called")
        for arg in node.args:
            self.visit(arg)
        for keyword in node.keywords:
            if keyword.arg is None:
                raise FormulaEvaluationError("Starred keyword arguments are not allowed")
            self.visit(keyword.value)


def evaluate_formula(expression: str, context: Mapping[str, Any] | None = None) -> float:
    """Evaluate a numeric FlowCLD expression in a deliberately small sandbox."""
    if not isinstance(expression, str) or not expression.strip():
        raise FormulaEvaluationError("Expression is empty")
    if len(expression) > 4_000:
        raise FormulaEvaluationError("Expression is too long")

    try:
        parsed = ast.parse(expression, mode="eval")
    except SyntaxError as error:
        raise FormulaEvaluationError(f"Invalid expression syntax: {error.msg}") from error

    _FormulaValidator().visit(parsed)
    supplied = dict(context or {})
    scope = {
        "t": supplied.get("t", 0),
        "x": supplied.get("x", 0),
        "val": supplied.get("val", supplied.get("x", 0)),
        "e": supplied.get("e", math.e),
        "history": supplied.get("history", {}),
        "raw": supplied.get("raw", {}),
        "nxt": supplied.get("nxt", {}),
        "inputs": supplied.get("inputs", {}),
        "math": _MATH_NAMESPACE,
        "np": _NP_NAMESPACE,
        **_DIRECT_FUNCTIONS,
    }

    try:
        value = _evaluate_node(parsed, scope)
    except (ArithmeticError, KeyError, TypeError, ValueError, ZeroDivisionError) as error:
        raise FormulaEvaluationError(str(error)) from error

    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise FormulaEvaluationError("Expression must return a numeric value") from error
    if not math.isfinite(number):
        raise FormulaEvaluationError("Expression must return a finite value")
    return number


def _evaluate_node(node: ast.AST, scope: Mapping[str, Any]) -> Any:
    """Interpret the already-validated expression without invoking Python eval."""
    if isinstance(node, ast.Expression):
        return _evaluate_node(node.body, scope)
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        return scope[node.id]
    if isinstance(node, ast.Attribute):
        base = _evaluate_node(node.value, scope)
        return getattr(base, node.attr)
    if isinstance(node, ast.Subscript):
        value = _evaluate_node(node.value, scope)
        index = _evaluate_node(node.slice, scope)
        return value[index]
    if isinstance(node, ast.List):
        return [_evaluate_node(item, scope) for item in node.elts]
    if isinstance(node, ast.Tuple):
        return tuple(_evaluate_node(item, scope) for item in node.elts)
    if isinstance(node, ast.UnaryOp):
        value = _evaluate_node(node.operand, scope)
        if isinstance(node.op, ast.UAdd):
            return +value
        if isinstance(node.op, ast.USub):
            return -value
        if isinstance(node.op, ast.Not):
            return not value
    if isinstance(node, ast.BinOp):
        left = _evaluate_node(node.left, scope)
        right = _evaluate_node(node.right, scope)
        operations = {
            ast.Add: lambda a, b: a + b,
            ast.Sub: lambda a, b: a - b,
            ast.Mult: lambda a, b: a * b,
            ast.Div: lambda a, b: a / b,
            ast.FloorDiv: lambda a, b: a // b,
            ast.Mod: lambda a, b: a % b,
            ast.Pow: lambda a, b: a ** b,
        }
        return operations[type(node.op)](left, right)
    if isinstance(node, ast.BoolOp):
        if isinstance(node.op, ast.And):
            for value in node.values:
                if not _evaluate_node(value, scope):
                    return False
            return True
        for value in node.values:
            if _evaluate_node(value, scope):
                return True
        return False
    if isinstance(node, ast.Compare):
        left = _evaluate_node(node.left, scope)
        operations = {
            ast.Eq: lambda a, b: a == b,
            ast.NotEq: lambda a, b: a != b,
            ast.Lt: lambda a, b: a < b,
            ast.LtE: lambda a, b: a <= b,
            ast.Gt: lambda a, b: a > b,
            ast.GtE: lambda a, b: a >= b,
        }
        for operator, comparator in zip(node.ops, node.comparators):
            right = _evaluate_node(comparator, scope)
            if not operations[type(operator)](left, right):
                return False
            left = right
        return True
    if isinstance(node, ast.IfExp):
        branch = node.body if _evaluate_node(node.test, scope) else node.orelse
        return _evaluate_node(branch, scope)
    if isinstance(node, ast.Call):
        function = _evaluate_node(node.func, scope)
        args = [_evaluate_node(arg, scope) for arg in node.args]
        kwargs = {keyword.arg: _evaluate_node(keyword.value, scope) for keyword in node.keywords}
        return function(*args, **kwargs)
    raise FormulaEvaluationError(f"Unsupported expression syntax: {type(node).__name__}")
