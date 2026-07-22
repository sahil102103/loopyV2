"""Regression coverage for the notebook source-of-truth boundary."""

import unittest

import networkx as nx
import numpy as np

try:
    from advanced_analysis import (
        compute_legacy_loop_transition_matrix,
        compute_runtime_linear_transition_matrix,
        compute_uniform_sweep_transition_matrix,
        compute_adjacency_matrix_stability_unique,
        graph_state_config,
    )
    from flowcld_env import NotebookEngineAdapter, NotebookSpectralAnalyzer
except ModuleNotFoundError:
    from backend.advanced_analysis import (
        compute_legacy_loop_transition_matrix,
        compute_runtime_linear_transition_matrix,
        compute_uniform_sweep_transition_matrix,
        compute_adjacency_matrix_stability_unique,
        graph_state_config,
    )
    from backend.flowcld_env import NotebookEngineAdapter, NotebookSpectralAnalyzer


class NotebookEngineAdapterTests(unittest.TestCase):
    def test_evaluation_exposes_full_notebook_component_contract(self):
        graph = nx.DiGraph()
        graph.add_node("A", start_amount=1.0, retention=0.5)
        graph.add_node("B", start_amount=0.5, retention=0.4)
        graph.add_edge("A", "B", correlation=0.3, decay=0.2, delay=0, confidence=1.0)

        evaluation = NotebookEngineAdapter.default().evaluate(
            graph, preset="balanced", steps=8
        )

        expected = {
            "dist", "lam_max", "z_max", "shape_mean", "dead_ratio",
            "late_drift", "flatline_pen", "transmission_ratio",
            "terminal_weak_pen", "tail_weak_pen", "dominance_pen",
        }
        self.assertTrue(expected.issubset(evaluation.components))
        self.assertGreaterEqual(evaluation.health, 0.0)
        self.assertLessEqual(evaluation.health, 1.0)

    def test_graph_state_config_preserves_signed_correlation(self):
        graph = nx.DiGraph()
        graph.add_node("A", start_amount=1.0, retention=0.5)
        graph.add_node("B", start_amount=1.0, retention=0.5)
        graph.add_edge("A", "B", correlation=-0.7, decay=0.2, delay=1, confidence=0.8)

        config = graph_state_config(graph)

        self.assertEqual(config["edge_correlation_map"][("A", "B")], -0.7)

    def test_spectral_analyzer_matches_notebook_transition_matrix(self):
        graph = nx.DiGraph()
        graph.add_node("A", retention=0.8)
        graph.add_node("B", retention=0.6)
        graph.add_node("C", retention=0.4)
        graph.add_edge("A", "B", correlation=0.7, decay=0.2)
        graph.add_edge("B", "C", correlation=-0.5, decay=0.1)
        graph.add_edge("C", "A", correlation=0.3, decay=0.4)

        notebook_matrix, notebook_nodes = compute_adjacency_matrix_stability_unique(graph)
        analyzer = NotebookSpectralAnalyzer()

        self.assertEqual(notebook_nodes, list(graph.nodes))
        self.assertEqual(analyzer.transition_matrix(graph).tolist(), notebook_matrix.tolist())
        self.assertAlmostEqual(
            analyzer.spectral_radius(graph),
            max(abs(value) for value in np.linalg.eigvals(notebook_matrix)),
        )

    def test_three_matrix_models_are_explicitly_distinct(self):
        graph = nx.DiGraph()
        graph.add_node("A", retention=0.6)
        graph.add_node("B", retention=0.4)
        graph.add_edge("A", "B", correlation=0.7, decay=0.2)

        runtime, _ = compute_runtime_linear_transition_matrix(graph)
        sweep, _ = compute_uniform_sweep_transition_matrix(graph, 0.2)
        loop, _ = compute_legacy_loop_transition_matrix(graph, 0.2)

        self.assertAlmostEqual(runtime[0, 0], 0.6)
        self.assertAlmostEqual(runtime[1, 0], 0.56)
        self.assertAlmostEqual(sweep[0, 0], 0.8)
        self.assertAlmostEqual(sweep[1, 0], 0.14)
        self.assertAlmostEqual(loop[0, 0], 0.8)
        self.assertAlmostEqual(loop[1, 0], 0.7)

        mapped, _ = compute_adjacency_matrix_stability_unique(
            graph,
            node_retention_map={"A": 0.2, "B": 0.3},
            edge_decay_map={("A", "B"): 0.5},
        )
        self.assertAlmostEqual(mapped[0, 0], 0.2)
        self.assertAlmostEqual(mapped[1, 1], 0.3)
        self.assertAlmostEqual(mapped[1, 0], 0.35)


if __name__ == "__main__":
    unittest.main()
