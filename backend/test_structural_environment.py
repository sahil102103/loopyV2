"""Stage 3 regression tests for controlled structural graph edits."""

import unittest
import math

import numpy as np

try:
    from flowcld_env import (
        AddEdgeAction,
        AddNodeAction,
        FlowCLDEnvironment,
        RemoveEdgeAction,
        RemoveNodeAction,
        RoleBasedAuthorizationPolicy,
        RoleDefinition,
        SimulationObservationBuilder,
        StructuralActionKind,
        StructuralTransaction,
        TargetSpecification,
    )
except ModuleNotFoundError:
    from backend.flowcld_env import (
        AddEdgeAction,
        AddNodeAction,
        FlowCLDEnvironment,
        RemoveEdgeAction,
        RemoveNodeAction,
        RoleBasedAuthorizationPolicy,
        RoleDefinition,
        SimulationObservationBuilder,
        StructuralActionKind,
        StructuralTransaction,
        TargetSpecification,
    )


ALL_STRUCTURAL_ACTIONS = frozenset(StructuralActionKind)


def _payload():
    return {
        "nodes": [
            {"name": "A", "start_amount": 0, "retention": 1},
            {"name": "B", "start_amount": 0, "retention": 1},
            {"name": "C", "start_amount": 0, "retention": 1},
            {"name": "D", "start_amount": 0, "retention": 1},
        ],
        "edges": [
            {"source": "A", "target": "B", "correlation": 0, "decay": 0},
            {"source": "B", "target": "C", "correlation": 0, "decay": 0},
            {"source": "C", "target": "D", "correlation": 0, "decay": 0},
            {"source": "D", "target": "A", "correlation": 0, "decay": 0},
        ],
    }


def _structural_policy():
    return RoleBasedAuthorizationPolicy([
        RoleDefinition(
            name="designer",
            structural_actions=ALL_STRUCTURAL_ACTIONS,
            node_targets=None,
            edge_targets=None,
        ),
        RoleDefinition(name="observer"),
    ])


class StructuralEnvironmentTests(unittest.TestCase):
    def _environment(self, *, target=None):
        return FlowCLDEnvironment.from_payload(
            _payload(),
            authorization_policy=_structural_policy(),
            target=target,
            observation_builder=SimulationObservationBuilder(horizon=2),
            max_steps=5,
        )

    def test_add_node_and_connect_transaction_is_atomic(self):
        env = self._environment()
        env.reset()

        _, _, _, _, rejected = env.step(AddNodeAction("E"), role="designer")
        self.assertFalse(rejected["action"]["accepted"])
        self.assertNotIn("E", env.graph_snapshot)
        self.assertIn("component_integrity", rejected["action"]["reason"])

        transaction = StructuralTransaction((
            AddNodeAction("E"),
            AddEdgeAction("D", "E", correlation=0.5, decay=0.1),
        ), label="extend feedback chain")
        observation, _, _, _, accepted = env.step(transaction, role="designer")

        self.assertTrue(accepted["action"]["accepted"])
        self.assertIn("E", observation["nodes"])
        self.assertIn(["D", "E"], observation["edges"])
        self.assertEqual(env.move_log[-1].after["added_nodes"], ["E"])
        self.assertEqual(env.move_log[-1].after["added_edges"], [["D", "E"]])

    def test_unauthorized_structural_action_does_not_mutate(self):
        env = self._environment()
        env.reset()
        before_nodes = set(env.graph_snapshot.nodes)
        _, _, _, _, info = env.step(RemoveNodeAction("B"), role="observer")

        self.assertFalse(info["action"]["accepted"])
        self.assertEqual(set(env.graph_snapshot.nodes), before_nodes)
        self.assertEqual(info["reward_components"]["invalid_action"], -1.0)

    def test_target_nodes_are_protected_automatically(self):
        env = self._environment(target=TargetSpecification(behaviors={"A": "Over-damped"}))
        env.reset()
        _, _, _, _, info = env.step(RemoveNodeAction("A"), role="designer")

        self.assertFalse(info["action"]["accepted"])
        self.assertIn("Protected nodes", info["action"]["reason"])
        self.assertIn("A", env.graph_snapshot)

    def test_bridge_removal_and_self_loop_are_rejected(self):
        payload = {
            "nodes": [
                {"name": "A", "retention": 1},
                {"name": "B", "retention": 1},
                {"name": "C", "retention": 1},
            ],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "C"},
            ],
        }
        env = FlowCLDEnvironment.from_payload(
            payload,
            authorization_policy=_structural_policy(),
            observation_builder=SimulationObservationBuilder(horizon=1),
        )
        env.reset()
        _, _, _, _, bridge = env.step(RemoveEdgeAction("B", "C"), role="designer")
        self.assertFalse(bridge["action"]["accepted"])
        self.assertIn("fragment", bridge["action"]["reason"])
        self.assertTrue(env.graph_snapshot.has_edge("B", "C"))

        _, _, _, _, loop = env.step(AddEdgeAction("A", "A"), role="designer")
        self.assertFalse(loop["action"]["accepted"])
        self.assertIn("self-loops", loop["action"]["reason"])
        self.assertFalse(env.graph_snapshot.has_edge("A", "A"))

    def test_anti_collapse_rejects_large_destructive_transaction(self):
        env = self._environment()
        env.reset()
        transaction = StructuralTransaction((
            RemoveNodeAction("B"),
            RemoveNodeAction("C"),
            RemoveNodeAction("D"),
        ))
        _, _, _, _, info = env.step(transaction, role="designer")

        self.assertFalse(info["action"]["accepted"])
        self.assertIn("Anti-collapse", info["action"]["reason"])
        self.assertEqual(set(env.graph_snapshot.nodes), {"A", "B", "C", "D"})
        self.assertEqual(set(env.graph_snapshot.edges), {("A", "B"), ("B", "C"), ("C", "D"), ("D", "A")})

    def test_safe_edge_removal_commits_and_receives_preservation_penalty(self):
        env = self._environment()
        env.reset()
        observation, reward, _, _, info = env.step(RemoveEdgeAction("D", "A"), role="designer")

        self.assertTrue(info["action"]["accepted"])
        self.assertNotIn(["D", "A"], observation["edges"])
        self.assertLess(info["reward_components"]["structural_preservation"], 0.0)
        self.assertLess(reward, 0.0)

    def test_structural_mask_reflects_authorization_and_safety(self):
        env = self._environment(target=TargetSpecification(behaviors={"A": "Over-damped"}))
        env.reset()
        designer = env.structural_action_mask("designer")
        observer = env.structural_action_mask("observer")

        self.assertTrue(designer["kinds"]["add_node"])
        self.assertFalse(designer["removable_nodes"]["A"])
        self.assertFalse(any(observer["kinds"].values()))
        self.assertFalse(any(observer["removable_nodes"].values()))
        self.assertFalse(any(observer["removable_edges"].values()))

    def test_structural_value_objects_reject_unsafe_values(self):
        with self.assertRaises(ValueError):
            AddNodeAction("Unsafe", start_amount=math.inf)
        with self.assertRaises(TypeError):
            AddNodeAction("Unsafe", retention=0, formula=123)
        action = AddEdgeAction("A", "B", delay=np.int64(2))
        self.assertEqual(action.delay, 2)
        self.assertEqual(AddNodeAction("Safe").to_dict()["ceiling"], "Infinity")


if __name__ == "__main__":
    unittest.main()
