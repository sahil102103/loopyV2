"""Regression tests for connected multi-node spectral balancing."""

import os
import sys
import unittest

import numpy as np


BACKEND_DIR = os.path.dirname(__file__)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app import app


def _connected_model():
    nodes = [
        {"name": name, "start_amount": start, "retention": 0.90}
        for name, start in zip(("A", "B", "C", "D"), (1.0, 0.8, 0.6, 0.4))
    ]
    edges = []
    for source, target in (("A", "B"), ("B", "C"), ("C", "D"), ("D", "A")):
        edges.append({
            "source": source,
            "target": target,
            "correlation": 0.65,
            "decay": 0.0,
            "confidence": 1.0,
            "delay": 0,
            "functional_form": "linear",
        })
    edges.append({
        "source": "A",
        "target": "C",
        "correlation": -0.20,
        "decay": 0.0,
        "confidence": 1.0,
        "delay": 0,
        "functional_form": "linear",
    })
    return {
        "nodes": nodes,
        "edges": edges,
        "target_spectral_radius": 0.95,
        "iterations": 30,
        "seed": 42,
    }


def _spectral_radius(graph):
    names = [node["name"] for node in graph["nodes"]]
    index = {name: position for position, name in enumerate(names)}
    matrix = np.zeros((len(names), len(names)), dtype=float)
    for node in graph["nodes"]:
        matrix[index[node["name"]], index[node["name"]]] = float(node["retention"])
    for edge in graph["edges"]:
        matrix[index[edge["target"]], index[edge["source"]]] += (
            float(edge["correlation"]) * (1.0 - float(edge.get("decay", 0.0)))
        )
    return float(np.max(np.abs(np.linalg.eigvals(matrix))))


class ModelBalanceApiTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_connected_model_returns_reviewable_target_meeting_plan(self):
        payload = _connected_model()
        response = self.client.post("/agent/model-balance/run", json=payload)
        self.assertEqual(response.status_code, 200, response.get_json())
        result = response.get_json()
        balance = result["model_balance"]

        self.assertGreater(_spectral_radius(result["baseline"]), 1.0)
        self.assertLessEqual(_spectral_radius(result["final"]), 0.95 + 1e-9)
        self.assertTrue(balance["target_met"])
        self.assertTrue(balance["requires_explicit_apply"])
        self.assertTrue(balance["structure_preserved"])
        self.assertEqual(balance["planner"], "connected_graph_spectral_balance")
        self.assertGreater(len(balance["changes"]), 0)
        self.assertEqual(len(balance["changes"]), len(balance["planned_actions"]))
        self.assertGreaterEqual(
            balance["transmission_ratio"],
            balance["bounds"]["minimum_transmission_ratio"] - 1e-9,
        )
        self.assertIn("baseline", balance["notebook_validation"])
        self.assertIn("final", balance["notebook_validation"])

        baseline_edges = {
            (edge["source"], edge["target"]): edge["correlation"]
            for edge in result["baseline"]["edges"]
        }
        final_edges = {
            (edge["source"], edge["target"]): edge["correlation"]
            for edge in result["final"]["edges"]
        }
        self.assertEqual(final_edges, baseline_edges)

    def test_user_can_allow_decay_only(self):
        payload = _connected_model()
        payload.update({
            "target_spectral_radius": 0.99,
            "adjust_retention": False,
            "adjust_decay": True,
            "max_decay": 0.88,
        })
        response = self.client.post("/agent/model-balance/run", json=payload)
        self.assertEqual(response.status_code, 200, response.get_json())
        result = response.get_json()

        baseline_retention = {
            node["name"]: node["retention"] for node in result["baseline"]["nodes"]
        }
        final_retention = {
            node["name"]: node["retention"] for node in result["final"]["nodes"]
        }
        self.assertEqual(final_retention, baseline_retention)
        self.assertTrue(result["model_balance"]["changes"])
        self.assertTrue(all(
            change["parameter"] == "decay"
            for change in result["model_balance"]["changes"]
        ))

    def test_impossible_bounds_return_a_clear_client_error(self):
        payload = _connected_model()
        payload.update({
            "target_spectral_radius": 0.50,
            "adjust_retention": True,
            "adjust_decay": False,
            "min_retention": 0.80,
        })
        response = self.client.post("/agent/model-balance/run", json=payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("No plan met the target", response.get_json()["error"])

    def test_nonlinear_edges_are_rejected_without_mutation(self):
        payload = _connected_model()
        payload["edges"][0]["functional_form"] = "sigmoid"
        response = self.client.post("/agent/model-balance/run", json=payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("functional form", response.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
