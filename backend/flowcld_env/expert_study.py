"""Deterministic blinded expert-validation package for FlowCLD rewards."""

from __future__ import annotations

import copy
import csv
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Mapping, Sequence

import networkx as nx
import numpy as np

from .actions import GraphParameterMutator
from .activity_diagnostics import aggregate_activity_diagnostics
from .objectives import ObjectiveEvaluator
from .observations import SimulationObservationBuilder
from .reward_validation import (
    RewardOutcomeEvidence,
    RewardValidationThresholds,
    compare_reward_to_experts,
    inter_rater_agreement,
    ranking_statistics,
)
from .stability import NotebookSpectralAnalyzer
from .structural import (
    AddEdgeAction,
    AddNodeAction,
    RemoveEdgeAction,
    StructuralConstraintSet,
    StructuralGraphMutator,
    StructuralTransaction,
)
from .types import (
    MutationMode,
    NoOpAction,
    Objective,
    ObjectiveOrientation,
    ParameterAction,
    ParameterName,
    TargetSpecification,
)


EXPERT_STUDY_SCHEMA_VERSION = "flowcld.expert-reward-study.v1"
RANKING_SCHEMA_VERSION = "flowcld.expert-ranking.v1"
DEFAULT_STUDY_SEED = 20260722
RANKING_COLUMNS = (
    "schema_version", "study_id", "expert_id", "scenario_id", "candidate_id",
    "task", "rank", "unacceptable", "confidence", "reason",
)
FORBIDDEN_EXPERT_TERMS = (
    "actor-critic", "actor_critic", "epsilon", "greedy", "random policy",
    "no-op policy", "model reward", "composite reward", "policy name",
)


class ExpertStudyValidationError(ValueError):
    """Raised when generated or completed study data violates its schema."""


@dataclass(frozen=True)
class CandidateSpec:
    key: str
    graph: nx.DiGraph
    actions: tuple[Any, ...]
    provenance: str
    intervention_summary: str
    intervention_magnitude: str
    constraints_violated: tuple[str, ...] = ()


@dataclass(frozen=True)
class ScenarioSpec:
    key: str
    title: str
    team_role: str
    desirable_result: str
    requested_behavior: str
    protected_constraints: tuple[str, ...]
    baseline_graph: nx.DiGraph
    objective: Objective
    candidates: tuple[CandidateSpec, ...]


@dataclass(frozen=True)
class RankingRecord:
    expert_id: str
    scenario_id: str
    candidate_id: str
    task: str
    rank: float
    unacceptable: bool
    confidence: float
    reason: str


def generate_expert_study(
    output_directory: str | Path,
    *,
    seed: int = DEFAULT_STUDY_SEED,
    horizon: int = 40,
) -> dict[str, Any]:
    """Generate expert packet, blank rankings, plots, and private answer key."""

    if isinstance(seed, bool) or not isinstance(seed, int):
        raise ValueError("seed must be an integer")
    if not isinstance(horizon, int) or horizon < 5:
        raise ValueError("horizon must be an integer of at least 5")
    destination = Path(output_directory)
    plots_directory = destination / "plots"
    plots_directory.mkdir(parents=True, exist_ok=True)
    evaluator = ObjectiveEvaluator(horizon=horizon)
    observer = SimulationObservationBuilder(horizon=horizon)
    spectral = NotebookSpectralAnalyzer()
    study_id = _opaque_id("STUDY", EXPERT_STUDY_SCHEMA_VERSION, seed)
    public_scenarios = []
    private_scenarios = []
    deduplication = []

    for scenario in _scenario_specs():
        scenario_id = _opaque_id("SCN", EXPERT_STUDY_SCHEMA_VERSION, seed, scenario.key)
        baseline_observation = observer.build(
            scenario.baseline_graph, episode_id=0, step=0, seed=seed
        )
        baseline_state = evaluator.evaluate_state(
            scenario.baseline_graph, baseline_observation, scenario.objective
        )
        evaluated = []
        seen: list[tuple[str, str, Mapping[str, Sequence[float | None]]]] = []
        for index, candidate in enumerate(scenario.candidates):
            observation = observer.build(
                candidate.graph, episode_id=index + 1, step=0, seed=seed
            )
            graph_signature = _graph_signature(candidate.graph)
            duplicate_of = _near_duplicate(
                graph_signature, observation.history, seen
            )
            if duplicate_of is not None:
                deduplication.append({
                    "scenario_key": scenario.key,
                    "candidate_key": candidate.key,
                    "duplicate_of": duplicate_of,
                    "method": (
                        "same topology with normalized graph-attribute and trajectory "
                        "max-distance <= 1e-4"
                    ),
                })
                continue
            seen.append((candidate.key, graph_signature, observation.history))
            state = evaluator.evaluate_state(candidate.graph, observation, scenario.objective)
            target_nodes = _target_nodes(scenario.objective, candidate.graph)
            activity = aggregate_activity_diagnostics(
                observation.history, baseline_observation.history, target_nodes
            )
            action_cost = _total_action_cost(
                evaluator, scenario.objective, scenario.baseline_graph, candidate.actions
            )
            transition_score = (
                scenario.objective.gamma * state.potential
                - baseline_state.potential
                - action_cost
            )
            candidate_id = _opaque_id(
                "OUT", EXPERT_STUDY_SCHEMA_VERSION, seed, scenario.key, candidate.key
            )
            sampled = {
                node: _sample_series(values, points=9)
                for node, values in observation.history.items()
                if node in target_nodes
            }
            graph_change = _graph_change_summary(
                scenario.baseline_graph, candidate.graph
            )
            diagnostics = {
                "target_fit": float(state.components.get("target_fit", 0.0)),
                "binary_target_activity": float(
                    state.components.get("target_activity", 0.0)
                ),
                "canonical_health": float(
                    state.components.get("canonical_health", 0.0)
                ),
                "spectral_radius": float(spectral.spectral_radius(candidate.graph)),
                "effective_transmission": _effective_transmission(candidate.graph),
                **activity,
            }
            evaluated.append({
                "candidate_id": candidate_id,
                "candidate_key": candidate.key,
                "graph": _graph_to_dict(candidate.graph),
                "history": {
                    node: [None if value is None else float(value) for value in values]
                    for node, values in observation.history.items()
                },
                "sampled_trajectories": sampled,
                "graph_change": graph_change,
                "diagnostics": diagnostics,
                "constraints_violated": list(candidate.constraints_violated),
                "action_count": _action_count(candidate.actions),
                "intervention_summary": candidate.intervention_summary,
                "intervention_magnitude": candidate.intervention_magnitude,
                "provenance": candidate.provenance,
                "actions": [_action_dict(action) for action in candidate.actions],
                "model": {
                    "state_potential": float(state.potential),
                    "transition_score": float(transition_score),
                    "action_cost": float(action_cost),
                    "components": {
                        name: float(state.components.get(name, 0.0))
                        for name in (
                            "canonical_health", "target_fit", "target_activity",
                            "spectral_target_fit",
                        )
                    },
                    "weights": evaluator.weights_for(scenario.objective).as_dict(),
                },
            })

        if len(evaluated) < 4:
            raise RuntimeError(f"Scenario {scenario.key} has insufficient unique outcomes")
        # Opaque-ID order prevents the unchanged reference from occupying a
        # recognizable position across scenarios.
        evaluated.sort(key=lambda item: item["candidate_id"])
        y_limits = _scenario_y_limits(evaluated, _target_nodes(
            scenario.objective, scenario.baseline_graph
        ))
        scenario_target_nodes = _target_nodes(
            scenario.objective, scenario.baseline_graph
        )
        public_candidates = []
        for item in evaluated:
            plot_name = f"{scenario_id}_{item['candidate_id']}.png"
            _plot_candidate(
                item["history"],
                target_nodes=scenario_target_nodes,
                y_limits=y_limits,
                title=f"{scenario_id} / {item['candidate_id']}",
                path=plots_directory / plot_name,
            )
            public_candidates.append({
                "candidate_id": item["candidate_id"],
                "plot": f"plots/{plot_name}",
                "sampled_trajectories": item["sampled_trajectories"],
                "graph_structure": {
                    "nodes": [node["name"] for node in item["graph"]["nodes"]],
                    "edges": [
                        [edge["source"], edge["target"]]
                        for edge in item["graph"]["edges"]
                    ],
                },
                "diagnostics": item["diagnostics"],
                "constraints_violated": item["constraints_violated"],
                "action_count": item["action_count"],
                "intervention_summary": item["intervention_summary"],
                "intervention_magnitude": item["intervention_magnitude"],
            })
        public_scenarios.append({
            "scenario_id": scenario_id,
            "title": scenario.title,
            "team_role": scenario.team_role,
            "orientation": scenario.objective.orientation.value,
            "target_nodes": sorted(_target_nodes(
                scenario.objective, scenario.baseline_graph
            )),
            "requested_behavior": scenario.requested_behavior,
            "protected_constraints": list(scenario.protected_constraints),
            "desirable_result": scenario.desirable_result,
            "trajectory_axis": {
                "time": [0, horizon],
                "value": [y_limits[0], y_limits[1]],
                "scale": "symmetric_log",
                "linear_threshold": 0.01,
            },
            "focused_pairs": _focused_pairs(scenario.key, evaluated),
            "candidates": public_candidates,
        })
        private_scenarios.append({
            "scenario_id": scenario_id,
            "scenario_key": scenario.key,
            "orientation": scenario.objective.orientation.value,
            "objective": _objective_to_dict(scenario.objective),
            "baseline_graph": _graph_to_dict(scenario.baseline_graph),
            "baseline_history": {
                node: [None if value is None else float(value) for value in values]
                for node, values in baseline_observation.history.items()
            },
            "candidates": evaluated,
        })

    manifest = {
        "schema_version": EXPERT_STUDY_SCHEMA_VERSION,
        "study_id": study_id,
        "seed": seed,
        "horizon": horizon,
        "output_label": "expert_review_material",
        "scenarios": public_scenarios,
    }
    answer_key = {
        "schema_version": EXPERT_STUDY_SCHEMA_VERSION,
        "study_id": study_id,
        "seed": seed,
        "horizon": horizon,
        "output_label": "private_analysis_answer_key",
        "deduplication": deduplication,
        "scenarios": private_scenarios,
    }
    _assert_blinded(manifest)
    _write_json(destination / "expert_manifest.json", manifest)
    _write_json(destination / "answer_key.json", answer_key)
    _write_packet(destination / "expert_review_packet.md", manifest)
    _write_ranking_templates(destination, manifest)
    return {
        "study_id": study_id,
        "scenario_count": len(public_scenarios),
        "candidate_count": sum(len(item["candidates"]) for item in public_scenarios),
        "deduplicated_count": len(deduplication),
        "output_directory": str(destination),
    }


def validate_ranking_file(
    study_directory: str | Path,
    ranking_file: str | Path,
) -> tuple[RankingRecord, ...]:
    manifest = _read_json(Path(study_directory) / "expert_manifest.json")
    expected = {
        (scenario["scenario_id"], candidate["candidate_id"], task)
        for scenario in manifest["scenarios"]
        for candidate in scenario["candidates"]
        for task in ("outcome", "transition")
    }
    path = Path(ranking_file)
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != RANKING_COLUMNS:
            raise ExpertStudyValidationError(
                f"Ranking columns must exactly equal: {', '.join(RANKING_COLUMNS)}"
            )
        records = [_parse_ranking_row(row, manifest) for row in reader]
    if not records:
        raise ExpertStudyValidationError("Ranking file is empty")
    by_expert: dict[str, dict[tuple[str, str, str], RankingRecord]] = {}
    for record in records:
        key = (record.scenario_id, record.candidate_id, record.task)
        selected = by_expert.setdefault(record.expert_id, {})
        if key in selected:
            raise ExpertStudyValidationError(
                f"Duplicate ranking row for {record.expert_id}: {key}"
            )
        selected[key] = record
    for expert, selected in by_expert.items():
        missing = expected - set(selected)
        unknown = set(selected) - expected
        if missing or unknown:
            raise ExpertStudyValidationError(
                f"Expert {expert} coverage mismatch; missing={len(missing)}, unknown={len(unknown)}"
            )
        for scenario_id in {key[0] for key in expected}:
            for task in ("outcome", "transition"):
                ranks = [
                    record.rank for key, record in selected.items()
                    if key[0] == scenario_id and key[2] == task
                ]
                _validate_dense_ties(ranks, expert, scenario_id, task)
    return tuple(records)


def analyze_rankings(
    study_directory: str | Path,
    ranking_file: str | Path,
    output_directory: str | Path,
    *,
    thresholds: RewardValidationThresholds | None = None,
) -> dict[str, Any]:
    study_path = Path(study_directory)
    answer_key = _read_json(study_path / "answer_key.json")
    records = validate_ranking_file(study_path, ranking_file)
    thresholds = thresholds or RewardValidationThresholds(0.6, 0.7, 4)
    candidate_lookup = {
        (scenario["scenario_id"], candidate["candidate_id"]): (scenario, candidate)
        for scenario in answer_key["scenarios"]
        for candidate in scenario["candidates"]
    }
    experts = sorted({record.expert_id for record in records})
    scenario_reports = []
    for scenario in answer_key["scenarios"]:
        scenario_id = scenario["scenario_id"]
        candidates = scenario["candidates"]
        task_reports = {}
        for task, score_name in (
            ("outcome", "state_potential"),
            ("transition", "transition_score"),
        ):
            task_records = [
                record for record in records
                if record.scenario_id == scenario_id and record.task == task
            ]
            per_expert = {}
            rankings_by_expert = {}
            for expert in experts:
                selected = [record for record in task_records if record.expert_id == expert]
                selected.sort(key=lambda item: item.candidate_id)
                scores = [
                    candidate_lookup[(scenario_id, item.candidate_id)][1]["model"][score_name]
                    for item in selected
                ]
                spearman, pairwise = ranking_statistics(
                    [item.rank for item in selected], scores
                )
                per_expert[expert] = {
                    "spearman": spearman,
                    "pairwise_agreement": pairwise,
                    "mean_confidence": float(np.mean([item.confidence for item in selected])),
                }
                rankings_by_expert[expert] = {
                    item.candidate_id: item.rank for item in selected
                }
            aggregate = _aggregate_rankings(task_records, candidates, score_name)
            confidence_weighted = _aggregate_rankings(
                task_records, candidates, score_name, confidence_weighted=True
            )
            task_reports[task] = {
                "per_expert": per_expert,
                "aggregate": aggregate,
                "confidence_weighted": confidence_weighted,
                "inter_rater_mean_pairwise_spearman": inter_rater_agreement(
                    rankings_by_expert
                ),
            }
        outcome_records = [
            record for record in records
            if record.scenario_id == scenario_id and record.task == "outcome"
        ]
        aggregate_ranks = _mean_ranks(outcome_records)
        evidence = tuple(RewardOutcomeEvidence(
            outcome_id=candidate["candidate_id"],
            expert_rank=aggregate_ranks[candidate["candidate_id"]],
            components=candidate["model"]["components"],
        ) for candidate in candidates)
        profile = _profile_for_scenario(scenario)
        orientation_sign = 1.0 if scenario["orientation"] == "stabilize" else -1.0
        baseline_agreement = compare_reward_to_experts(
            evidence, profile, thresholds, orientation_sign=orientation_sign
        )
        ablations = [
            compare_reward_to_experts(
                evidence, profile.without(component), thresholds,
                orientation_sign=orientation_sign,
            ).to_dict()
            for component, weight in profile.as_dict().items() if weight > 0.0
        ]
        activity_comparisons = {}
        for metric in (
            "binary_target_activity", "final_magnitude_ratio",
            "tail_mean_magnitude_ratio", "integrated_activity_ratio",
            "fraction_above_threshold", "baseline_activity_similarity",
            "late_window_minimum_ratio",
        ):
            scores = [float(candidate["diagnostics"][metric]) for candidate in candidates]
            ranks = [aggregate_ranks[candidate["candidate_id"]] for candidate in candidates]
            spearman, pairwise = ranking_statistics(ranks, scores)
            activity_comparisons[metric] = {
                "spearman": spearman,
                "pairwise_agreement": pairwise,
                "score_direction": "higher_means_more_preserved_activity",
            }
        scenario_reports.append({
            "scenario_id": scenario_id,
            "scenario_key": scenario["scenario_key"],
            "orientation": scenario["orientation"],
            "tasks": task_reports,
            "current_reward": baseline_agreement.to_dict(),
            "ablations": ablations,
            "activity_diagnostics": activity_comparisons,
            "strong_disagreements": _strong_disagreements(
                outcome_records, candidates
            ),
        })

    report = {
        "schema_version": EXPERT_STUDY_SCHEMA_VERSION,
        "study_id": answer_key["study_id"],
        "output_label": "exploratory_expert_validation",
        "expert_count": len(experts),
        "thresholds": {
            "minimum_spearman": thresholds.minimum_spearman,
            "minimum_pairwise_agreement": thresholds.minimum_pairwise_agreement,
            "minimum_outcomes": thresholds.minimum_outcomes,
            "status": "recommended_predeclared_thresholds_not_validated",
        },
        "scenario_reports": scenario_reports,
        "overall_summary": _overall_summary(scenario_reports, experts),
        "orientation_summary": _orientation_summary(scenario_reports),
        "quantitative_gate_passed": _quantitative_gate(
            scenario_reports, thresholds
        ),
        "validated": False,
        "validation_note": (
            "Real expert rankings and domain approval are required before setting validated=true."
        ),
    }
    destination = Path(output_directory)
    destination.mkdir(parents=True, exist_ok=True)
    _write_json(destination / "analysis_report.json", report)
    (destination / "analysis_report.md").write_text(
        _analysis_markdown(report), encoding="utf-8"
    )
    return report


def _scenario_specs() -> tuple[ScenarioSpec, ...]:
    return (
        _stabilizer_scenario(),
        _disruptor_scenario(),
        _spectral_activity_scenario(),
        _structural_scenario(),
        _homogeneous_decay_scenario(),
    )


def _base_graph(*, homogeneous: bool = False) -> nx.DiGraph:
    graph = nx.DiGraph()
    starts = (0.8, 0.5, 0.3)
    for name, start in zip(("a", "b", "c"), starts):
        graph.add_node(
            name, start_amount=start, retention=0.72 if not homogeneous else 0.58,
            floor=-100.0, ceiling=100.0, formula=None,
            sink_formula=None, source_formula=None,
        )
    edges = (
        ("a", "b", 0.58), ("b", "a", -0.42), ("b", "c", 0.35),
    ) if not homogeneous else (
        ("a", "b", 0.18), ("b", "c", 0.18), ("c", "a", 0.18),
    )
    for source, target, correlation in edges:
        graph.add_edge(
            source, target, correlation=correlation,
            decay=0.18 if not homogeneous else 0.45,
            confidence=1.0, delay=0, functional_form="linear",
        )
    return graph


def _stabilizer_scenario() -> ScenarioSpec:
    graph = _base_graph()
    objective = Objective(
        name="Stabilizer review", orientation=ObjectiveOrientation.STABILIZE,
        target_nodes=frozenset({"b"}), owned_nodes=frozenset(graph.nodes),
        target=TargetSpecification(behaviors={"b": "Optimal"}),
        move_budget=12, structural_budget=4, min_live_nodes=3,
    )
    return _scenario_with_candidates(
        "stabilizer", "Stabilizer: preserve useful behavior",
        "A cooperative team responsible for stable, sustained activity at node b.",
        "Optimal behavior at b without collapse or runaway growth.",
        "Prefer bounded dynamics that preserve meaningful target activity.",
        graph, objective,
    )


def _disruptor_scenario() -> ScenarioSpec:
    graph = _base_graph()
    objective = Objective(
        name="Disruptor review", orientation=ObjectiveOrientation.DISRUPT,
        target_nodes=frozenset({"b"}), owned_nodes=frozenset(graph.nodes),
        target=TargetSpecification(behaviors={"b": "Optimal"}),
        move_budget=12, structural_budget=4, min_live_nodes=3,
    )
    return _scenario_with_candidates(
        "disruptor", "Disruptor: objective-relevant pressure",
        "A bounded adversarial team seeking to degrade node b, not damage unrelated structure.",
        "Meaningful degradation of b while respecting protected graph constraints.",
        "Prefer objective-relevant disruption over arbitrary model destruction.",
        graph, objective,
    )


def _spectral_activity_scenario() -> ScenarioSpec:
    graph = _base_graph()
    for node in graph.nodes:
        graph.nodes[node]["retention"] = 0.94
    graph["a"]["b"]["correlation"] = 0.88
    graph["b"]["a"]["correlation"] = 0.82
    graph["a"]["b"]["decay"] = 0.0
    graph["b"]["a"]["decay"] = 0.0
    objective = Objective(
        name="Spectral and activity review",
        orientation=ObjectiveOrientation.STABILIZE,
        target_nodes=frozenset({"b"}), owned_nodes=frozenset(graph.nodes),
        target=TargetSpecification(
            behaviors={"b": "Optimal"}, spectral_radius=0.82
        ),
        move_budget=12, structural_budget=4, min_live_nodes=3,
    )
    return _scenario_with_candidates(
        "spectral_activity", "Stability versus activity",
        "A stabilizing team balancing a spectral limit against continued useful activity.",
        "Spectral radius at or below 0.82 while preserving a meaningful signal at b.",
        "Prefer true stabilization; do not treat numerical extinction as success.",
        graph, objective,
    )


def _structural_scenario() -> ScenarioSpec:
    graph = _base_graph()
    graph["a"]["b"]["correlation"] = 0.9
    graph["b"]["a"]["correlation"] = 0.8
    graph["a"]["b"]["decay"] = 0.0
    graph["b"]["a"]["decay"] = 0.0
    objective = Objective(
        name="Structural review", orientation=ObjectiveOrientation.STABILIZE,
        target_nodes=frozenset({"b"}), owned_nodes=frozenset(graph.nodes),
        target=TargetSpecification(
            behaviors={"b": "Optimal"}, spectral_radius=0.9
        ),
        move_budget=12, structural_budget=5, min_live_nodes=3,
    )
    scenario = _scenario_with_candidates(
        "bounded_structural", "Bounded structural intervention",
        "A stabilizing team permitted to make small, reversible structural changes.",
        "Improve the target dynamics without fragmentation or node deletion.",
        "Prefer a causally useful bounded edit over complexity without benefit.",
        graph, objective,
    )
    useful = StructuralTransaction((RemoveEdgeAction("b", "a"),), label="bounded feedback removal")
    useful_graph, _ = StructuralGraphMutator(
        graph, StructuralConstraintSet.conservative(protected_nodes=graph.nodes)
    ).apply(graph, useful)
    unhelpful = StructuralTransaction((
        AddNodeAction("d", start_amount=0.2, retention=0.8),
        AddEdgeAction("a", "d", correlation=0.8),
        AddEdgeAction("d", "b", correlation=0.8),
    ), label="additional reinforcing path")
    unhelpful_graph, _ = StructuralGraphMutator(
        graph, StructuralConstraintSet.conservative(protected_nodes=graph.nodes)
    ).apply(graph, unhelpful)
    extras = (
        CandidateSpec(
            "useful_structure", useful_graph, (useful,),
            "controlled structural feedback removal",
            "Remove one reinforcing feedback edge.", "one structural edit",
        ),
        CandidateSpec(
            "unhelpful_structure", unhelpful_graph, (unhelpful,),
            "controlled but strategically unhelpful reinforcing path",
            "Add one connected mediator and two reinforcing edges.",
            "three atomic structural edits",
        ),
    )
    return ScenarioSpec(**{**scenario.__dict__, "candidates": scenario.candidates + extras})


def _homogeneous_decay_scenario() -> ScenarioSpec:
    graph = _base_graph(homogeneous=True)
    objective = Objective(
        name="Homogeneous decay review",
        orientation=ObjectiveOrientation.STABILIZE,
        target_nodes=frozenset(graph.nodes), owned_nodes=frozenset(graph.nodes),
        target=TargetSpecification(
            behaviors={node: "Optimal" for node in graph.nodes}
        ),
        move_budget=12, structural_budget=4, min_live_nodes=3,
    )
    return _scenario_with_candidates(
        "homogeneous_decay", "Stable graph approaching zero",
        "A stabilizing team reviewing a homogeneous graph whose signals gradually decay.",
        "Stable, bounded dynamics with enough persistent activity to remain meaningful.",
        "Distinguish desirable damping from a stable but functionally dead graph.",
        graph, objective,
    )


def _scenario_with_candidates(
    key: str,
    title: str,
    role: str,
    requested: str,
    desirable: str,
    graph: nx.DiGraph,
    objective: Objective,
) -> ScenarioSpec:
    candidates = [CandidateSpec(
        "unchanged", copy.deepcopy(graph), (NoOpAction(),), "unchanged reference",
        "No graph parameters or structure changed.", "none",
    )]
    candidates.append(_parameter_candidate(
        graph, "moderate_stability", retention_delta=-0.08, decay_delta=0.12,
        provenance="moderate stability adjustment",
        summary="Moderately lower retention and increase edge decay.",
    ))
    candidates.append(_parameter_candidate(
        graph, "weak_signal", retention_value=0.18, decay_value=0.78,
        provenance="strong damping with substantial signal weakening",
        summary="Strongly damp all nodes and edges.",
    ))
    candidates.append(_parameter_candidate(
        graph, "collapse", retention_value=0.0, decay_value=1.0,
        provenance="rapid numerical collapse",
        summary="Set retention to zero and fully decay all edge transmission.",
    ))
    candidates.append(_parameter_candidate(
        graph, "growth", retention_value=1.0, decay_value=0.0,
        correlation_scale=1.7,
        provenance="unconstrained reinforcing growth",
        summary="Raise retention and strengthen transmission toward its bounds.",
    ))
    candidates.append(_parameter_candidate(
        graph, "partial_low_cost", retention_delta=-0.03, decay_delta=0.04,
        provenance="lower-cost partial adjustment",
        summary="Apply small damping adjustments.",
    ))
    if key == "disruptor":
        candidates.append(_parameter_candidate(
            graph, "objective_damage", node_values={"b": 0.05},
            provenance="objective-relevant target degradation",
            summary="Strongly reduce target-node retention.",
        ))
        candidates.append(_parameter_candidate(
            graph, "arbitrary_damage", node_values={"c": 0.05},
            provenance="arbitrary non-target damage",
            summary="Strongly reduce an unrelated node's retention.",
        ))
    return ScenarioSpec(
        key=key, title=title, team_role=role,
        desirable_result=desirable, requested_behavior=requested,
        protected_constraints=(
            "Keep all original nodes.", "Do not fragment the graph.",
            "No new self-loops.", "Use finite bounded parameters.",
        ),
        baseline_graph=graph, objective=objective, candidates=tuple(candidates),
    )


def _parameter_candidate(
    baseline: nx.DiGraph,
    key: str,
    *,
    retention_delta: float | None = None,
    decay_delta: float | None = None,
    retention_value: float | None = None,
    decay_value: float | None = None,
    correlation_scale: float | None = None,
    node_values: Mapping[str, float] | None = None,
    provenance: str,
    summary: str,
) -> CandidateSpec:
    graph = copy.deepcopy(baseline)
    mutator = GraphParameterMutator()
    actions = []
    for node in graph.nodes:
        current = float(graph.nodes[node].get("retention", 1.0))
        requested = (node_values or {}).get(node)
        if requested is None and retention_value is not None:
            requested = retention_value
        if requested is None and retention_delta is not None:
            requested = min(1.0, max(0.0, current + retention_delta))
        if requested is not None and not math.isclose(current, requested):
            action = ParameterAction(
                ParameterName.RETENTION, str(node), float(requested), MutationMode.SET
            )
            mutator.apply(graph, action)
            actions.append(action)
    for source, target in graph.edges:
        edge = graph[source][target]
        current_decay = float(edge.get("decay", 0.0))
        requested_decay = decay_value
        if requested_decay is None and decay_delta is not None:
            requested_decay = min(1.0, max(0.0, current_decay + decay_delta))
        if requested_decay is not None and not math.isclose(current_decay, requested_decay):
            action = ParameterAction(
                ParameterName.DECAY, (str(source), str(target)),
                float(requested_decay), MutationMode.SET,
            )
            mutator.apply(graph, action)
            actions.append(action)
        if correlation_scale is not None:
            current = float(edge.get("correlation", 1.0))
            requested = min(1.0, max(-1.0, current * correlation_scale))
            if not math.isclose(current, requested):
                action = ParameterAction(
                    ParameterName.CORRELATION, (str(source), str(target)),
                    requested, MutationMode.SET,
                )
                mutator.apply(graph, action)
                actions.append(action)
    return CandidateSpec(
        key, graph, tuple(actions), provenance, summary,
        f"{len(actions)} bounded parameter edits",
    )


def _total_action_cost(
    evaluator: ObjectiveEvaluator,
    objective: Objective,
    baseline: nx.DiGraph,
    actions: Sequence[Any],
) -> float:
    graph = copy.deepcopy(baseline)
    mutator = GraphParameterMutator()
    total = 0.0
    for action in actions:
        if isinstance(action, NoOpAction):
            continue
        if isinstance(action, ParameterAction):
            before = mutator.current_value(graph, action)
            _, after = mutator.apply(graph, action)
            total += evaluator.action_cost(
                objective, action, before_value=before, after_value=after
            )
        else:
            total += evaluator.action_cost(objective, action)
    return float(total)


def _aggregate_rankings(records, candidates, score_name, confidence_weighted=False):
    rank_map = _mean_ranks(records, confidence_weighted=confidence_weighted)
    ordered = sorted(candidates, key=lambda item: item["candidate_id"])
    ranks = [rank_map[item["candidate_id"]] for item in ordered]
    scores = [float(item["model"][score_name]) for item in ordered]
    spearman, pairwise = ranking_statistics(ranks, scores)
    return {
        "ranks": rank_map,
        "spearman": spearman,
        "pairwise_agreement": pairwise,
    }


def _mean_ranks(records: Sequence[RankingRecord], confidence_weighted=False):
    grouped: dict[str, list[tuple[float, float]]] = {}
    for item in records:
        grouped.setdefault(item.candidate_id, []).append((item.rank, item.confidence))
    return {
        candidate_id: float(
            np.average(
                [rank for rank, _ in values],
                weights=[confidence for _, confidence in values] if confidence_weighted else None,
            )
        )
        for candidate_id, values in grouped.items()
    }


def _orientation_summary(reports):
    output = {}
    for orientation in ("stabilize", "disrupt"):
        selected = [item for item in reports if item["orientation"] == orientation]
        output[orientation] = {
            "scenario_count": len(selected),
            **_task_metric_summary(selected),
        }
    return output


def _overall_summary(reports, experts):
    per_expert = {}
    for expert in experts:
        per_expert[expert] = {}
        for task in ("outcome", "transition"):
            selected = [
                report["tasks"][task]["per_expert"][expert]
                for report in reports
            ]
            per_expert[expert][task] = {
                "mean_spearman": _finite_mean(item["spearman"] for item in selected),
                "mean_pairwise_agreement": _finite_mean(
                    item["pairwise_agreement"] for item in selected
                ),
                "mean_confidence": _finite_mean(
                    item["mean_confidence"] for item in selected
                ),
            }
    return {
        "scenario_count": len(reports),
        **_task_metric_summary(reports),
        "per_expert": per_expert,
    }


def _quantitative_gate(reports, thresholds):
    for report in reports:
        for task in ("outcome", "transition"):
            aggregate = report["tasks"][task]["aggregate"]
            if len(aggregate["ranks"]) < thresholds.minimum_outcomes:
                return False
            if (
                aggregate["spearman"] is None
                or aggregate["spearman"] < thresholds.minimum_spearman
                or aggregate["pairwise_agreement"] is None
                or aggregate["pairwise_agreement"]
                < thresholds.minimum_pairwise_agreement
            ):
                return False
    return True


def _task_metric_summary(reports):
    output = {}
    for task in ("outcome", "transition"):
        output[task] = {
            "mean_aggregate_spearman": _finite_mean(
                item["tasks"][task]["aggregate"]["spearman"] for item in reports
            ),
            "mean_aggregate_pairwise_agreement": _finite_mean(
                item["tasks"][task]["aggregate"]["pairwise_agreement"]
                for item in reports
            ),
            "mean_confidence_weighted_spearman": _finite_mean(
                item["tasks"][task]["confidence_weighted"]["spearman"]
                for item in reports
            ),
            "mean_inter_rater_spearman": _finite_mean(
                item["tasks"][task]["inter_rater_mean_pairwise_spearman"]
                for item in reports
            ),
        }
    return output


def _finite_mean(values):
    selected = [float(value) for value in values if value is not None and math.isfinite(float(value))]
    return float(np.mean(selected)) if selected else None


def _strong_disagreements(records, candidates):
    ranks = _mean_ranks(records)
    unacceptable = {
        candidate_id: float(np.mean([
            item.unacceptable for item in records if item.candidate_id == candidate_id
        ]))
        for candidate_id in ranks
    }
    scores = np.asarray([candidate["model"]["state_potential"] for candidate in candidates])
    cutoff = float(np.quantile(scores, 0.75))
    return [
        {
            "candidate_id": candidate["candidate_id"],
            "model_state_potential": candidate["model"]["state_potential"],
            "aggregate_expert_rank": ranks[candidate["candidate_id"]],
            "expert_unacceptable_fraction": unacceptable[candidate["candidate_id"]],
        }
        for candidate in candidates
        if candidate["model"]["state_potential"] >= cutoff
        and unacceptable[candidate["candidate_id"]] >= 0.5
    ]


def _profile_for_scenario(scenario):
    evaluator = ObjectiveEvaluator(horizon=1)
    objective_data = scenario["objective"]
    objective = Objective(
        name=objective_data["name"],
        orientation=ObjectiveOrientation(objective_data["orientation"]),
        target=TargetSpecification(
            behaviors=objective_data["target"]["behaviors"],
            trajectories=objective_data["target"]["trajectories"],
            spectral_radius=objective_data["target"]["spectral_radius"],
        ),
    )
    return evaluator.weights_for(objective)


def _parse_ranking_row(row, manifest):
    if row["schema_version"] != RANKING_SCHEMA_VERSION:
        raise ExpertStudyValidationError("Unsupported ranking schema version")
    if row["study_id"] != manifest["study_id"]:
        raise ExpertStudyValidationError("Ranking study_id does not match manifest")
    expert = row["expert_id"].strip()
    if not expert:
        raise ExpertStudyValidationError("expert_id is required")
    task = row["task"].strip().lower()
    if task not in {"outcome", "transition"}:
        raise ExpertStudyValidationError("task must be outcome or transition")
    try:
        rank = float(row["rank"])
        confidence = float(row["confidence"])
    except ValueError as error:
        raise ExpertStudyValidationError("rank and confidence must be numeric") from error
    if not math.isfinite(rank) or rank <= 0 or not rank.is_integer():
        raise ExpertStudyValidationError("rank must be a positive integer; ties share a rank")
    if not math.isfinite(confidence) or confidence < 1 or confidence > 5:
        raise ExpertStudyValidationError("confidence must be between 1 and 5")
    unacceptable = row["unacceptable"].strip().lower()
    if unacceptable not in {"true", "false"}:
        raise ExpertStudyValidationError("unacceptable must be true or false")
    reason = row["reason"].strip()
    if not reason:
        raise ExpertStudyValidationError("reason is required for every ranking")
    return RankingRecord(
        expert_id=expert,
        scenario_id=row["scenario_id"].strip(),
        candidate_id=row["candidate_id"].strip(),
        task=task,
        rank=rank,
        unacceptable=unacceptable == "true",
        confidence=confidence,
        reason=reason,
    )


def _validate_dense_ties(ranks, expert, scenario, task):
    unique = sorted(set(ranks))
    if unique != [float(value) for value in range(1, len(unique) + 1)]:
        raise ExpertStudyValidationError(
            f"Ranks for {expert}/{scenario}/{task} must use dense ties: 1,1,2 rather than 1,1,3"
        )


def _write_packet(path: Path, manifest):
    lines = [
        "# FlowCLD Expert Outcome Review", "",
        "This packet contains five blinded scenarios. Candidate identifiers are opaque.",
        "Complete Task A using outcomes only, then Task B using intervention details.",
        "Do not try to infer how a candidate was generated.", "",
        "## Ranking instructions", "",
        "- Rank 1 is best. Use dense ties (1, 1, 2) only when outcomes are genuinely tied.",
        "- Mark unacceptable results even if they still receive a relative rank.",
        "- Confidence is 1 (low) through 5 (high).", "",
    ]
    for scenario in manifest["scenarios"]:
        lines.extend([
            f"## {scenario['scenario_id']}: {scenario['title']}", "",
            f"**Team role:** {scenario['team_role']}", "",
            f"**Requested behavior:** {scenario['requested_behavior']}", "",
            f"**A desirable result means:** {scenario['desirable_result']}", "",
            "**Protected constraints:** " + "; ".join(scenario["protected_constraints"]), "",
            f"All plots use time 0-{scenario['trajectory_axis']['time'][1]} and value axis "
            f"{scenario['trajectory_axis']['value'][0]:.4g} to {scenario['trajectory_axis']['value'][1]:.4g}. "
            "The shared symmetric-log scale keeps gradual near-zero changes visible while "
            "still showing large positive or negative values.", "",
            "### Task A: outcome desirability", "",
            "Judge the resulting dynamics and graph without considering intervention effort.", "",
        ])
        for candidate in scenario["candidates"]:
            diagnostics = candidate["diagnostics"]
            lines.extend([
                f"#### {candidate['candidate_id']}", "",
                f"![Trajectory for {candidate['candidate_id']}]({candidate['plot']})", "",
                f"Final graph: {_public_graph_summary(candidate['graph_structure'])}", "",
                "Diagnostics: "
                f"spectral radius {diagnostics['spectral_radius']:.4f}; "
                f"target fit {diagnostics['target_fit']:.3f}; "
                f"binary activity {diagnostics['binary_target_activity']:.3f}; "
                f"tail preservation {diagnostics['tail_mean_magnitude_ratio']:.3f}; "
                f"integrated preservation {diagnostics['integrated_activity_ratio']:.3f}; "
                f"transmission {diagnostics['effective_transmission']:.3f}.", "",
                "Constraint violations: " + (
                    "; ".join(candidate["constraints_violated"])
                    if candidate["constraints_violated"] else "none"
                ), "",
            ])
        lines.extend(["#### Optional focused comparison", ""])
        for pair in scenario["focused_pairs"]:
            lines.append(
                f"- {pair['candidate_a']} versus {pair['candidate_b']}: {pair['question']}"
            )
        lines.append("")
        lines.extend([
            "### Task B: transition desirability", "",
            "Now judge whether each resulting change justified the intervention required.", "",
            "| Candidate | Action count | Intervention magnitude | Plain-language intervention |",
            "|---|---:|---|---|",
        ])
        for candidate in scenario["candidates"]:
            lines.append(
                f"| {candidate['candidate_id']} | {candidate['action_count']} | "
                f"{candidate['intervention_magnitude']} | {candidate['intervention_summary']} |"
            )
        lines.append("")
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def _write_ranking_templates(destination, manifest):
    rows = []
    for scenario in manifest["scenarios"]:
        for task in ("outcome", "transition"):
            for candidate in scenario["candidates"]:
                rows.append({
                    "schema_version": RANKING_SCHEMA_VERSION,
                    "study_id": manifest["study_id"],
                    "expert_id": "",
                    "scenario_id": scenario["scenario_id"],
                    "candidate_id": candidate["candidate_id"],
                    "task": task,
                    "rank": "",
                    "unacceptable": "false",
                    "confidence": "",
                    "reason": "",
                })
    with (destination / "ranking_template.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=RANKING_COLUMNS, lineterminator="\n"
        )
        writer.writeheader()
        writer.writerows(rows)
    _write_json(destination / "ranking_template.json", {
        "schema_version": RANKING_SCHEMA_VERSION,
        "study_id": manifest["study_id"],
        "instructions": {
            "rank": "Positive dense rank; ties share a rank.",
            "unacceptable": "true or false",
            "confidence": "1 through 5",
            "tasks": {"outcome": "ignore cost", "transition": "consider intervention"},
        },
        "entries": rows,
    })


def _focused_pairs(scenario_key, candidates):
    by_key = {candidate["candidate_key"]: candidate["candidate_id"] for candidate in candidates}
    definitions = {
        "stabilizer": (
            "moderate_stability", "weak_signal",
            "Which result better balances stability with meaningful target activity?",
        ),
        "disruptor": (
            "objective_damage", "arbitrary_damage",
            "Which result better represents objective-relevant bounded disruption?",
        ),
        "spectral_activity": (
            "moderate_stability", "collapse",
            "Does the stability improvement justify the difference in target activity?",
        ),
        "bounded_structural": (
            "useful_structure", "unhelpful_structure",
            "Which graph outcome is causally useful rather than merely more complex?",
        ),
        "homogeneous_decay": (
            "moderate_stability", "weak_signal",
            "At what point does damping become functional extinction?",
        ),
    }
    left, right, question = definitions[scenario_key]
    return [{
        "candidate_a": by_key[left],
        "candidate_b": by_key[right],
        "question": question,
    }]


def _analysis_markdown(report):
    lines = [
        "# FlowCLD Expert Validation Analysis", "",
        f"Experts: {report['expert_count']}", "",
        "**Status:** Exploratory only. This report does not declare the reward validated.", "",
        f"Quantitative gate passed: {report['quantitative_gate_passed']}. "
        "Domain approval is still required.", "",
        "## Overall", "",
        "| Task | Mean Spearman | Mean pairwise agreement | Mean confidence-weighted Spearman |",
        "|---|---:|---:|---:|",
    ]
    for task in ("outcome", "transition"):
        data = report["overall_summary"][task]
        lines.append(
            f"| {task} | {_fmt(data['mean_aggregate_spearman'])} | "
            f"{_fmt(data['mean_aggregate_pairwise_agreement'])} | "
            f"{_fmt(data['mean_confidence_weighted_spearman'])} |"
        )
    lines.append("")
    for scenario in report["scenario_reports"]:
        lines.extend([
            f"## {scenario['scenario_id']} ({scenario['orientation']})", "",
            "| Task | Aggregate Spearman | Pairwise agreement | Inter-rater Spearman |",
            "|---|---:|---:|---:|",
        ])
        for task in ("outcome", "transition"):
            data = scenario["tasks"][task]
            lines.append(
                f"| {task} | {_fmt(data['aggregate']['spearman'])} | "
                f"{_fmt(data['aggregate']['pairwise_agreement'])} | "
                f"{_fmt(data['inter_rater_mean_pairwise_spearman'])} |"
            )
        lines.extend(["", "Current outcome score:", ""])
        current = scenario["current_reward"]
        lines.append(
            f"- Spearman: {_fmt(current['spearman'])}; pairwise: "
            f"{_fmt(current['pairwise_agreement'])}; threshold passed: {current['passed']}."
        )
        if scenario["strong_disagreements"]:
            lines.append("- Strong disagreements require review: " + ", ".join(
                item["candidate_id"] for item in scenario["strong_disagreements"]
            ))
        lines.append("")
    return "\n".join(lines) + "\n"


def _assert_blinded(manifest):
    serialized = json.dumps(manifest, sort_keys=True).lower()
    found = [term for term in FORBIDDEN_EXPERT_TERMS if term in serialized]
    if found:
        raise RuntimeError(f"Expert manifest leaks forbidden terms: {found}")
    if any(key in serialized for key in ('"state_potential"', '"transition_score"', '"weights"', '"provenance"')):
        raise RuntimeError("Expert manifest leaks private score or provenance fields")


def _near_duplicate(graph_signature, history, seen):
    vector = _history_vector(history)
    for key, prior_graph_signature, prior_history in seen:
        prior_vector = _history_vector(prior_history)
        if vector.shape != prior_vector.shape:
            continue
        scale = max(float(np.max(np.abs(prior_vector))), 1.0)
        trajectory_distance = float(np.max(np.abs(vector - prior_vector))) / scale
        graph_distance = _graph_signature_distance(
            graph_signature, prior_graph_signature
        )
        if max(graph_distance, trajectory_distance) <= 1e-4:
            return key
    return None


def _graph_signature_distance(left_signature, right_signature):
    left = json.loads(left_signature)
    right = json.loads(right_signature)
    left_nodes = {item["name"]: item for item in left["nodes"]}
    right_nodes = {item["name"]: item for item in right["nodes"]}
    left_edges = {
        (item["source"], item["target"]): item for item in left["edges"]
    }
    right_edges = {
        (item["source"], item["target"]): item for item in right["edges"]
    }
    if left_nodes.keys() != right_nodes.keys() or left_edges.keys() != right_edges.keys():
        return math.inf
    distances = []
    pairs = [
        (left_nodes[key], right_nodes[key], {"name"}) for key in sorted(left_nodes)
    ]
    pairs.extend(
        (left_edges[key], right_edges[key], {"source", "target"})
        for key in sorted(left_edges)
    )
    for left_item, right_item, identity_fields in pairs:
        if left_item.keys() != right_item.keys():
            return math.inf
        for field in left_item.keys() - identity_fields:
            left_value, right_value = left_item[field], right_item[field]
            if (
                isinstance(left_value, (int, float))
                and not isinstance(left_value, bool)
                and isinstance(right_value, (int, float))
                and not isinstance(right_value, bool)
            ):
                scale = max(abs(float(left_value)), abs(float(right_value)), 1.0)
                distances.append(abs(float(left_value) - float(right_value)) / scale)
            elif left_value != right_value:
                return math.inf
    return max(distances, default=0.0)


def _history_vector(history):
    return np.concatenate([
        np.nan_to_num(np.asarray([
            np.nan if value is None else float(value) for value in history[node]
        ]), nan=0.0, posinf=1e12, neginf=-1e12)
        for node in sorted(history)
    ])


def _graph_signature(graph):
    return json.dumps(_graph_to_dict(graph), sort_keys=True, separators=(",", ":"))


def _opaque_id(prefix, *parts):
    digest = hashlib.blake2b(
        "|".join(str(part) for part in parts).encode("utf-8"), digest_size=6
    ).hexdigest().upper()
    return f"{prefix}-{digest}"


def _graph_to_dict(graph):
    return {
        "nodes": [
            {"name": str(node), **{
                key: _json_number(value) for key, value in sorted(data.items())
            }}
            for node, data in sorted(graph.nodes(data=True), key=lambda item: str(item[0]))
        ],
        "edges": [
            {"source": str(source), "target": str(target), **{
                key: _json_number(value) for key, value in sorted(data.items())
            }}
            for source, target, data in sorted(
                graph.edges(data=True), key=lambda item: (str(item[0]), str(item[1]))
            )
        ],
    }


def _json_number(value):
    if isinstance(value, float) and not math.isfinite(value):
        return "Infinity" if value > 0 else "-Infinity"
    return value


def _objective_to_dict(objective):
    return {
        "name": objective.name,
        "orientation": objective.orientation.value,
        "owned_nodes": sorted(objective.owned_nodes),
        "target_nodes": sorted(objective.target_nodes),
        "preset": objective.preset,
        "gamma": objective.gamma,
        "parameter_move_cost": objective.parameter_move_cost,
        "structural_move_cost": objective.structural_move_cost,
        "target": {
            "behaviors": dict(objective.target.behaviors),
            "trajectories": {
                key: list(values) for key, values in objective.target.trajectories.items()
            },
            "spectral_radius": objective.target.spectral_radius,
        },
    }


def _target_nodes(objective, graph):
    selected = set(objective.target_nodes)
    if not selected:
        selected = set(objective.target.behaviors) | set(objective.target.trajectories)
    return tuple(sorted(selected or set(graph.nodes)))


def _effective_transmission(graph):
    return float(sum(
        abs(float(data.get("correlation", 1.0)))
        * (1.0 - float(data.get("decay", 0.0)))
        for _, _, data in graph.edges(data=True)
    ))


def _sample_series(values, points):
    values = list(values)
    indices = np.linspace(0, len(values) - 1, min(points, len(values)), dtype=int)
    return [{"step": int(index), "value": values[index]} for index in indices]


def _graph_change_summary(before, after):
    before_nodes, after_nodes = set(before.nodes), set(after.nodes)
    before_edges, after_edges = set(before.edges), set(after.edges)
    changed_nodes = sorted(
        node for node in before_nodes & after_nodes
        if dict(before.nodes[node]) != dict(after.nodes[node])
    )
    changed_edges = sorted(
        [list(edge) for edge in before_edges & after_edges
         if dict(before.edges[edge]) != dict(after.edges[edge])]
    )
    return {
        "added_nodes": sorted(after_nodes - before_nodes),
        "removed_nodes": sorted(before_nodes - after_nodes),
        "added_edges": [list(edge) for edge in sorted(after_edges - before_edges)],
        "removed_edges": [list(edge) for edge in sorted(before_edges - after_edges)],
        "changed_nodes": changed_nodes,
        "changed_edges": changed_edges,
        "final_node_count": after.number_of_nodes(),
        "final_edge_count": after.number_of_edges(),
    }


def _public_graph_summary(summary):
    return (
        f"{len(summary['nodes'])} nodes {summary['nodes']}; "
        f"{len(summary['edges'])} directed edges {summary['edges']}"
    )


def _action_count(actions):
    return sum(len(action.edits) if isinstance(action, StructuralTransaction) else int(
        not isinstance(action, NoOpAction)
    ) for action in actions)


def _action_dict(action):
    return action.to_dict() if hasattr(action, "to_dict") else {"type": type(action).__name__}


def _scenario_y_limits(candidates, target_nodes):
    values = []
    for candidate in candidates:
        for node in target_nodes:
            values.extend(
                value for value in candidate["history"].get(node, [])
                if value is not None and math.isfinite(float(value))
            )
    if not values:
        return (-1.0, 1.0)
    low, high = float(min(values)), float(max(values))
    span = max(high - low, max(abs(low), abs(high)) * 0.05, 1e-6)
    return low - span * 0.05, high + span * 0.05


def _plot_candidate(history, *, target_nodes, y_limits, title, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    figure, axis = plt.subplots(figsize=(7.2, 3.8))
    for node in target_nodes:
        values = [np.nan if value is None else float(value) for value in history[node]]
        axis.plot(range(len(values)), values, label=node, linewidth=1.8)
    axis.set_xlim(0, max(len(history[node]) for node in target_nodes) - 1)
    axis.set_yscale("symlog", linthresh=0.01)
    axis.set_ylim(*y_limits)
    axis.set_xlabel("Simulation step")
    axis.set_ylabel("Value (symmetric log scale)")
    axis.set_title(title)
    axis.grid(alpha=0.25)
    axis.legend(frameon=False)
    figure.tight_layout()
    figure.savefig(path, dpi=120, metadata={"Software": "FlowCLD"})
    plt.close(figure)


def _write_json(path, payload):
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def _fmt(value):
    return "n/a" if value is None else f"{float(value):.3f}"
