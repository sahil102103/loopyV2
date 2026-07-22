"""Focused tests for the reusable notebook DMD analysis."""

import unittest
import warnings

import numpy as np

try:
    from dmd_analysis import compute_dmd
except ModuleNotFoundError:
    from backend.dmd_analysis import compute_dmd


class DMDAnalysisTests(unittest.TestCase):
    def test_centered_constant_history_returns_rank_zero_without_warnings(self):
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            result = compute_dmd(
                {"A": [2.0, 2.0, 2.0], "B": [5.0, 5.0, 5.0]},
                rank=10,
                center=True,
            )

        self.assertEqual(result.effective_rank, 0)
        self.assertTrue(result.table.empty)
        self.assertEqual(result.discrete_eigenvalues.size, 0)
        self.assertEqual(result.modes.shape, (2, 0))

    def test_negative_discrete_modes_use_complex_log_without_warnings(self):
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            result = compute_dmd(
                {"A": [1.0, -1.0, 1.0, -1.0]},
                rank=1,
                center=False,
            )

        self.assertEqual(result.effective_rank, 1)
        self.assertAlmostEqual(result.table.loc[0, "mu_real"], -1.0)
        self.assertTrue(result.table.loc[0, "oscillatory"])
        self.assertTrue(np.isfinite(result.table.loc[0, "period_quarters"]))

    def test_missing_values_are_filled_but_infinity_is_rejected(self):
        result = compute_dmd({"A": [None, 1.0, None, 2.0]}, center=False)
        self.assertGreaterEqual(result.effective_rank, 1)
        with self.assertRaisesRegex(ValueError, "contains infinity"):
            compute_dmd({"A": [1.0, float("inf")]})

    def test_rejects_mismatched_lengths_and_invalid_dt(self):
        with self.assertRaisesRegex(ValueError, "same length"):
            compute_dmd({"A": [1.0, 2.0], "B": [1.0, 2.0, 3.0]})
        with self.assertRaisesRegex(ValueError, "positive finite"):
            compute_dmd({"A": [1.0, 2.0]}, dt_quarters=0.0)


if __name__ == "__main__":
    unittest.main()
