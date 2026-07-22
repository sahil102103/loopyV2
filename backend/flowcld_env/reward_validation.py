"""Expert-ranking validation and reward-component ablations.

This module does not train a policy. It compares the current objective
potential with human rankings of fixed graph outcomes, then repeats the
comparison after removing each active reward component.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Mapping, Sequence

import networkx as nx
import numpy as np

from .objectives import ObjectiveEvaluator, ObjectiveWeightProfile
from .observations import ObservationBuilder, SimulationObservationBuilder
from .types import Objective, ObjectiveOrientation


REWARD_STUDY_VERSION = "flowcld.reward-study.v1"


@dataclass(frozen=True)
class RankedGraphOutcome:
    """A frozen candidate graph and its expert rank; rank 1 is best."""

    outcome_id: str
    graph: nx.DiGraph
    expert_rank: float

    def __post_init__(self) -> None:
        if not isinstance(self.outcome_id, str) or not self.outcome_id.strip():
            raise ValueError("Outcome id must be non-empty")
        if not isinstance(self.graph, nx.DiGraph) or not self.graph.nodes:
            raise ValueError("Outcome graph must be a non-empty directed graph")
        rank = float(self.expert_rank)
        if not math.isfinite(rank) or rank <= 0.0:
            raise ValueError("Expert rank must be a positive finite number")


@dataclass(frozen=True)
class RewardOutcomeEvidence:
    """Raw objective components retained for reproducible rescoring."""

    outcome_id: str
    expert_rank: float
    components: Mapping[str, float]

    def __post_init__(self) -> None:
        if not isinstance(self.outcome_id, str) or not self.outcome_id.strip():
            raise ValueError("Outcome evidence id must be non-empty")
        rank = float(self.expert_rank)
        if not math.isfinite(rank) or rank <= 0.0:
            raise ValueError("Outcome evidence rank must be positive and finite")
        required = {
            "canonical_health",
            "target_fit",
            "target_activity",
            "spectral_target_fit",
        }
        missing = required - set(self.components)
        if missing:
            raise ValueError(f"Outcome evidence is missing components: {sorted(missing)}")
        if any(not math.isfinite(float(self.components[name])) for name in required):
            raise ValueError("Outcome evidence components must be finite")


@dataclass(frozen=True)
class RewardValidationThresholds:
    """Study-specific acceptance criteria chosen before policy comparison."""

    minimum_spearman: float
    minimum_pairwise_agreement: float
    minimum_outcomes: int = 3

    def __post_init__(self) -> None:
        spearman = float(self.minimum_spearman)
        pairwise = float(self.minimum_pairwise_agreement)
        if not math.isfinite(spearman) or not -1.0 <= spearman <= 1.0:
            raise ValueError("minimum_spearman must be finite and between -1 and 1")
        if not math.isfinite(pairwise) or not 0.0 <= pairwise <= 1.0:
            raise ValueError(
                "minimum_pairwise_agreement must be finite and between 0 and 1"
            )
        if (
            isinstance(self.minimum_outcomes, bool)
            or not isinstance(self.minimum_outcomes, int)
            or self.minimum_outcomes < 2
        ):
            raise ValueError("minimum_outcomes must be an integer of at least 2")


@dataclass(frozen=True)
class RankingAgreement:
    """Agreement between one reward profile and the expert ordering."""

    profile_name: str
    weights: Mapping[str, float]
    model_scores: Mapping[str, float]
    spearman: float | None
    pairwise_agreement: float | None
    outcome_count: int
    passed: bool

    def to_dict(self) -> dict:
        return {
            "profile_name": self.profile_name,
            "weights": dict(self.weights),
            "model_scores": dict(self.model_scores),
            "spearman": self.spearman,
            "pairwise_agreement": self.pairwise_agreement,
            "outcome_count": self.outcome_count,
            "passed": self.passed,
        }


@dataclass(frozen=True)
class RewardValidationReport:
    """Current reward agreement plus leave-one-component-out ablations."""

    study_version: str
    objective_name: str
    orientation: str
    thresholds: RewardValidationThresholds
    baseline: RankingAgreement
    ablations: tuple[RankingAgreement, ...]
    evidence: tuple[RewardOutcomeEvidence, ...]

    def to_dict(self) -> dict:
        return {
            "study_version": self.study_version,
            "output_label": "exploratory_diagnostic",
            "objective_name": self.objective_name,
            "orientation": self.orientation,
            "thresholds": {
                "minimum_spearman": self.thresholds.minimum_spearman,
                "minimum_pairwise_agreement": (
                    self.thresholds.minimum_pairwise_agreement
                ),
                "minimum_outcomes": self.thresholds.minimum_outcomes,
            },
            "baseline": self.baseline.to_dict(),
            "ablations": [result.to_dict() for result in self.ablations],
            "evidence": [
                {
                    "outcome_id": item.outcome_id,
                    "expert_rank": item.expert_rank,
                    "components": dict(item.components),
                }
                for item in self.evidence
            ],
        }


class RewardValidationStudy:
    """Collect fixed-outcome evidence and compare it with expert rankings."""

    def __init__(
        self,
        *,
        horizon: int = 200,
        objective_evaluator: ObjectiveEvaluator | None = None,
        observation_builder: ObservationBuilder | None = None,
    ):
        if isinstance(horizon, bool) or not isinstance(horizon, int) or horizon < 1:
            raise ValueError("horizon must be a positive integer")
        self._evaluator = objective_evaluator or ObjectiveEvaluator(horizon=horizon)
        self._observation_builder = (
            observation_builder or SimulationObservationBuilder(horizon=horizon)
        )

    def run(
        self,
        outcomes: Sequence[RankedGraphOutcome],
        objective: Objective,
        thresholds: RewardValidationThresholds,
    ) -> RewardValidationReport:
        selected = tuple(outcomes)
        if len(selected) < 2:
            raise ValueError("Reward validation requires at least two outcomes")
        ids = [outcome.outcome_id for outcome in selected]
        if len(ids) != len(set(ids)):
            raise ValueError("Reward validation outcome ids must be unique")

        evidence = []
        for index, outcome in enumerate(selected):
            objective.validate_for_graph(set(outcome.graph.nodes))
            observation = self._observation_builder.build(
                outcome.graph,
                episode_id=index,
                step=0,
                seed=None,
            )
            evaluation = self._evaluator.evaluate_state(
                outcome.graph, observation, objective
            )
            evidence.append(RewardOutcomeEvidence(
                outcome_id=outcome.outcome_id,
                expert_rank=float(outcome.expert_rank),
                components={
                    name: float(evaluation.components.get(name, 0.0))
                    for name in (
                        "canonical_health",
                        "target_fit",
                        "target_activity",
                        "spectral_target_fit",
                    )
                },
            ))

        profile = self._evaluator.weights_for(objective)
        orientation_sign = (
            1.0 if objective.orientation == ObjectiveOrientation.STABILIZE else -1.0
        )
        baseline = compare_reward_to_experts(
            evidence,
            profile,
            thresholds,
            orientation_sign=orientation_sign,
        )
        ablations = tuple(
            compare_reward_to_experts(
                evidence,
                profile.without(component),
                thresholds,
                orientation_sign=orientation_sign,
            )
            for component, weight in profile.as_dict().items()
            if weight > 0.0
        )
        return RewardValidationReport(
            study_version=REWARD_STUDY_VERSION,
            objective_name=objective.name,
            orientation=objective.orientation.value,
            thresholds=thresholds,
            baseline=baseline,
            ablations=ablations,
            evidence=tuple(evidence),
        )


def compare_reward_to_experts(
    evidence: Sequence[RewardOutcomeEvidence],
    profile: ObjectiveWeightProfile,
    thresholds: RewardValidationThresholds,
    *,
    orientation_sign: float = 1.0,
) -> RankingAgreement:
    """Compare fixed component scores with ranks where lower rank is better."""

    selected = tuple(evidence)
    if len(selected) < 2:
        raise ValueError("Reward comparison requires at least two outcomes")
    ids = [item.outcome_id for item in selected]
    if len(ids) != len(set(ids)):
        raise ValueError("Reward comparison outcome ids must be unique")
    sign = float(orientation_sign)
    if sign not in (-1.0, 1.0):
        raise ValueError("orientation_sign must be -1 or 1")
    model_scores = {
        item.outcome_id: sign * profile.score(item.components)
        for item in selected
    }
    expert_utility = [-float(item.expert_rank) for item in selected]
    reward_values = [model_scores[item.outcome_id] for item in selected]
    spearman = _spearman(expert_utility, reward_values)
    pairwise = _pairwise_agreement(expert_utility, reward_values)
    passed = (
        len(selected) >= thresholds.minimum_outcomes
        and spearman is not None
        and pairwise is not None
        and spearman >= thresholds.minimum_spearman
        and pairwise >= thresholds.minimum_pairwise_agreement
    )
    return RankingAgreement(
        profile_name=profile.name,
        weights=profile.as_dict(),
        model_scores=model_scores,
        spearman=spearman,
        pairwise_agreement=pairwise,
        outcome_count=len(selected),
        passed=passed,
    )


def ranking_statistics(
    expert_ranks: Sequence[float],
    model_scores: Sequence[float],
) -> tuple[float | None, float | None]:
    """Return tie-aware Spearman and pairwise agreement.

    Expert ranks are lower-is-better and model scores are higher-is-better.
    Equal expert ranks are treated as ties and excluded from pairwise accuracy.
    """

    if len(expert_ranks) != len(model_scores) or len(expert_ranks) < 2:
        raise ValueError("Rank and score sequences must have equal length of at least 2")
    ranks = [float(value) for value in expert_ranks]
    scores = [float(value) for value in model_scores]
    if any(not math.isfinite(value) or value <= 0.0 for value in ranks):
        raise ValueError("Expert ranks must be positive finite numbers")
    if any(not math.isfinite(value) for value in scores):
        raise ValueError("Model scores must be finite")
    utility = [-value for value in ranks]
    return _spearman(utility, scores), _pairwise_agreement(utility, scores)


def inter_rater_agreement(
    rankings_by_expert: Mapping[str, Mapping[str, float]],
) -> float | None:
    """Mean pairwise tie-aware Spearman correlation between complete raters."""

    experts = sorted(rankings_by_expert)
    if len(experts) < 2:
        return None
    correlations = []
    for left_index, left in enumerate(experts):
        for right in experts[left_index + 1:]:
            left_ranks = rankings_by_expert[left]
            right_ranks = rankings_by_expert[right]
            if set(left_ranks) != set(right_ranks):
                raise ValueError("Inter-rater rankings must cover identical outcome ids")
            ordered = sorted(left_ranks)
            correlation = _spearman(
                [-float(left_ranks[key]) for key in ordered],
                [-float(right_ranks[key]) for key in ordered],
            )
            if correlation is not None:
                correlations.append(correlation)
    return float(np.mean(correlations)) if correlations else None


def _spearman(left: Sequence[float], right: Sequence[float]) -> float | None:
    if len(left) < 2 or len(left) != len(right):
        return None
    left_ranks = _average_ranks(left)
    right_ranks = _average_ranks(right)
    if np.ptp(left_ranks) <= 0.0 or np.ptp(right_ranks) <= 0.0:
        return None
    return float(np.corrcoef(left_ranks, right_ranks)[0, 1])


def _average_ranks(values: Sequence[float]) -> np.ndarray:
    array = np.asarray(values, dtype=float)
    order = np.argsort(array, kind="mergesort")
    ranks = np.empty(array.size, dtype=float)
    start = 0
    while start < array.size:
        end = start + 1
        while end < array.size and array[order[end]] == array[order[start]]:
            end += 1
        ranks[order[start:end]] = (start + 1 + end) / 2.0
        start = end
    return ranks


def _pairwise_agreement(
    expert_utility: Sequence[float], model_scores: Sequence[float]
) -> float | None:
    agreements = []
    for left in range(len(expert_utility)):
        for right in range(left + 1, len(expert_utility)):
            expert_delta = expert_utility[left] - expert_utility[right]
            if expert_delta == 0.0:
                continue
            model_delta = model_scores[left] - model_scores[right]
            if model_delta == 0.0:
                agreements.append(0.5)
            else:
                agreements.append(float(math.copysign(1.0, expert_delta) == math.copysign(1.0, model_delta)))
    return float(np.mean(agreements)) if agreements else None
