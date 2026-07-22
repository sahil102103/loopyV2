"""Focused regression tests for the restricted notebook formula evaluator."""

import unittest

try:
    from formula_evaluator import FormulaEvaluationError, evaluate_formula
except ModuleNotFoundError:  # Allows `python -m unittest backend/test_*.py` from repo root.
    from backend.formula_evaluator import FormulaEvaluationError, evaluate_formula


class FormulaEvaluatorTests(unittest.TestCase):
    def test_notebook_context_and_math_namespace(self):
        value = evaluate_formula(
            "0.6 * nxt['Income'] + raw['Policy Rate'] + math.exp(0)",
            {"nxt": {"Income": 100}, "raw": {"Policy Rate": 3}},
        )
        self.assertEqual(value, 64.0)

    def test_numpy_like_clip_and_conditional(self):
        self.assertEqual(evaluate_formula("np.clip(x * 4, 0, 1) if t > 0 else 0", {"x": 0.5, "t": 1}), 1.0)

    def test_initial_value_and_legacy_math_alias(self):
        self.assertEqual(
            evaluate_formula(
                "Y0 + Math.max(raw['A'], 2)",
                {"Y0": 3, "raw": {"A": 1}},
            ),
            5.0,
        )

    def test_node_labels_are_data_even_when_they_contain_language_words(self):
        self.assertEqual(
            evaluate_formula(
                "nxt['Demand for class=Goods']",
                {"nxt": {"Demand for class=Goods": 7}},
            ),
            7.0,
        )

    def test_boolean_operators_short_circuit_like_notebook_python(self):
        self.assertEqual(evaluate_formula("x == 0 or 10 / x > 1", {"x": 0}), 1.0)
        self.assertEqual(evaluate_formula("x != 0 and 10 / x > 1", {"x": 0}), 0.0)

    def test_rejects_python_imports_and_object_introspection(self):
        with self.assertRaises(FormulaEvaluationError):
            evaluate_formula("__import__('os').system('id')")
        with self.assertRaises(FormulaEvaluationError):
            evaluate_formula("raw.__class__")

    def test_numpy_overflow_is_reported_without_a_runtime_warning(self):
        import warnings

        with warnings.catch_warnings():
            warnings.simplefilter("error")
            with self.assertRaises(FormulaEvaluationError):
                evaluate_formula("np.exp(10000)")


if __name__ == "__main__":
    unittest.main()
