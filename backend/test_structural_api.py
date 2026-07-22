"""API coverage for the Stage 3 controlled structural-edit adapter."""

import os
import sys
import unittest


BACKEND_DIR = os.path.dirname(__file__)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app import app


def _graph_payload():
    return {
        "nodes": [
            {"name": "A", "start_amount": 0.1, "retention": 0.8},
            {"name": "B", "start_amount": 0.1, "retention": 0.8},
            {"name": "C", "start_amount": 0.1, "retention": 0.8},
            {"name": "D", "start_amount": 0.1, "retention": 0.8},
        ],
        "edges": [
            {"source": "A", "target": "B", "correlation": 0.2},
            {"source": "B", "target": "C", "correlation": 0.2},
            {"source": "C", "target": "D", "correlation": 0.2},
            {"source": "D", "target": "A", "correlation": 0.2},
        ],
        "iterations": 2,
    }


class StructuralApiTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_atomic_add_node_and_edge_returns_an_accepted_candidate(self):
        payload = _graph_payload()
        payload["edits"] = [
            {"kind": "add_node", "name": "E", "start_amount": 0.2, "retention": 0.7},
            {
                "kind": "add_edge",
                "source": "D",
                "target": "E",
                "correlation": 0.5,
                "decay": 0.1,
                "confidence": 0.9,
                "delay": 1,
            },
        ]

        response = self.client.post("/agent/structural-edits/preview", json=payload)
        self.assertEqual(response.status_code, 200)
        result = response.get_json()
        self.assertTrue(result["accepted"])
        self.assertIn("E", [node["name"] for node in result["candidate"]["nodes"]])
        self.assertIn(["D", "E"], result["summary"]["added_edges"])

    def test_isolated_node_preview_is_rejected_without_changing_candidate(self):
        payload = _graph_payload()
        payload["edits"] = [{"kind": "add_node", "name": "E"}]

        response = self.client.post("/agent/structural-edits/preview", json=payload)
        self.assertEqual(response.status_code, 200)
        result = response.get_json()
        self.assertFalse(result["accepted"])
        self.assertIn("component_integrity", result["reason"])
        self.assertNotIn("E", [node["name"] for node in result["candidate"]["nodes"]])

    def test_protected_node_removal_is_rejected(self):
        payload = _graph_payload()
        payload["protected_nodes"] = ["A"]
        payload["edits"] = [{"kind": "remove_node", "name": "A"}]

        response = self.client.post("/agent/structural-edits/preview", json=payload)
        self.assertEqual(response.status_code, 200)
        result = response.get_json()
        self.assertFalse(result["accepted"])
        self.assertIn("Protected nodes", result["reason"])

    def test_malformed_or_ambiguous_requests_return_400(self):
        payload = _graph_payload()
        payload["edits"] = []
        response = self.client.post("/agent/structural-edits/preview", json=payload)
        self.assertEqual(response.status_code, 400)

        payload = _graph_payload()
        payload["edges"].append(dict(payload["edges"][0]))
        payload["edits"] = [{"kind": "remove_edge", "source": "A", "target": "B"}]
        response = self.client.post("/agent/structural-edits/preview", json=payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("unique directed edges", response.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
