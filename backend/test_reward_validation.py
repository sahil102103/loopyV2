"""Tests for expert-ranking validation and reward ablations."""

import unittest

import networkx as nx

try:
    from flowcld_env.objectives import DEFAULT_OBJECTIVE_WEIGHTS, ObjectiveEvaluator
    from flowcld_env.observations import SimulationObservationBuilder
    from flowcld_env.engine import EngineEvaluation
    from flowcld_env.reward_validation import (
        RankedGraphOutcome,
        RewardOutcomeEvidence,
        RewardValidationStudy,
        RewardValidationThresholds,
        compare_reward_to_experts,
    )
    from flowcld_env.types import Objective
except ModuleNotFoundError:
    from backend.flowcld_env.objectives import DEFAULT_OBJECTIVE_WEIGHTS, ObjectiveEvaluator
    from backend.flowcld_env.observations import SimulationObservationBuilder
    from backend.flowcld_env.engine import EngineEvaluation
    from backend.flowcld_env.reward_validation import (
        RankedGraphOutcome,
        RewardOutcomeEvidence,
        RewardValidationStudy,
        RewardValidationThresholds,
        compare_reward_to_experts,
    )
    from backend.flowcld_env.types import Objective


class _RankedEngine:
    presets = {"balanced": {}}

    def simulate(self, graph, steps):
        value = float(graph.nodes["A"]["start_amount"])
        return {"A": [value] * (int(steps) + 1)}

    def classify(self, history):
        return {node: "Optimal" for node in history}

    def evaluate(self, graph, *, preset, steps):
        del preset, steps
        health = float(graph.nodes["A"]["start_amount"]) / 3.0
        return EngineEvaluation(
            cost=(1.0 / health) - 1.0,
            health=health,
            components={},
            classifications={"A": "Optimal"},
        )


def _evidence(outcome_id, rank, *, health, fit, activity=1.0):
    return RewardOutcomeEvidence(
        outcome_id=outcome_id,
        expert_rank=rank,
        components={
            "canonical_health": health,
            "target_fit": fit,
            "target_activity": activity,
            "spectral_target_fit": 0.0,
        },
    )


class RewardValidationTests(unittest.TestCase):
    def setUp(self):
        self.thresholds = RewardValidationThresholds(
            minimum_spearman=0.8,
            minimum_pairwise_agreement=0.8,
            minimum_outcomes=3,
        )

    def test_current_reward_passes_a_matching_expert_order(self):
        evidence = (
            _evidence("best", 1, health=1.0, fit=1.0),
            _evidence("middle", 2, health=0.6, fit=0.6),
            _evidence("worst", 3, health=0.1, fit=0.1),
        )

        result = compare_reward_to_experts(
            evidence, DEFAULT_OBJECTIVE_WEIGHTS, self.thresholds
        )

        self.assertAlmostEqual(result.spearman, 1.0)
        self.assertAlmostEqual(result.pairwise_agreement, 1.0)
        self.assertTrue(result.passed)

    def test_disruptor_orientation_is_scored_from_the_disruptor_perspective(self):
        evidence = (
            _evidence("damaged", 1, health=0.1, fit=0.1),
            _evidence("mixed", 2, health=0.5, fit=0.5),
            _evidence("healthy", 3, health=1.0, fit=1.0),
        )

        result = compare_reward_to_experts(
            evidence,
            DEFAULT_OBJECTIVE_WEIGHTS,
            self.thresholds,
            orientation_sign=-1.0,
        )

        self.assertAlmostEqual(result.spearman, 1.0)
        self.assertTrue(result.passed)

    def test_ablation_exposes_the_only_component_matching_experts(self):
        evidence = (
            _evidence("best", 1, health=0.5, fit=1.0),
            _evidence("middle", 2, health=0.5, fit=0.5),
            _evidence("worst", 3, health=0.5, fit=0.0),
        )
        without_fit = DEFAULT_OBJECTIVE_WEIGHTS.without("target_fit")

        result = compare_reward_to_experts(evidence, without_fit, self.thresholds)

        self.assertIsNone(result.spearman)
        self.assertAlmostEqual(result.pairwise_agreement, 0.5)
        self.assertFalse(result.passed)

    def test_thresholds_must_be_declared_and_valid(self):
        with self.assertRaises(ValueError):
            RewardValidationThresholds(1.1, 0.8)
        with self.assertRaises(ValueError):
            RewardValidationThresholds(0.8, 0.8, minimum_outcomes=1)

    def test_study_collects_real_objective_components_and_runs_ablations(self):
        engine = _RankedEngine()
        study = RewardValidationStudy(
            horizon=2,
            objective_evaluator=ObjectiveEvaluator(engine=engine, horizon=2),
            observation_builder=SimulationObservationBuilder(horizon=2, engine=engine),
        )
        outcomes = []
        for value, rank in ((3.0, 1), (2.0, 2), (1.0, 3)):
            graph = nx.DiGraph()
            graph.add_node("A", start_amount=value, retention=1.0)
            outcomes.append(RankedGraphOutcome(f"value-{value}", graph, rank))

        report = study.run(outcomes, Objective(name="health ranking"), self.thresholds)

        self.assertTrue(report.baseline.passed)
        self.assertEqual(len(report.evidence), 3)
        self.assertEqual(len(report.ablations), 3)


if __name__ == "__main__":
    unittest.main()
