"""Stage 4 API tests for multi-team logs and deterministic Canvas replay."""

import math
import os
import sys
import unittest


BACKEND_DIR = os.path.dirname(__file__)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app import app


def _payload():
    return {
        "nodes": [
            {"name": "A", "start_amount": 1.0, "retention": 0.5},
            {"name": "B", "start_amount": 1.0, "retention": 0.5},
            {"name": "C", "start_amount": 1.0, "retention": 0.5},
        ],
        "edges": [
            {"source": "A", "target": "B", "correlation": 0.2, "decay": 0.1},
            {"source": "B", "target": "C", "correlation": 0.2, "decay": 0.1},
            {"source": "C", "target": "A", "correlation": 0.2, "decay": 0.1},
        ],
        "teams": [
            {
                "id": "household",
                "name": "Household",
                "weight": 2,
                "objective": {"trajectories": {"A": [1, 1, 1]}},
                "permissions": {
                    "node_parameters": ["start_amount"],
                    "node_targets": ["A"],
                },
            },
            {
                "id": "bank",
                "name": "Bank",
                "objective": {"behaviors": {"B": "Optimal"}},
                "permissions": {
                    "edge_parameters": ["decay"],
                    "edge_targets": [["A", "B"]],
                },
            },
            {
                "id": "designer",
                "name": "Designer",
                "objective": {"behaviors": {"C": "Optimal"}},
                "permissions": {
                    "structural_actions": ["add_node", "add_edge"],
                    "node_targets": None,
                    "edge_targets": None,
                },
            },
        ],
        "moves": [
            {
                "team_id": "household",
                "action": {
                    "kind": "parameter",
                    "parameter": "start_amount",
                    "target": "A",
                    "value": 2,
                    "mode": "set",
                },
            },
            {
                "team_id": "bank",
                "action": {
                    "kind": "parameter",
                    "parameter": "start_amount",
                    "target": "A",
                    "value": 4,
                    "mode": "set",
                },
            },
            {
                "team_id": "designer",
                "action": {
                    "kind": "structural_transaction",
                    "label": "Extend model",
                    "edits": [
                        {"kind": "add_node", "name": "D", "start_amount": 0.5, "retention": 0.5},
                        {"kind": "add_edge", "source": "C", "target": "D", "correlation": 0.2},
                    ],
                },
            },
        ],
        "iterations": 2,
        "seed": 13,
    }


def _two_node_balance_payload():
    return {
        "nodes": [
            {"name": "A", "start_amount": 1.0, "retention": 1.0},
            {"name": "B", "start_amount": 0.5, "retention": 1.0},
        ],
        "edges": [
            {
                "source": "A", "target": "B", "correlation": 0.8,
                "decay": 0.0, "confidence": 1.0, "delay": 0,
            },
            {
                "source": "B", "target": "A", "correlation": -0.8,
                "decay": 0.0, "confidence": 1.0, "delay": 0,
            },
        ],
        "teams": [{
            "id": "simple-balancer",
            "name": "Simple balancer",
            "orientation": "stabilize",
            "owned_nodes": ["A", "B"],
            "target_nodes": ["A", "B"],
            "objective": {
                "behaviors": {"A": "Optimal", "B": "Optimal"},
                "spectral_radius": 0.95,
            },
            "preset": "balanced",
            "gamma": 1.0,
            "parameter_move_cost": 0.0,
            "move_budget": 9,
            "min_live_nodes": 2,
            "permissions": {
                "node_parameters": ["retention"],
                "edge_parameters": ["decay"],
                "node_targets": None,
                "edge_targets": None,
            },
        }],
        "moves": [],
        "agent_strategy": "greedy",
        "agent_turns": 9,
        "iterations": 30,
        "seed": 42,
    }


def _autonomous_structural_payload():
    return {
        "nodes": [
            {"name": "a", "start_amount": 1.0, "retention": 1.0},
            {"name": "b", "start_amount": 0.5, "retention": 1.0},
        ],
        "edges": [
            {"source": "a", "target": "b", "correlation": 0.8, "decay": 0.0},
            {"source": "b", "target": "a", "correlation": 0.8, "decay": 0.0},
        ],
        "teams": [{
            "id": "green",
            "name": "Green",
            "orientation": "stabilize",
            "owned_nodes": ["a"],
            "target_nodes": ["b"],
            "objective": {
                "behaviors": {"b": "Optimal"},
                "spectral_radius": 0.95,
            },
            "preset": "stability_first",
            "gamma": 1.0,
            "structural_move_cost": 0.0,
            "move_budget": 1,
            "structural_budget": 3,
            "min_live_nodes": 2,
            "permissions": {
                "structural_actions": ["add_node", "add_edge"],
                "node_targets": None,
                "edge_targets": None,
            },
        }],
        "moves": [],
        "agent_strategy": "greedy",
        "agent_turns": 1,
        "iterations": 10,
        "seed": 42,
    }


def _two_node_spectral_radius(graph):
    nodes = {node["name"]: node for node in graph["nodes"]}
    edges = {(edge["source"], edge["target"]): edge for edge in graph["edges"]}
    a = float(nodes["A"]["retention"])
    d = float(nodes["B"]["retention"])
    b_to_a = edges[("B", "A")]
    a_to_b = edges[("A", "B")]
    b = float(b_to_a["correlation"]) * (1.0 - float(b_to_a["decay"]))
    c = float(a_to_b["correlation"]) * (1.0 - float(a_to_b["decay"]))
    trace = a + d
    determinant = a * d - b * c
    discriminant = trace * trace - 4.0 * determinant
    if discriminant >= 0.0:
        root = math.sqrt(discriminant)
        return max(abs((trace + root) / 2.0), abs((trace - root) / 2.0))
    return math.sqrt(max(0.0, determinant))


class TeamSessionApiTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_session_returns_team_scores_move_log_and_replay_frames(self):
        response = self.client.post("/agent/team-sessions/run", json=_payload())
        self.assertEqual(response.status_code, 200)
        result = response.get_json()

        self.assertEqual(len(result["teams"]), 3)
        self.assertEqual(len(result["move_log"]), 3)
        self.assertEqual(len(result["frames"]), 4)
        self.assertEqual(result["accepted_moves"], 2)
        self.assertEqual(result["rejected_moves"], 1)
        self.assertFalse(result["move_log"][1]["accepted"])
        self.assertEqual(result["frames"][1]["graph"], result["frames"][2]["graph"])
        self.assertEqual(result["final"]["schema_version"], "flowcld.model.v1")
        self.assertEqual(
            result["frames"][0]["graph"]["schema_version"],
            "flowcld.model.v1",
        )
        self.assertIn("D", [node["name"] for node in result["final"]["nodes"]])
        self.assertEqual(len(result["replay_digest"]), 64)

    def test_identical_request_produces_identical_replay(self):
        first = self.client.post("/agent/team-sessions/run", json=_payload()).get_json()
        second = self.client.post("/agent/team-sessions/run", json=_payload()).get_json()
        self.assertEqual(first["replay_digest"], second["replay_digest"])
        self.assertEqual(first["frames"], second["frames"])

    def test_versioned_team_request_is_accepted_and_unknown_version_is_rejected(self):
        payload = _payload()
        payload["request_schema_version"] = "flowcld.team-session.v1"
        response = self.client.post("/agent/team-sessions/run", json=payload)
        self.assertEqual(response.status_code, 200, response.get_json())

        payload["request_schema_version"] = "flowcld.team-session.v999"
        response = self.client.post("/agent/team-sessions/run", json=payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("Unsupported team-session schema", response.get_json()["error"])

        payload = _payload()
        payload["schema_version"] = "flowcld.model.v999"
        response = self.client.post("/agent/team-sessions/run", json=payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("Unsupported model schema version", response.get_json()["error"])

    def test_unknown_team_and_unknown_objective_node_return_400(self):
        payload = _payload()
        payload["moves"][0]["team_id"] = "missing"
        response = self.client.post("/agent/team-sessions/run", json=payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("unknown team", response.get_json()["error"])

        payload = _payload()
        payload["teams"][0]["objective"] = {"behaviors": {"Missing": "Optimal"}}
        response = self.client.post("/agent/team-sessions/run", json=payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("unknown nodes", response.get_json()["error"])

    def test_agent_turns_generate_auditable_replay_without_manual_moves(self):
        payload = _payload()
        payload["moves"] = []
        payload["agent_turns"] = 3
        payload["teams"][0]["orientation"] = "stabilize"
        payload["teams"][1]["orientation"] = "disrupt"

        response = self.client.post("/agent/team-sessions/run", json=payload)
        self.assertEqual(response.status_code, 200)
        result = response.get_json()

        self.assertEqual(result["agent_turns"], 3)
        self.assertEqual(len(result["move_log"]), 3)
        self.assertEqual(len(result["frames"]), 4)
        self.assertTrue(all("objective_rewards" in move for move in result["move_log"]))

    def test_greedy_agent_can_add_and_connect_a_new_node_autonomously(self):
        response = self.client.post(
            "/agent/team-sessions/run", json=_autonomous_structural_payload()
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        result = response.get_json()

        self.assertEqual(result["move_log"][0]["action"]["kind"], "structural_transaction")
        self.assertIn("parallel balancing path", result["move_log"][0]["action"]["label"])
        self.assertIn("c", {node["name"] for node in result["final"]["nodes"]})
        edges = {
            (edge["source"], edge["target"])
            for edge in result["final"]["edges"]
        }
        self.assertTrue(
            {("a", "c"), ("c", "b")} <= edges
            or {("b", "c"), ("c", "a")} <= edges
        )

    def test_actor_critic_strategy_trains_one_team_and_keeps_replay_contract(self):
        payload = _payload()
        payload.update({
            "moves": [],
            "agent_turns": 1,
            "agent_strategy": "actor_critic",
            "learner_team_id": "household",
            "training_episodes": 3,
            "training_steps": 2,
            "n_step": 2,
            "planning_depth": 2,
            "evaluation_seeds": 0,
        })

        response = self.client.post("/agent/team-sessions/run", json=payload)
        self.assertEqual(response.status_code, 200, response.get_json())
        result = response.get_json()

        self.assertEqual(result["agent_strategy"], "actor_critic")
        self.assertEqual(result["learning"]["team_id"], "household")
        self.assertEqual(result["learning"]["algorithm"], "n_step_actor_critic")
        self.assertEqual(len(result["learning"]["history"]), 3)
        self.assertEqual(result["learning"]["opponent_mode"], "frozen_hold")
        self.assertEqual(result["learning"]["planning_depth"], 2)
        self.assertEqual(
            result["learning"]["action_space"],
            "bounded_parameters_and_structural_motifs",
        )
        self.assertEqual(
            result["learning"]["deployment_guard"],
            "simulator_shortlist_with_spectral_completion",
        )
        self.assertEqual(len(result["frames"]), 2)
        self.assertEqual(len(result["move_log"]), 1)

    def test_actor_critic_deployment_can_select_a_structural_motif(self):
        payload = _autonomous_structural_payload()
        payload.update({
            "agent_strategy": "actor_critic",
            "learner_team_id": "green",
            "training_episodes": 3,
            "training_steps": 2,
            "n_step": 2,
            "planning_depth": 1,
        })

        response = self.client.post("/agent/team-sessions/run", json=payload)
        self.assertEqual(response.status_code, 200, response.get_json())
        result = response.get_json()

        self.assertEqual(
            result["move_log"][0]["action"]["kind"],
            "structural_transaction",
        )
        self.assertIn("c", {node["name"] for node in result["final"]["nodes"]})

    def test_actor_critic_rejects_unknown_learner_team(self):
        payload = _payload()
        payload.update({
            "moves": [],
            "agent_strategy": "actor_critic",
            "learner_team_id": "missing",
            "training_episodes": 1,
        })
        response = self.client.post("/agent/team-sessions/run", json=payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("unknown team", response.get_json()["error"])

    def test_two_node_balancer_changes_parameters_and_reaches_linear_stability(self):
        response = self.client.post(
            "/agent/team-sessions/run", json=_two_node_balance_payload()
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        result = response.get_json()

        self.assertGreater(_two_node_spectral_radius(result["baseline"]), 1.0)
        self.assertLessEqual(_two_node_spectral_radius(result["final"]), 0.95 + 1e-9)
        self.assertNotEqual(result["baseline"], result["final"])
        team = result["teams"][0]
        self.assertEqual(team["objective"]["spectral_radius"], 0.95)
        self.assertEqual(team["final_components"]["spectral_target_met"], 1.0)
        self.assertGreater(team["final_components"]["target_activity"], 0.0)
        self.assertEqual(len(result["final"]["nodes"]), 2)
        self.assertEqual(len(result["final"]["edges"]), 2)
        self.assertGreater(
            result["teams"][0]["final_reward"],
            result["teams"][0]["initial_reward"],
        )
        self.assertTrue(all(move["accepted"] for move in result["move_log"]))

    def test_invalid_spectral_objective_returns_400(self):
        payload = _two_node_balance_payload()
        payload["teams"][0]["objective"]["spectral_radius"] = 1.0
        response = self.client.post("/agent/team-sessions/run", json=payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("less than 1", response.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
