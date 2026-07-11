"""Regression coverage for the canonical graph payload builder."""

import unittest

try:
    from advanced_analysis import (
        GraphValidationError,
        apply_config_to_graph,
        build_graph_from_payload,
        simulate_two_phase,
    )
except ModuleNotFoundError:
    from backend.advanced_analysis import (
        GraphValidationError,
        apply_config_to_graph,
        build_graph_from_payload,
        simulate_two_phase,
    )


class GraphPayloadValidationTests(unittest.TestCase):
    def test_zero_values_and_formula_converter_are_preserved(self):
        graph = build_graph_from_payload({
            "nodes": [
                {"name": "Income", "start_amount": 0, "retention": 1},
                {"name": "Consumption", "start_amount": 0, "retention": 0, "formula": "0.6 * nxt['Income']"},
            ],
            "edges": [
                {"source": "Income", "target": "Consumption", "correlation": 0, "decay": 0, "confidence": 0, "delay": 0},
            ],
        })
        self.assertEqual(graph.nodes["Income"]["start_amount"], 0.0)
        self.assertEqual(graph.nodes["Consumption"]["retention"], 0.0)
        self.assertEqual(graph["Income"]["Consumption"]["correlation"], 0.0)
        self.assertEqual(graph["Income"]["Consumption"]["confidence"], 0.0)
        self.assertEqual(apply_config_to_graph(graph, {"retention": 0.8}).nodes["Consumption"]["retention"], 0.0)

    def test_duplicate_and_dangling_references_are_rejected(self):
        with self.assertRaises(GraphValidationError):
            build_graph_from_payload({"nodes": [{"name": "A"}, {"name": "A"}], "edges": []})
        with self.assertRaises(GraphValidationError):
            build_graph_from_payload({"nodes": [{"name": "A"}], "edges": [{"source": "A", "target": "Missing"}]})

    def test_notebook_converter_formula_runs_through_canonical_graph(self):
        graph = build_graph_from_payload({
            "nodes": [
                {"name": "Income", "start_amount": 100, "retention": 1},
                {"name": "Consumption", "start_amount": 0, "retention": 0, "formula": "0.6 * nxt['Income']"},
            ],
            "edges": [],
        })
        history = simulate_two_phase(
            graph,
            {node: graph.nodes[node]["start_amount"] for node in graph.nodes},
            1,
        )
        self.assertEqual(history["Consumption"][1], 60.0)

    def test_endpoint_defaults_can_be_preserved_without_bypassing_validation(self):
        graph = build_graph_from_payload(
            {
                "nodes": [{"name": "A"}, {"name": "B"}],
                "edges": [{"source": "A", "target": "B"}],
            },
            defaults={"start_amount": 0.0, "retention": 1.0, "decay": 0.6, "confidence": 0.8},
        )
        self.assertEqual(graph.nodes["A"]["start_amount"], 0.0)
        self.assertEqual(graph["A"]["B"]["decay"], 0.6)
        self.assertEqual(graph["A"]["B"]["confidence"], 0.8)


if __name__ == "__main__":
    unittest.main()
