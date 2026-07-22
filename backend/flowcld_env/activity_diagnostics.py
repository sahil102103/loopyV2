"""Continuous activity diagnostics for expert review and reward studies.

These metrics are deliberately not part of the canonical reward. They compare
absolute target-node activity with a fixed baseline trajectory, remain bounded,
and assign zero preservation to non-finite or explosively large candidates.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Mapping, Sequence

import numpy as np


@dataclass(frozen=True)
class ActivityDiagnosticSet:
    final_magnitude_ratio: float
    tail_mean_magnitude_ratio: float
    integrated_activity_ratio: float
    fraction_above_threshold: float
    baseline_activity_similarity: float
    late_window_minimum_ratio: float
    explosion_detected: bool

    def to_dict(self) -> dict[str, float | bool]:
        return {
            "final_magnitude_ratio": self.final_magnitude_ratio,
            "tail_mean_magnitude_ratio": self.tail_mean_magnitude_ratio,
            "integrated_activity_ratio": self.integrated_activity_ratio,
            "fraction_above_threshold": self.fraction_above_threshold,
            "baseline_activity_similarity": self.baseline_activity_similarity,
            "late_window_minimum_ratio": self.late_window_minimum_ratio,
            "explosion_detected": self.explosion_detected,
        }


def activity_diagnostics(
    candidate: Sequence[float | None],
    baseline: Sequence[float | None],
    *,
    tail_fraction: float = 0.25,
    relative_threshold: float = 0.05,
    explosion_multiple: float = 100.0,
) -> ActivityDiagnosticSet:
    """Compare one candidate series with its scenario baseline.

    Ratios are capped at one because the study asks whether useful activity was
    preserved, not whether numerical growth was maximized. Negative and
    oscillating values are handled through magnitudes. A baseline that is
    identically zero uses a neutral unit scale and treats another zero series as
    perfectly similar.
    """

    if not 0.0 < tail_fraction <= 1.0:
        raise ValueError("tail_fraction must be in (0, 1]")
    if not 0.0 < relative_threshold <= 1.0:
        raise ValueError("relative_threshold must be in (0, 1]")
    if not math.isfinite(explosion_multiple) or explosion_multiple <= 1.0:
        raise ValueError("explosion_multiple must be greater than 1")

    candidate_values = _series(candidate)
    baseline_values = _series(baseline)
    if candidate_values.size == 0 or baseline_values.size == 0:
        return ActivityDiagnosticSet(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, True)
    length = min(candidate_values.size, baseline_values.size)
    candidate_values = candidate_values[:length]
    baseline_values = baseline_values[:length]
    if not np.all(np.isfinite(candidate_values)) or not np.all(np.isfinite(baseline_values)):
        return ActivityDiagnosticSet(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, True)

    candidate_abs = np.abs(candidate_values)
    baseline_abs = np.abs(baseline_values)
    baseline_scale = max(
        float(baseline_abs[0]),
        float(np.mean(baseline_abs)),
        float(np.max(baseline_abs)),
    )
    if baseline_scale <= 1e-12:
        baseline_scale = 1.0
    explosion = bool(float(np.max(candidate_abs)) > explosion_multiple * baseline_scale)
    if explosion:
        return ActivityDiagnosticSet(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, True)

    tail_length = max(1, int(math.ceil(length * tail_fraction)))
    candidate_tail = candidate_abs[-tail_length:]
    baseline_tail = baseline_abs[-tail_length:]
    final_ratio = _preservation_ratio(candidate_abs[-1], baseline_abs[-1], baseline_scale)
    tail_ratio = _preservation_ratio(
        float(np.mean(candidate_tail)), float(np.mean(baseline_tail)), baseline_scale
    )
    integrated_ratio = _preservation_ratio(
        float(np.mean(candidate_abs)), float(np.mean(baseline_abs)), baseline_scale
    )
    threshold = relative_threshold * baseline_scale
    fraction_above = float(np.mean(candidate_abs >= threshold))
    normalized_difference = float(np.mean(np.abs(candidate_abs - baseline_abs))) / baseline_scale
    similarity = float(math.exp(-normalized_difference))
    late_minimum = min(1.0, float(np.min(candidate_tail)) / baseline_scale)
    return ActivityDiagnosticSet(
        final_magnitude_ratio=final_ratio,
        tail_mean_magnitude_ratio=tail_ratio,
        integrated_activity_ratio=integrated_ratio,
        fraction_above_threshold=fraction_above,
        baseline_activity_similarity=similarity,
        late_window_minimum_ratio=late_minimum,
        explosion_detected=False,
    )


def aggregate_activity_diagnostics(
    candidate_history: Mapping[str, Sequence[float | None]],
    baseline_history: Mapping[str, Sequence[float | None]],
    target_nodes: Sequence[str],
) -> dict[str, float | bool]:
    selected = tuple(sorted(set(target_nodes)))
    if not selected:
        raise ValueError("At least one target node is required")
    diagnostics = [
        activity_diagnostics(
            candidate_history.get(node, ()), baseline_history.get(node, ())
        )
        for node in selected
    ]
    names = (
        "final_magnitude_ratio",
        "tail_mean_magnitude_ratio",
        "integrated_activity_ratio",
        "fraction_above_threshold",
        "baseline_activity_similarity",
        "late_window_minimum_ratio",
    )
    return {
        **{
            name: float(np.mean([getattr(item, name) for item in diagnostics]))
            for name in names
        },
        "explosion_detected": any(item.explosion_detected for item in diagnostics),
    }


def _series(values: Sequence[float | None]) -> np.ndarray:
    return np.asarray([
        np.nan if value is None else float(value) for value in values
    ], dtype=float)


def _preservation_ratio(candidate: float, baseline: float, scale: float) -> float:
    epsilon = max(1e-12, scale * 1e-12)
    if baseline <= epsilon and candidate <= epsilon:
        return 1.0
    ratio = (candidate + epsilon) / (baseline + epsilon)
    return float(math.exp(-abs(math.log(max(ratio, epsilon)))))
