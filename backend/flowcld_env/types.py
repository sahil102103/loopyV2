"""Value objects shared by the FlowCLD agent environment.

These types deliberately contain no simulation or graph-mutation logic. Keeping
the data contracts independent makes the environment usable from a notebook,
an API endpoint, Gymnasium adapter, or a future multi-agent runner.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
import math
from numbers import Real
from typing import Any, Mapping, Protocol, Sequence


SUPPORTED_BEHAVIORS = frozenset({"Over-damped", "Optimal", "Unconstrained"})


class ParameterName(str, Enum):
    """The parameter dimensions exposed in the Stage 1 action space."""

    START_AMOUNT = "start_amount"
    RETENTION = "retention"
    DECAY = "decay"
    DELAY = "delay"
    CONFIDENCE = "confidence"
    CORRELATION = "correlation"


class MutationMode(str, Enum):
    """How an action value is applied to its current graph parameter."""

    SET = "set"
    DELTA = "delta"


class ObjectiveOrientation(str, Enum):
    """Whether an agent improves or degrades its target-node condition."""

    STABILIZE = "stabilize"
    DISRUPT = "disrupt"


ActionTarget = str | tuple[str, str]


class SerializableAction(Protocol):
    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-friendly action representation."""


@dataclass(frozen=True)
class NoOpAction:
    """Explicitly end or pass a turn without changing the shared graph."""

    reason: str = "No improving legal move"

    def to_dict(self) -> dict[str, Any]:
        return {"kind": "no_op", "reason": self.reason}


@dataclass(frozen=True)
class ParameterAction:
    """A single node or edge parameter mutation requested by an agent."""

    parameter: ParameterName
    target: ActionTarget
    value: float
    mode: MutationMode = MutationMode.DELTA

    def __post_init__(self) -> None:
        if not isinstance(self.parameter, ParameterName):
            raise TypeError("parameter must be a ParameterName")
        if not isinstance(self.mode, MutationMode):
            raise TypeError("mode must be a MutationMode")
        if isinstance(self.target, tuple):
            if len(self.target) != 2 or any(not isinstance(part, str) or not part for part in self.target):
                raise ValueError("edge targets must contain two non-empty node names")
        elif not isinstance(self.target, str) or not self.target:
            raise ValueError("node targets must be non-empty names")
        if isinstance(self.value, bool) or not isinstance(self.value, Real):
            raise TypeError("value must be numeric")
        # Infinity and NaN are rejected before a graph can be mutated. Keeping
        # this invariant in the value object also protects custom mutators.
        if not math.isfinite(float(self.value)):
            raise ValueError("value must be finite")

    def to_dict(self) -> dict[str, Any]:
        target: str | list[str]
        target = list(self.target) if isinstance(self.target, tuple) else self.target
        return {
            "parameter": self.parameter.value,
            "target": target,
            "value": self.value,
            "mode": self.mode.value,
        }


@dataclass(frozen=True)
class ActionSlot:
    """One maskable continuous/discrete dimension in the action space."""

    key: str
    parameter: ParameterName
    target: ActionTarget
    minimum: float
    maximum: float
    integer: bool = False

    def to_dict(self, *, allowed: bool) -> dict[str, Any]:
        target: str | list[str]
        target = list(self.target) if isinstance(self.target, tuple) else self.target
        return {
            "key": self.key,
            "parameter": self.parameter.value,
            "target": target,
            "minimum": self.minimum,
            "maximum": self.maximum,
            "integer": self.integer,
            "allowed": allowed,
        }


@dataclass(frozen=True)
class TargetSpecification:
    """Desired trajectories, behavior classes, and graph stability limit."""

    trajectories: Mapping[str, Sequence[float]] = field(default_factory=dict)
    behaviors: Mapping[str, str] = field(default_factory=dict)
    spectral_radius: float | None = None


@dataclass(frozen=True)
class Objective:
    """Stable handoff contract consumed by baseline and learned policies."""

    name: str
    orientation: ObjectiveOrientation = ObjectiveOrientation.STABILIZE
    owned_nodes: frozenset[str] = field(default_factory=frozenset)
    target_nodes: frozenset[str] = field(default_factory=frozenset)
    target: TargetSpecification = field(default_factory=TargetSpecification)
    preset: str = "balanced"
    gamma: float = 0.99
    parameter_move_cost: float = 0.01
    structural_move_cost: float = 0.05
    move_budget: int = 20
    structural_budget: int = 5
    min_live_nodes: int = 1
    goal_potential: float | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.name, str) or not self.name.strip():
            raise ValueError("Objective name must be non-empty")
        if not isinstance(self.orientation, ObjectiveOrientation):
            raise TypeError("orientation must be an ObjectiveOrientation")
        if not 0.0 <= float(self.gamma) <= 1.0:
            raise ValueError("gamma must be between 0 and 1")
        for field_name in ("parameter_move_cost", "structural_move_cost"):
            value = float(getattr(self, field_name))
            if not math.isfinite(value) or value < 0.0:
                raise ValueError(f"{field_name} must be a non-negative finite number")
        for field_name in ("move_budget", "structural_budget", "min_live_nodes"):
            value = getattr(self, field_name)
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError(f"{field_name} must be a non-negative integer")
        if self.move_budget < 1:
            raise ValueError("move_budget must be at least 1")
        if self.min_live_nodes < 1:
            raise ValueError("min_live_nodes must be at least 1")
        if self.goal_potential is not None and not math.isfinite(float(self.goal_potential)):
            raise ValueError("goal_potential must be finite or None")

    def validate_for_graph(self, node_names: Sequence[str] | set[str]) -> None:
        nodes = set(node_names)
        unknown = (set(self.owned_nodes) | set(self.target_nodes)) - nodes
        if unknown:
            raise ValueError(f"Objective references unknown nodes: {sorted(unknown)}")
        validate_target_specification(self.target, nodes)


def validate_target_specification(
    target: TargetSpecification,
    node_names: Sequence[str] | set[str],
) -> None:
    """Validate a target once at an environment/evaluator boundary."""

    nodes = set(node_names)
    unknown = (set(target.trajectories) | set(target.behaviors)) - nodes
    if unknown:
        raise ValueError(f"Target references unknown nodes: {sorted(unknown)}")
    invalid_behaviors = set(target.behaviors.values()) - SUPPORTED_BEHAVIORS
    if invalid_behaviors:
        raise ValueError(f"Unsupported target behaviors: {sorted(invalid_behaviors)}")
    for node, values in target.trajectories.items():
        sequence = tuple(values)
        if not sequence:
            raise ValueError(f"Target trajectory for {node} cannot be empty")
        if any(not math.isfinite(float(value)) for value in sequence):
            raise ValueError(f"Target trajectory for {node} must contain finite numbers")
    if target.spectral_radius is not None:
        radius = float(target.spectral_radius)
        if not math.isfinite(radius) or not 0.0 < radius < 1.0:
            raise ValueError("Target spectral radius must be greater than 0 and less than 1")


@dataclass(frozen=True)
class EnvironmentObservation:
    """Simulation output and current parameter state visible to an agent."""

    episode_id: int
    step: int
    seed: int | None
    history: Mapping[str, tuple[float | None, ...]]
    classifications: Mapping[str, str]
    nodes: tuple[str, ...]
    edges: tuple[tuple[str, str], ...]
    node_parameters: Mapping[str, Mapping[str, float]]
    edge_parameters: Mapping[str, Mapping[str, float]]

    def to_dict(self) -> dict[str, Any]:
        return {
            "episode_id": self.episode_id,
            "step": self.step,
            "seed": self.seed,
            "history": {name: list(values) for name, values in self.history.items()},
            "classifications": dict(self.classifications),
            "nodes": list(self.nodes),
            "edges": [list(edge) for edge in self.edges],
            "node_parameters": {
                name: dict(parameters) for name, parameters in self.node_parameters.items()
            },
            "edge_parameters": {
                name: dict(parameters) for name, parameters in self.edge_parameters.items()
            },
        }


@dataclass(frozen=True)
class RewardEvaluation:
    """Composite reward plus named component contributions."""

    total: float
    components: Mapping[str, float]


@dataclass(frozen=True)
class MoveRecord:
    """Auditable record of one attempted environment action."""

    episode_id: int
    sequence: int
    role: str
    action: SerializableAction
    accepted: bool
    before: Any
    after: Any
    reward: float
    reward_components: Mapping[str, float]
    reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "episode_id": self.episode_id,
            "sequence": self.sequence,
            "role": self.role,
            "action": self.action.to_dict(),
            "accepted": self.accepted,
            "before": self.before,
            "after": self.after,
            "reward": self.reward,
            "reward_components": dict(self.reward_components),
            "reason": self.reason,
        }
