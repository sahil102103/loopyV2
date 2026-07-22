"""Cross-path regression tests for ``flowcld.simulation.v1``."""

from __future__ import annotations

import json
import math
from pathlib import Path
import unittest

import networkx as nx
import numpy as np

try:
    from advanced_analysis import GraphValidationError, build_graph_from_payload
    from flowcld_env import NotebookEngineAdapter
    from simulation_engine import (
        MODEL_SCHEMA_VERSION,
        SIMULATION_CONTRACT_VERSION,
        MultiplicativeGaussianNoise,
        SimulationContractError,
        evaluate_bound,
        simulate_two_phase,
    )
except ModuleNotFoundError:
    from backend.advanced_analysis import GraphValidationError, build_graph_from_payload
    from backend.flowcld_env import NotebookEngineAdapter
    from backend.simulation_engine import (
        MODEL_SCHEMA_VERSION,
        SIMULATION_CONTRACT_VERSION,
        MultiplicativeGaussianNoise,
        SimulationContractError,
        evaluate_bound,
        simulate_two_phase,
    )


FIXTURE_DIR = Path(__file__).parent / "tests" / "simulation_contract" / "v1"


class SimulationContractTests(unittest.TestCase):
    def test_every_fixture_matches_every_notebook_reference_timestep(self):
        fixture_paths = sorted(FIXTURE_DIR.glob("*.json"))
        self.assertEqual(len(fixture_paths), 5)
        notebook_adapter = NotebookEngineAdapter.default()
        for path in fixture_paths:
            with self.subTest(fixture=path.stem):
                payload = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(payload["schema_version"], MODEL_SCHEMA_VERSION)
                self.assertEqual(
                    payload["simulation_contract"], SIMULATION_CONTRACT_VERSION
                )
                graph = build_graph_from_payload(payload)
                history = simulate_two_phase(
                    graph,
                    {
                        node: graph.nodes[node]["start_amount"]
                        for node in graph.nodes
                    },
                    payload["steps"],
                )
                notebook_history = notebook_adapter.simulate(
                    graph, payload["steps"]
                )
                self.assertEqual(history, notebook_history)
                self.assertEqual(set(history), set(payload["expected_history"]))
                for node, expected in payload["expected_history"].items():
                    np.testing.assert_allclose(
                        history[node], expected, rtol=1e-12, atol=1e-12
                    )

    def test_zero_noise_uses_the_exact_deterministic_engine(self):
        payload = json.loads(
            (FIXTURE_DIR / "linear_stocks.json").read_text(encoding="utf-8")
        )
        graph = build_graph_from_payload(payload)
        initial = {
            node: graph.nodes[node]["start_amount"] for node in graph.nodes
        }
        deterministic = simulate_two_phase(graph, initial, payload["steps"])
        noisy = simulate_two_phase(
            graph,
            initial,
            payload["steps"],
            noise=MultiplicativeGaussianNoise(
                sigma_map={node: 0.0 for node in graph},
                rng=np.random.default_rng(42),
            ),
        )
        self.assertEqual(noisy, deterministic)

    def test_formula_failures_are_neutral_but_nonfinite_state_is_rejected(self):
        graph = nx.DiGraph()
        graph.add_node(
            "Converter",
            start_amount=3.0,
            retention=0.0,
            formula="1 / 0",
            sink_formula="math.exp(10000)",
        )
        self.assertEqual(
            simulate_two_phase(graph, {"Converter": 3.0}, 1)["Converter"],
            [3.0, 3.0],
        )
        with self.assertRaises(SimulationContractError):
            simulate_two_phase(graph, {"Converter": float("nan")}, 1)

    def test_edge_overflow_stops_instead_of_returning_infinity(self):
        graph = nx.DiGraph()
        graph.add_node("A", start_amount=1e200, retention=1.0)
        graph.add_node("B", start_amount=0.0, retention=1.0)
        graph.add_edge(
            "A", "B", correlation=1.0, decay=0.0, delay=0,
            functional_form="cubic",
        )
        with self.assertRaises(SimulationContractError):
            simulate_two_phase(graph, {"A": 1e200, "B": 0.0}, 1)

    def test_unlimited_bound_sentinels_are_not_formula_errors(self):
        self.assertEqual(evaluate_bound("Infinity", {}, -1.0), math.inf)
        self.assertEqual(evaluate_bound("+inf", {}, -1.0), math.inf)
        self.assertEqual(evaluate_bound("-Infinity", {}, 1.0), -math.inf)
        self.assertEqual(evaluate_bound("-inf", {}, 1.0), -math.inf)

    def test_named_schema_rejects_unknown_versions_but_legacy_absence_remains_valid(self):
        with self.assertRaises(GraphValidationError):
            build_graph_from_payload({
                "schema_version": "flowcld.model.v999",
                "nodes": [{"name": "A"}],
                "edges": [],
            })
        graph = build_graph_from_payload({"nodes": [{"name": "A"}], "edges": []})
        self.assertEqual(graph.graph["schema_version"], MODEL_SCHEMA_VERSION)

    def test_negative_retention_is_rejected_explicitly(self):
        graph = nx.DiGraph()
        graph.add_node("A", start_amount=1.0, retention=-0.1)
        with self.assertRaisesRegex(SimulationContractError, "non-negative"):
            simulate_two_phase(graph, {"A": 1.0}, 1)

    def test_invalid_decay_and_noise_are_rejected_explicitly(self):
        graph = nx.DiGraph()
        graph.add_node("A", start_amount=1.0, retention=1.0)
        graph.add_edge("A", "A", correlation=1.0, decay=1.1, delay=0)
        with self.assertRaisesRegex(SimulationContractError, "between 0 and 1"):
            simulate_two_phase(graph, {"A": 1.0}, 1)

        graph["A"]["A"]["decay"] = 0.0
        with self.assertRaisesRegex(SimulationContractError, "sigma"):
            simulate_two_phase(
                graph,
                {"A": 1.0},
                1,
                noise=MultiplicativeGaussianNoise(
                    sigma_map={"A": float("nan")},
                    rng=np.random.default_rng(1),
                ),
            )


if __name__ == "__main__":
    unittest.main()
