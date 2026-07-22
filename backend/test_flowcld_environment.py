"""Stage 1 regression tests for the role-safe FlowCLD environment."""

import math
import unittest

import networkx as nx
import numpy as np

try:
    from flowcld_env import (
        FlowCLDEnvironment,
        MutationMode,
        NoOpAction,
        Objective,
        ParameterAction,
        ParameterName,
        RoleBasedAuthorizationPolicy,
        RoleDefinition,
        SimulationObservationBuilder,
        TargetSpecification,
    )
except ModuleNotFoundError:
    from backend.flowcld_env import (
        FlowCLDEnvironment,
        MutationMode,
        NoOpAction,
        Objective,
        ParameterAction,
        ParameterName,
        RoleBasedAuthorizationPolicy,
        RoleDefinition,
        SimulationObservationBuilder,
        TargetSpecification,
    )


def _graph_payload():
    return {
        "nodes": [
            {"name": "Income", "start_amount": 100, "retention": 1.0},
            {
                "name": "Consumption",
                "start_amount": 60,
                "retention": 0.0,
                "formula": "0.6 * nxt['Income']",
            },
        ],
        "edges": [
            {
                "source": "Income",
                "target": "Consumption",
                "correlation": 1.0,
                "decay": 0.2,
                "delay": 0,
                "confidence": 0.8,
            }
        ],
    }


def _policy():
    return RoleBasedAuthorizationPolicy([
        RoleDefinition(
            name="household",
            node_parameters=frozenset({ParameterName.START_AMOUNT, ParameterName.RETENTION}),
            node_targets=frozenset({"Income", "Consumption"}),
        ),
        RoleDefinition(
            name="lender",
            edge_parameters=frozenset({
                ParameterName.DECAY,
                ParameterName.DELAY,
                ParameterName.CONFIDENCE,
            }),
            edge_targets=frozenset({("Income", "Consumption")}),
        ),
    ])


class FlowCLDEnvironmentTests(unittest.TestCase):
    def _environment(self, **overrides):
        kwargs = {
            "authorization_policy": _policy(),
            "observation_builder": SimulationObservationBuilder(horizon=3),
            "max_steps": 3,
        }
        kwargs.update(overrides)
        return FlowCLDEnvironment.from_payload(_graph_payload(), **kwargs)

    def test_reset_is_deterministic_and_baseline_is_defensive(self):
        env = self._environment()
        first, _ = env.reset(seed=42)
        env.step(ParameterAction(
            parameter=ParameterName.START_AMOUNT,
            target="Income",
            value=25,
        ), role="household")
        second, _ = env.reset(seed=42)

        self.assertNotEqual(first["episode_id"], second["episode_id"])
        for field in ("seed", "history", "classifications", "node_parameters", "edge_parameters"):
            self.assertEqual(first[field], second[field])
        self.assertTrue(nx.is_frozen(env.baseline_graph))
        self.assertEqual(env.baseline_graph.nodes["Income"]["start_amount"], 100.0)
        self.assertEqual(len(env.episode_logs), 2)
        self.assertEqual(len(env.episode_logs[0]), 1)

    def test_unauthorized_action_is_logged_and_does_not_mutate_graph(self):
        env = self._environment()
        env.reset(seed=7)
        before = env.graph_snapshot["Income"]["Consumption"]["confidence"]
        _, reward, terminated, truncated, info = env.step(ParameterAction(
            parameter=ParameterName.CONFIDENCE,
            target=("Income", "Consumption"),
            value=0.1,
        ), role="household")

        self.assertEqual(env.graph_snapshot["Income"]["Consumption"]["confidence"], before)
        self.assertFalse(info["action"]["accepted"])
        self.assertIn("not authorized", info["action"]["reason"])
        self.assertEqual(info["reward_components"]["invalid_action"], -1.0)
        self.assertLess(reward, 0.0)
        self.assertFalse(terminated)
        self.assertFalse(truncated)
        self.assertEqual(len(env.move_log), 1)

    def test_role_mask_excludes_unauthorized_and_converter_retention(self):
        env = self._environment()
        env.reset()
        household_mask = env.action_mask("household")
        lender_mask = env.action_mask("lender")
        unknown_mask = env.action_mask("unknown")

        self.assertTrue(household_mask["node:Income:retention"])
        self.assertFalse(household_mask["node:Consumption:retention"])
        self.assertFalse(household_mask["edge:Income->Consumption:confidence"])
        self.assertTrue(lender_mask["edge:Income->Consumption:confidence"])
        self.assertFalse(any(unknown_mask.values()))

    def test_converter_retention_and_out_of_bounds_values_are_rejected_atomically(self):
        env = self._environment()
        env.reset()
        env.step(ParameterAction(
            parameter=ParameterName.RETENTION,
            target="Consumption",
            value=0.5,
            mode=MutationMode.SET,
        ), role="household")
        self.assertEqual(env.graph_snapshot.nodes["Consumption"]["retention"], 0.0)
        self.assertFalse(env.move_log[-1].accepted)

        env.step(ParameterAction(
            parameter=ParameterName.CONFIDENCE,
            target=("Income", "Consumption"),
            value=2.0,
            mode=MutationMode.SET,
        ), role="lender")
        self.assertEqual(env.graph_snapshot["Income"]["Consumption"]["confidence"], 0.8)
        self.assertFalse(env.move_log[-1].accepted)

        with self.assertRaises(ValueError):
            ParameterAction(
                parameter=ParameterName.CONFIDENCE,
                target=("Income", "Consumption"),
                value=math.inf,
                mode=MutationMode.SET,
            )

    def test_authorized_actions_apply_set_and_delta_with_typed_delay(self):
        env = self._environment()
        env.reset()
        env.step(ParameterAction(
            parameter=ParameterName.DECAY,
            target=("Income", "Consumption"),
            value=0.5,
            mode=MutationMode.SET,
        ), role="lender")
        env.step(ParameterAction(
            parameter=ParameterName.DELAY,
            target=("Income", "Consumption"),
            value=2,
            mode=MutationMode.DELTA,
        ), role="lender")

        edge = env.graph_snapshot["Income"]["Consumption"]
        self.assertEqual(edge["decay"], 0.5)
        self.assertEqual(edge["delay"], 2)
        self.assertTrue(all(record.accepted for record in env.move_log))

        numpy_action = ParameterAction(
            parameter=ParameterName.DECAY,
            target=("Income", "Consumption"),
            value=np.float64(-0.1),
        )
        self.assertEqual(float(numpy_action.value), -0.1)

    def test_reward_improves_when_action_matches_target_trajectory(self):
        payload = {
            "nodes": [{"name": "Level", "start_amount": 0, "retention": 1}],
            "edges": [],
        }
        policy = RoleBasedAuthorizationPolicy([RoleDefinition(
            name="controller",
            node_parameters=frozenset({ParameterName.START_AMOUNT}),
            node_targets=frozenset({"Level"}),
        )])
        env = FlowCLDEnvironment.from_payload(
            payload,
            authorization_policy=policy,
            target=TargetSpecification(trajectories={"Level": [1, 1, 1, 1]}),
            observation_builder=SimulationObservationBuilder(horizon=3),
            max_steps=1,
        )

        env.reset(seed=1)
        _, poor_reward, _, poor_truncated, _ = env.step(ParameterAction(
            parameter=ParameterName.START_AMOUNT,
            target="Level",
            value=0,
            mode=MutationMode.SET,
        ), role="controller")
        env.reset(seed=1)
        observation, matching_reward, _, matching_truncated, info = env.step(ParameterAction(
            parameter=ParameterName.START_AMOUNT,
            target="Level",
            value=1,
            mode=MutationMode.SET,
        ), role="controller")

        self.assertGreater(matching_reward, poor_reward)
        self.assertEqual(info["reward_components"]["trajectory_match"], 0.0)
        self.assertEqual(observation["history"]["Level"], [1.0, 1.0, 1.0, 1.0])
        self.assertTrue(poor_truncated)
        self.assertTrue(matching_truncated)

    def test_objective_mode_uses_canonical_potential_and_goal_termination(self):
        objective = Objective(
            name="Blue",
            target=TargetSpecification(behaviors={"Income": "Optimal"}),
            target_nodes=frozenset({"Income"}),
            gamma=0.99,
            goal_potential=-1.0,
        )
        environment = FlowCLDEnvironment.from_payload(
            _graph_payload(),
            authorization_policy=_policy(),
            objective=objective,
            observation_builder=SimulationObservationBuilder(horizon=2),
            max_steps=2,
        )
        _, reset_info = environment.reset(seed=8)
        self.assertIsNotNone(reset_info["objective_potential"])

        _, _, terminated, _, info = environment.step(NoOpAction(), role="household")

        self.assertTrue(terminated)
        self.assertIn("potential_shaping", info["reward_components"])
        self.assertIn("canonical_health", info["reward_components"])

    def test_invalid_target_specification_fails_early(self):
        with self.assertRaises(ValueError):
            self._environment(target=TargetSpecification(behaviors={"Missing": "Optimal"}))
        with self.assertRaises(ValueError):
            self._environment(target=TargetSpecification(behaviors={"Income": "Unknown"}))


if __name__ == "__main__":
    unittest.main()
