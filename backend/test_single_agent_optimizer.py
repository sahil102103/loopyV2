"""Regression tests for Stage 2 single-agent target optimization."""

from pathlib import Path
import tempfile
import unittest

try:
    from flowcld_env import (
        LearnedParameterPolicy,
        MutationMode,
        ParameterAction,
        ParameterConfigurationEvaluator,
        ParameterName,
        RoleBasedAuthorizationPolicy,
        RoleDefinition,
        SimulationObservationBuilder,
        SingleAgentTargetOptimizer,
        SingleAgentTrainingSettings,
        TargetSpecification,
    )
except ModuleNotFoundError:
    from backend.flowcld_env import (
        LearnedParameterPolicy,
        MutationMode,
        ParameterAction,
        ParameterConfigurationEvaluator,
        ParameterName,
        RoleBasedAuthorizationPolicy,
        RoleDefinition,
        SimulationObservationBuilder,
        SingleAgentTargetOptimizer,
        SingleAgentTrainingSettings,
        TargetSpecification,
    )


def _level_evaluator(target_value=1.0):
    payload = {
        "nodes": [{"name": "Level", "start_amount": 0, "retention": 1}],
        "edges": [],
    }
    policy = RoleBasedAuthorizationPolicy([RoleDefinition(
        name="controller",
        node_parameters=frozenset({ParameterName.START_AMOUNT}),
        node_targets=frozenset({"Level"}),
    )])
    return ParameterConfigurationEvaluator.from_payload(
        payload,
        role="controller",
        authorization_policy=policy,
        target=TargetSpecification(trajectories={"Level": [target_value] * 4}),
        observation_builder=SimulationObservationBuilder(horizon=3),
    )


def _settings(iterations):
    return SingleAgentTrainingSettings(
        iterations=iterations,
        population_size=10,
        elite_fraction=0.3,
        update_rate=0.7,
        initial_std_fraction=0.2,
        minimum_std_fraction=0.01,
        seed=11,
    )


class SingleAgentOptimizerTests(unittest.TestCase):
    def test_configuration_evaluation_is_atomic_on_unauthorized_action(self):
        evaluator = _level_evaluator()
        evaluation = evaluator.evaluate([
            ParameterAction(
                parameter=ParameterName.START_AMOUNT,
                target="Level",
                value=1,
                mode=MutationMode.SET,
            ),
            ParameterAction(
                parameter=ParameterName.RETENTION,
                target="Level",
                value=0.5,
                mode=MutationMode.SET,
            ),
        ])

        self.assertFalse(evaluation.accepted)
        self.assertIn("not authorized", evaluation.reason)
        self.assertEqual(evaluation.observation.node_parameters["Level"]["start_amount"], 0.0)
        self.assertEqual(evaluation.reward.components["invalid_action"], -1.0)

    def test_optimizer_improves_target_reward_and_policy_round_trips(self):
        evaluator = _level_evaluator()
        result = SingleAgentTargetOptimizer(evaluator, _settings(iterations=6)).train()

        self.assertGreater(result.reward_improvement, 0.9)
        self.assertGreater(result.optimized.reward.total, result.baseline.reward.total)
        self.assertEqual(result.policy.actions[0].parameter, ParameterName.START_AMOUNT)
        self.assertAlmostEqual(result.policy.actions[0].value, 1.0, places=6)
        self.assertTrue(all(
            current.global_best_reward >= previous.global_best_reward
            for previous, current in zip(result.history, result.history[1:])
        ))

        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "level-policy.json"
            result.policy.save(path)
            loaded = LearnedParameterPolicy.load(path)
        self.assertEqual(loaded, result.policy)
        replay = evaluator.evaluate(loaded.actions)
        self.assertAlmostEqual(replay.reward.total, result.optimized.reward.total)

    def test_checkpoint_resume_matches_uninterrupted_training(self):
        evaluator = _level_evaluator(target_value=0.65)
        uninterrupted = SingleAgentTargetOptimizer(evaluator, _settings(iterations=5)).train()

        with tempfile.TemporaryDirectory() as temp_dir:
            checkpoint_path = Path(temp_dir) / "checkpoint.json"
            SingleAgentTargetOptimizer(evaluator, _settings(iterations=2)).train(
                checkpoint_path=checkpoint_path
            )
            resumed = SingleAgentTargetOptimizer(evaluator, _settings(iterations=5)).train(
                resume_from=checkpoint_path,
                checkpoint_path=checkpoint_path,
            )

        self.assertEqual(resumed.policy.actions, uninterrupted.policy.actions)
        self.assertAlmostEqual(resumed.optimized.reward.total, uninterrupted.optimized.reward.total)
        self.assertEqual(tuple(resumed.history), tuple(uninterrupted.history))

    def test_default_search_excludes_confidence_and_honors_role_scope(self):
        payload = {
            "nodes": [
                {"name": "A", "start_amount": 1, "retention": 0.8},
                {"name": "B", "start_amount": 0, "retention": 0.8},
            ],
            "edges": [{
                "source": "A",
                "target": "B",
                "correlation": 1,
                "decay": 0.2,
                "delay": 0,
                "confidence": 0.5,
            }],
        }
        policy = RoleBasedAuthorizationPolicy([RoleDefinition(
            name="edge-controller",
            edge_parameters=frozenset({ParameterName.DECAY, ParameterName.CONFIDENCE}),
            edge_targets=frozenset({("A", "B")}),
        )])
        evaluator = ParameterConfigurationEvaluator.from_payload(
            payload,
            role="edge-controller",
            authorization_policy=policy,
            target=TargetSpecification(behaviors={"B": "Optimal"}),
            observation_builder=SimulationObservationBuilder(horizon=3),
        )
        optimizer = SingleAgentTargetOptimizer(evaluator, _settings(iterations=1))
        parameters = {dimension.slot.parameter for dimension in optimizer.dimensions}

        self.assertEqual(parameters, {ParameterName.DECAY})

    def test_optimizer_matches_a_downstream_dynamic_by_learning_edge_decay(self):
        payload = {
            "nodes": [
                {"name": "Driver", "start_amount": 1, "retention": 1},
                {"name": "Response", "start_amount": 0, "retention": 0},
            ],
            "edges": [{
                "source": "Driver",
                "target": "Response",
                "correlation": 1,
                "decay": 1,
                "delay": 0,
                "confidence": 1,
            }],
        }
        policy = RoleBasedAuthorizationPolicy([RoleDefinition(
            name="controller",
            edge_parameters=frozenset({ParameterName.DECAY}),
            edge_targets=frozenset({("Driver", "Response")}),
        )])
        evaluator = ParameterConfigurationEvaluator.from_payload(
            payload,
            role="controller",
            authorization_policy=policy,
            target=TargetSpecification(trajectories={"Response": [0, 0.75, 0.75, 0.75]}),
            observation_builder=SimulationObservationBuilder(horizon=3),
        )
        result = SingleAgentTargetOptimizer(
            evaluator,
            SingleAgentTrainingSettings(iterations=8, population_size=16, seed=19),
        ).train()

        learned_decay = result.policy.actions[0].value
        self.assertAlmostEqual(learned_decay, 0.25, delta=0.03)
        self.assertGreater(result.reward_improvement, 0.8)
        self.assertTrue(all(
            abs(actual - desired) < 0.03
            for actual, desired in zip(
                result.optimized.observation.history["Response"],
                (0, 0.75, 0.75, 0.75),
            )
        ))

    def test_checkpoint_is_rejected_for_different_target(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            checkpoint_path = Path(temp_dir) / "checkpoint.json"
            SingleAgentTargetOptimizer(_level_evaluator(0.5), _settings(iterations=1)).train(
                checkpoint_path=checkpoint_path
            )
            with self.assertRaises(ValueError):
                SingleAgentTargetOptimizer(_level_evaluator(0.8), _settings(iterations=2)).train(
                    resume_from=checkpoint_path
                )

    def test_target_cannot_exceed_rollout_horizon(self):
        payload = {
            "nodes": [{"name": "Level", "start_amount": 0, "retention": 1}],
            "edges": [],
        }
        policy = RoleBasedAuthorizationPolicy([RoleDefinition(
            name="controller",
            node_parameters=frozenset({ParameterName.START_AMOUNT}),
            node_targets=frozenset({"Level"}),
        )])
        with self.assertRaises(ValueError):
            ParameterConfigurationEvaluator.from_payload(
                payload,
                role="controller",
                authorization_policy=policy,
                target=TargetSpecification(trajectories={"Level": [0, 1, 2, 3, 4]}),
                observation_builder=SimulationObservationBuilder(horizon=3),
            )


if __name__ == "__main__":
    unittest.main()
