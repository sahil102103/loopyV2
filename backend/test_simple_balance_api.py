"""Regression tests for the direct two-node starter balance workflow."""

import math
import os
import sys
import unittest


BACKEND_DIR = os.path.dirname(__file__)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app import app


def _exact_reported_graph():
    return {
        "nodes": [
            {"name": "a", "start_amount": 1.0, "retention": 1.0},
            {"name": "b", "start_amount": 0.5, "retention": 1.0},
        ],
        "edges": [
            {
                "source": "b",
                "target": "a",
                "correlation": -0.8,
                "decay": 0.0,
                "confidence": 0.0,
                "delay": 0,
                "functional_form": "linear",
            },
            {
                "source": "a",
                "target": "b",
                "correlation": 0.8,
                "decay": 0.0,
                "confidence": 0.0,
                "delay": 0,
                "functional_form": "linear",
            },
        ],
        "iterations": 50,
        "seed": 42,
    }


def _spectral_radius(graph):
    nodes = {node["name"]: node for node in graph["nodes"]}
    edges = {(edge["source"], edge["target"]): edge for edge in graph["edges"]}
    a = float(nodes["a"]["retention"])
    d = float(nodes["b"]["retention"])
    b_to_a = edges[("b", "a")]
    a_to_b = edges[("a", "b")]
    b = float(b_to_a["correlation"]) * (1.0 - float(b_to_a["decay"]))
    c = float(a_to_b["correlation"]) * (1.0 - float(a_to_b["decay"]))
    trace = a + d
    determinant = a * d - b * c
    discriminant = trace * trace - 4.0 * determinant
    if discriminant >= 0.0:
        root = math.sqrt(discriminant)
        return max(abs((trace + root) / 2.0), abs((trace - root) / 2.0))
    return math.sqrt(max(0.0, determinant))


class SimpleBalanceApiTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_exact_reported_loop_reaches_direct_stability_at_50_steps(self):
        response = self.client.post(
            "/agent/simple-balance/run", json=_exact_reported_graph()
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        result = response.get_json()

        self.assertGreater(_spectral_radius(result["baseline"]), 1.0)
        self.assertLessEqual(_spectral_radius(result["final"]), 0.99 + 1e-9)
        self.assertTrue(result["simple_balance"]["stable"])
        self.assertTrue(result["simple_balance"]["structure_preserved"])
        self.assertEqual(
            result["simple_balance"]["planner"], "two_node_linear_stability"
        )
        self.assertGreater(result["accepted_moves"], 0)
        self.assertEqual(result["rejected_moves"], 0)
        self.assertTrue(all(move["accepted"] for move in result["move_log"]))
        self.assertTrue(all(
            move["action"]["parameter"] in {"retention", "decay"}
            for move in result["move_log"]
        ))

        baseline_edges = {
            (edge["source"], edge["target"]): edge["correlation"]
            for edge in result["baseline"]["edges"]
        }
        final_edges = {
            (edge["source"], edge["target"]): edge["correlation"]
            for edge in result["final"]["edges"]
        }
        self.assertEqual(final_edges, baseline_edges)
        self.assertTrue(all(
            0.0 < float(node["retention"]) <= 1.0
            for node in result["final"]["nodes"]
        ))
        self.assertTrue(all(
            0.0 <= float(edge["decay"]) < 1.0
            for edge in result["final"]["edges"]
        ))

    def test_plan_and_replay_are_deterministic(self):
        first = self.client.post(
            "/agent/simple-balance/run", json=_exact_reported_graph()
        ).get_json()
        second = self.client.post(
            "/agent/simple-balance/run", json=_exact_reported_graph()
        ).get_json()
        self.assertEqual(first["final"], second["final"])
        self.assertEqual(first["replay_digest"], second["replay_digest"])

    def test_user_selected_target_is_met_without_disconnecting_the_loop(self):
        payload = _exact_reported_graph()
        payload["target_spectral_radius"] = 0.80
        response = self.client.post("/agent/simple-balance/run", json=payload)
        self.assertEqual(response.status_code, 200, response.get_json())
        result = response.get_json()

        self.assertEqual(result["simple_balance"]["target_spectral_radius"], 0.80)
        self.assertLessEqual(_spectral_radius(result["final"]), 0.80 + 1e-9)
        effective_transmission = sum(
            abs(float(edge["correlation"]) * (1.0 - float(edge["decay"])))
            for edge in result["final"]["edges"]
        )
        self.assertGreater(effective_transmission, 0.2)
        self.assertTrue(all(
            float(node["retention"]) > 0.0 for node in result["final"]["nodes"]
        ))

    def test_invalid_user_target_is_rejected(self):
        payload = _exact_reported_graph()
        payload["target_spectral_radius"] = 1.0
        response = self.client.post("/agent/simple-balance/run", json=payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("less than 1", response.get_json()["error"])

    def test_reinforcing_loop_falls_back_to_connected_graph_planner(self):
        payload = _exact_reported_graph()
        payload["edges"][0]["correlation"] = 0.8
        response = self.client.post("/agent/simple-balance/run", json=payload)
        self.assertEqual(response.status_code, 200, response.get_json())
        result = response.get_json()

        self.assertEqual(
            result["model_balance"]["planner"],
            "connected_graph_spectral_balance",
        )
        self.assertTrue(result["model_balance"]["target_met"])
        self.assertLessEqual(_spectral_radius(result["final"]), 0.99 + 1e-9)
        self.assertGreater(len(result["model_balance"]["changes"]), 0)
        self.assertEqual(
            [edge["correlation"] for edge in result["final"]["edges"]],
            [edge["correlation"] for edge in result["baseline"]["edges"]],
        )


if __name__ == "__main__":
    unittest.main()
