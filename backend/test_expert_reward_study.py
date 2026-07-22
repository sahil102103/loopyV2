"""Focused tests for the blinded expert reward-validation workflow."""

from __future__ import annotations

import csv
import json
from pathlib import Path
import tempfile
import unittest

import networkx as nx

try:
    from flowcld_env.activity_diagnostics import activity_diagnostics
    from flowcld_env.expert_study import (
        FORBIDDEN_EXPERT_TERMS,
        RANKING_COLUMNS,
        ExpertStudyValidationError,
        _graph_signature,
        _near_duplicate,
        analyze_rankings,
        generate_expert_study,
        validate_ranking_file,
    )
    from flowcld_env.reward_validation import (
        inter_rater_agreement,
        ranking_statistics,
    )
except ModuleNotFoundError:
    from backend.flowcld_env.activity_diagnostics import activity_diagnostics
    from backend.flowcld_env.expert_study import (
        FORBIDDEN_EXPERT_TERMS,
        RANKING_COLUMNS,
        ExpertStudyValidationError,
        _graph_signature,
        _near_duplicate,
        analyze_rankings,
        generate_expert_study,
        validate_ranking_file,
    )
    from backend.flowcld_env.reward_validation import (
        inter_rater_agreement,
        ranking_statistics,
    )


class ActivityDiagnosticTests(unittest.TestCase):
    def test_preserved_and_near_zero_activity_are_distinguished(self):
        baseline = [1.0, 0.8, 0.6, 0.5]
        preserved = activity_diagnostics(baseline, baseline)
        collapsed = activity_diagnostics([1.0, 0.01, 1e-10, 0.0], baseline)
        self.assertEqual(preserved.final_magnitude_ratio, 1.0)
        self.assertGreater(preserved.integrated_activity_ratio, collapsed.integrated_activity_ratio)
        self.assertLess(collapsed.tail_mean_magnitude_ratio, 0.1)

    def test_zero_initial_negative_and_oscillating_series_are_safe(self):
        result = activity_diagnostics(
            [0.0, -0.5, 0.5, -0.25],
            [0.0, 0.5, -0.5, 0.25],
        )
        self.assertFalse(result.explosion_detected)
        self.assertEqual(result.baseline_activity_similarity, 1.0)
        self.assertGreaterEqual(result.fraction_above_threshold, 0.0)

    def test_non_finite_and_exploding_series_receive_no_preservation(self):
        non_finite = activity_diagnostics([1.0, float("inf")], [1.0, 1.0])
        exploding = activity_diagnostics([1.0, 1000.0], [1.0, 1.0])
        self.assertTrue(non_finite.explosion_detected)
        self.assertTrue(exploding.explosion_detected)
        self.assertEqual(exploding.integrated_activity_ratio, 0.0)


class ExpertStudyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls._temporary.name)
        cls.study = cls.root / "study"
        cls.summary = generate_expert_study(cls.study, seed=91, horizon=20)
        cls.manifest = json.loads(
            (cls.study / "expert_manifest.json").read_text(encoding="utf-8")
        )
        cls.answer_key = json.loads(
            (cls.study / "answer_key.json").read_text(encoding="utf-8")
        )

    @classmethod
    def tearDownClass(cls):
        cls._temporary.cleanup()

    def test_generation_is_deterministic_and_blinded_ids_are_stable(self):
        second = self.root / "second"
        generate_expert_study(second, seed=91, horizon=20)
        self.assertEqual(
            (self.study / "expert_manifest.json").read_bytes(),
            (second / "expert_manifest.json").read_bytes(),
        )
        first_ids = [
            candidate["candidate_id"]
            for scenario in self.manifest["scenarios"]
            for candidate in scenario["candidates"]
        ]
        self.assertEqual(len(first_ids), len(set(first_ids)))
        self.assertTrue(all(identifier.startswith("OUT-") for identifier in first_ids))

    def test_expert_files_hide_provenance_policy_names_scores_and_weights(self):
        expert_text = (
            (self.study / "expert_manifest.json").read_text(encoding="utf-8")
            + (self.study / "expert_review_packet.md").read_text(encoding="utf-8")
            + (self.study / "ranking_template.csv").read_text(encoding="utf-8")
        ).lower()
        for term in FORBIDDEN_EXPERT_TERMS:
            self.assertNotIn(term, expert_text)
        for private_term in ("provenance", "state_potential", "transition_score", '"weights"'):
            self.assertNotIn(private_term, expert_text)
        private_text = (self.study / "answer_key.json").read_text(encoding="utf-8")
        self.assertIn('"provenance"', private_text)
        self.assertIn('"state_potential"', private_text)

    def test_packet_has_five_scenarios_and_both_separate_ranking_tasks(self):
        self.assertEqual(self.summary["scenario_count"], 5)
        self.assertGreaterEqual(self.summary["candidate_count"], 30)
        rows = self._template_rows()
        self.assertEqual({row["task"] for row in rows}, {"outcome", "transition"})
        self.assertEqual(len(rows), self.summary["candidate_count"] * 2)
        self.assertTrue(all(item["focused_pairs"] for item in self.manifest["scenarios"]))

    def test_duplicate_detector_rejects_identical_graph_and_trajectory(self):
        graph = nx.DiGraph()
        graph.add_node("a", start_amount=1.0, retention=0.5)
        history = {"a": [1.0, 0.5, 0.25]}
        duplicate = _near_duplicate(
            _graph_signature(graph), history,
            [("first", _graph_signature(graph), history)],
        )
        self.assertEqual(duplicate, "first")

    def test_duplicate_detector_rejects_numerically_near_outcomes(self):
        first = nx.DiGraph()
        first.add_node("a", start_amount=1.0, retention=0.5)
        second = nx.DiGraph()
        second.add_node("a", start_amount=1.0, retention=0.500001)
        first_history = {"a": [1.0, 0.5, 0.25]}
        second_history = {"a": [1.0, 0.500001, 0.250001]}
        duplicate = _near_duplicate(
            _graph_signature(second), second_history,
            [("first", _graph_signature(first), first_history)],
        )
        self.assertEqual(duplicate, "first")

    def test_ranking_validation_detects_missing_duplicate_and_invalid_ties(self):
        valid = self.root / "valid.csv"
        self._write_synthetic(valid, experts=("expert-a",))
        records = validate_ranking_file(self.study, valid)
        self.assertEqual(len(records), self.summary["candidate_count"] * 2)

        missing = self.root / "missing.csv"
        rows = self._completed_rows("expert-a")[:-1]
        self._write_rows(missing, rows)
        with self.assertRaisesRegex(ExpertStudyValidationError, "coverage mismatch"):
            validate_ranking_file(self.study, missing)

        duplicate = self.root / "duplicate.csv"
        rows = self._completed_rows("expert-a")
        self._write_rows(duplicate, rows + [dict(rows[0])])
        with self.assertRaisesRegex(ExpertStudyValidationError, "Duplicate"):
            validate_ranking_file(self.study, duplicate)

        invalid_tie = self.root / "invalid-tie.csv"
        rows = self._completed_rows("expert-a")
        scenario = rows[0]["scenario_id"]
        task = rows[0]["task"]
        selected = [row for row in rows if row["scenario_id"] == scenario and row["task"] == task]
        selected[0]["rank"] = "1"
        selected[1]["rank"] = "1"
        for index, row in enumerate(selected[2:], start=3):
            row["rank"] = str(index)
        self._write_rows(invalid_tie, rows)
        with self.assertRaisesRegex(ExpertStudyValidationError, "dense ties"):
            validate_ranking_file(self.study, invalid_tie)

        missing_reason = self.root / "missing-reason.csv"
        rows = self._completed_rows("expert-a")
        rows[0]["reason"] = ""
        self._write_rows(missing_reason, rows)
        with self.assertRaisesRegex(ExpertStudyValidationError, "reason is required"):
            validate_ranking_file(self.study, missing_reason)

    def test_tie_aware_statistics_and_inter_rater_agreement(self):
        spearman, pairwise = ranking_statistics(
            [1, 1, 2, 3], [0.9, 0.9, 0.5, 0.1]
        )
        self.assertAlmostEqual(spearman, 1.0)
        self.assertAlmostEqual(pairwise, 1.0)
        agreement = inter_rater_agreement({
            "a": {"x": 1, "y": 1, "z": 2},
            "b": {"x": 1, "y": 2, "z": 3},
        })
        self.assertGreater(agreement, 0.8)

    def test_complete_synthetic_round_trip_produces_both_reports_and_ablations(self):
        rankings = self.root / "synthetic.csv"
        self._write_synthetic(rankings, experts=("synthetic-a", "synthetic-b"))
        output = self.root / "analysis"
        report = analyze_rankings(self.study, rankings, output)
        self.assertEqual(report["expert_count"], 2)
        self.assertFalse(report["validated"])
        self.assertEqual(len(report["scenario_reports"]), 5)
        self.assertIn("overall_summary", report)
        self.assertIn("per_expert", report["overall_summary"])
        self.assertIsInstance(report["quantitative_gate_passed"], bool)
        self.assertTrue((output / "analysis_report.json").exists())
        self.assertTrue((output / "analysis_report.md").exists())
        for scenario in report["scenario_reports"]:
            self.assertIn("outcome", scenario["tasks"])
            self.assertIn("transition", scenario["tasks"])
            self.assertGreaterEqual(len(scenario["ablations"]), 3)
            self.assertIn("binary_target_activity", scenario["activity_diagnostics"])
            self.assertIn("tail_mean_magnitude_ratio", scenario["activity_diagnostics"])

    def _template_rows(self):
        with (self.study / "ranking_template.csv").open(newline="", encoding="utf-8") as handle:
            return list(csv.DictReader(handle))

    def _completed_rows(self, expert):
        rows = self._template_rows()
        grouped = {}
        for row in rows:
            grouped.setdefault((row["scenario_id"], row["task"]), []).append(row)
        completed = []
        for _, selected in sorted(grouped.items()):
            selected.sort(key=lambda row: row["candidate_id"])
            for rank, row in enumerate(selected, start=1):
                item = dict(row)
                item.update({
                    "expert_id": expert,
                    "rank": str(rank),
                    "unacceptable": "false",
                    "confidence": "4",
                    "reason": "synthetic calculation test only",
                })
                completed.append(item)
        return completed

    def _write_synthetic(self, path, experts):
        rows = []
        for expert in experts:
            rows.extend(self._completed_rows(expert))
        self._write_rows(path, rows)

    @staticmethod
    def _write_rows(path, rows):
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=RANKING_COLUMNS)
            writer.writeheader()
            writer.writerows(rows)


if __name__ == "__main__":
    unittest.main()
