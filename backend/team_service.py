"""Stateless Stage 4 multi-team session API service."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from numbers import Integral
from typing import Any, Iterable

import networkx as nx

try:
    from advanced_analysis import OPT_SCORE_PRESETS, build_graph_from_payload
    from agent_payload import (
        AgentPayloadError,
        as_list,
        ensure_unique_edges,
        finite_number,
        graph_to_payload,
        names,
        no_op_action_from_payload,
        nonnegative_integer,
        pairs,
        parameter_action_from_payload,
        required_name,
        structural_edit_from_payload,
        structural_transaction_from_payload,
        target_specification_from_payload,
    )
    from flowcld_env import (
        MultiTeamEnvironment,
        ActorCriticAgent,
        ActorCriticTrainer,
        ActorCriticTrainingSettings,
        DepthLimitedPlanningAgent,
        EnvironmentTransitionModel,
        GreedyAgent,
        LeagueEvaluationHarness,
        NoOpAgent,
        ObjectiveOrientation,
        ParameterName,
        PolicyEvaluationHarness,
        PolicyProfile,
        RandomAgent,
        RoleBasedAuthorizationPolicy,
        RoleDefinition,
        SimulationObservationBuilder,
        SpectralTargetGuardAgent,
        StructuralActionKind,
        StructuralConstraintSet,
        StructuralGraphMutator,
        TeamDefinition,
        TeamMove,
        validate_target_specification,
    )
except ModuleNotFoundError:
    from backend.advanced_analysis import OPT_SCORE_PRESETS, build_graph_from_payload
    from backend.agent_payload import (
        AgentPayloadError,
        as_list,
        ensure_unique_edges,
        finite_number,
        graph_to_payload,
        names,
        no_op_action_from_payload,
        nonnegative_integer,
        pairs,
        parameter_action_from_payload,
        required_name,
        structural_edit_from_payload,
        structural_transaction_from_payload,
        target_specification_from_payload,
    )
    from backend.flowcld_env import (
        MultiTeamEnvironment,
        ActorCriticAgent,
        ActorCriticTrainer,
        ActorCriticTrainingSettings,
        DepthLimitedPlanningAgent,
        EnvironmentTransitionModel,
        GreedyAgent,
        LeagueEvaluationHarness,
        NoOpAgent,
        ObjectiveOrientation,
        ParameterName,
        PolicyEvaluationHarness,
        PolicyProfile,
        RandomAgent,
        RoleBasedAuthorizationPolicy,
        RoleDefinition,
        SimulationObservationBuilder,
        SpectralTargetGuardAgent,
        StructuralActionKind,
        StructuralConstraintSet,
        StructuralGraphMutator,
        TeamDefinition,
        TeamMove,
        validate_target_specification,
    )


class TeamSessionRequestError(AgentPayloadError):
    """Raised when a Stage 4 session request is malformed."""


TEAM_SESSION_SCHEMA_VERSION = "flowcld.team-session.v1"


_NODE_PARAMETERS = frozenset({ParameterName.START_AMOUNT, ParameterName.RETENTION})
_EDGE_PARAMETERS = frozenset({
    ParameterName.DECAY,
    ParameterName.DELAY,
    ParameterName.CONFIDENCE,
    ParameterName.CORRELATION,
})


def _positive_integer(value: Any, field: str, default: int) -> int:
    parsed = nonnegative_integer(default if value is None else value, field)
    if parsed < 1:
        raise TeamSessionRequestError(f"{field} must be a positive integer")
    return parsed


@dataclass(frozen=True)
class LearningRunSettings:
    strategy: str
    learner_team_id: str | None = None
    training: ActorCriticTrainingSettings | None = None
    training_steps: int = 0
    evaluation_seeds: int = 0
    planning_depth: int = 1
    opponent_mode: str = "hold"


def _enum_set(values: Any, enum_type, field: str):
    parsed = []
    for value in as_list(values, field):
        try:
            parsed.append(enum_type(value))
        except ValueError as error:
            raise TeamSessionRequestError(f"Unsupported {field} value: {value}") from error
    return frozenset(parsed)


def _scope_names(permissions: dict[str, Any], field: str):
    if field not in permissions or permissions[field] is None:
        return None
    return frozenset(names(permissions[field], field))


def _scope_edges(permissions: dict[str, Any], field: str):
    if field not in permissions or permissions[field] is None:
        return None
    return frozenset(pairs(permissions[field], field))


def _parse_team(raw: Any, index: int) -> tuple[TeamDefinition, RoleDefinition]:
    if not isinstance(raw, dict):
        raise TeamSessionRequestError(f"Team {index} must be an object")
    team_id = required_name(raw.get("id"), f"Team {index} id")
    team_name = required_name(raw.get("name", team_id), f"Team {index} name")
    role = f"team:{team_id}"
    try:
        target = target_specification_from_payload(raw.get("objective"))
    except AgentPayloadError as error:
        raise TeamSessionRequestError(str(error)) from error
    weight = finite_number(raw.get("weight"), f"Team {team_id} weight", 1.0)
    if weight <= 0.0:
        raise TeamSessionRequestError(f"Team {team_id} weight must be positive")

    permissions = raw.get("permissions", {})
    if not isinstance(permissions, dict):
        raise TeamSessionRequestError(f"Team {team_id} permissions must be an object")
    node_parameters = _enum_set(
        permissions.get("node_parameters"), ParameterName, "node_parameters"
    )
    edge_parameters = _enum_set(
        permissions.get("edge_parameters"), ParameterName, "edge_parameters"
    )
    invalid_node = node_parameters - _NODE_PARAMETERS
    invalid_edge = edge_parameters - _EDGE_PARAMETERS
    if invalid_node:
        raise TeamSessionRequestError(
            f"Node permissions contain edge parameters: {sorted(value.value for value in invalid_node)}"
        )
    if invalid_edge:
        raise TeamSessionRequestError(
            f"Edge permissions contain node parameters: {sorted(value.value for value in invalid_edge)}"
        )
    structural_actions = _enum_set(
        permissions.get("structural_actions"), StructuralActionKind, "structural_actions"
    )
    try:
        orientation = ObjectiveOrientation(raw.get("orientation", "stabilize"))
    except ValueError as error:
        raise TeamSessionRequestError(
            f"Team {team_id} orientation must be stabilize or disrupt"
        ) from error
    objective_nodes = frozenset(target.trajectories) | frozenset(target.behaviors)
    owned_nodes = frozenset(names(raw.get("owned_nodes"), "owned_nodes"))
    target_nodes = (
        frozenset(names(raw.get("target_nodes"), "target_nodes"))
        if "target_nodes" in raw else objective_nodes
    )
    preset = required_name(raw.get("preset", "balanced"), f"Team {team_id} preset")
    if preset not in OPT_SCORE_PRESETS:
        raise TeamSessionRequestError(f"Unsupported Team {team_id} preset: {preset}")
    try:
        team = TeamDefinition(
            team_id=team_id,
            name=team_name,
            role=role,
            target=target,
            weight=weight,
            orientation=orientation,
            owned_nodes=owned_nodes,
            target_nodes=target_nodes,
            preset=preset,
            gamma=finite_number(raw.get("gamma"), f"Team {team_id} gamma", 0.99),
            parameter_move_cost=finite_number(
                raw.get("parameter_move_cost"), f"Team {team_id} parameter_move_cost", 0.01
            ),
            structural_move_cost=finite_number(
                raw.get("structural_move_cost"), f"Team {team_id} structural_move_cost", 0.05
            ),
            move_budget=nonnegative_integer(
                raw.get("move_budget", 20), f"Team {team_id} move_budget"
            ),
            structural_budget=nonnegative_integer(
                raw.get("structural_budget", 5), f"Team {team_id} structural_budget"
            ),
            min_live_nodes=nonnegative_integer(
                raw.get("min_live_nodes", 1), f"Team {team_id} min_live_nodes"
            ),
            goal_potential=(
                None if raw.get("goal_potential") in (None, "")
                else finite_number(raw.get("goal_potential"), f"Team {team_id} goal_potential")
            ),
        )
    except (TypeError, ValueError) as error:
        raise TeamSessionRequestError(str(error)) from error
    role_definition = RoleDefinition(
        name=role,
        node_parameters=node_parameters,
        edge_parameters=edge_parameters,
        structural_actions=structural_actions,
        node_targets=_scope_names(permissions, "node_targets"),
        edge_targets=_scope_edges(permissions, "edge_targets"),
    )
    return team, role_definition


def _parse_action(raw: Any):
    if not isinstance(raw, dict):
        raise TeamSessionRequestError("Move action must be an object")
    kind = raw.get("kind")
    if kind == "no_op":
        return no_op_action_from_payload(raw)
    if kind == "parameter" or (kind is None and "parameter" in raw):
        return parameter_action_from_payload(raw)
    if kind == "structural_transaction":
        return structural_transaction_from_payload(raw)
    if kind in {value.value for value in StructuralActionKind}:
        return structural_edit_from_payload(raw)
    raise TeamSessionRequestError(f"Unsupported move action kind: {kind}")


def _parse_moves(raw_moves: Any, team_ids: set[str]) -> tuple[TeamMove, ...]:
    values = as_list(raw_moves, "moves")
    if len(values) > 100:
        raise TeamSessionRequestError("A team session cannot exceed 100 moves")
    moves = []
    for index, raw in enumerate(values, start=1):
        if not isinstance(raw, dict):
            raise TeamSessionRequestError(f"Move {index} must be an object")
        team_id = required_name(raw.get("team_id"), f"Move {index} team_id")
        if team_id not in team_ids:
            raise TeamSessionRequestError(f"Move {index} references unknown team: {team_id}")
        moves.append(TeamMove(team_id=team_id, action=_parse_action(raw.get("action"))))
    return tuple(moves)


def _parse_learning_settings(
    payload: dict[str, Any],
    *,
    teams: tuple[TeamDefinition, ...],
    seed: int,
) -> LearningRunSettings:
    strategy = str(payload.get("agent_strategy", "greedy")).strip().lower()
    if strategy not in {"greedy", "actor_critic"}:
        raise TeamSessionRequestError("agent_strategy must be greedy or actor_critic")
    if strategy == "greedy":
        return LearningRunSettings(strategy=strategy)

    learner_team_id = required_name(
        payload.get("learner_team_id", teams[0].team_id), "learner_team_id"
    )
    team_ids = {team.team_id for team in teams}
    if learner_team_id not in team_ids:
        raise TeamSessionRequestError(
            f"learner_team_id references unknown team: {learner_team_id}"
        )
    episodes = _positive_integer(
        payload.get("training_episodes"), "training_episodes", 20
    )
    if episodes > 200:
        raise TeamSessionRequestError("training_episodes cannot exceed 200")
    n_step = _positive_integer(payload.get("n_step"), "n_step", 5)
    if n_step > 50:
        raise TeamSessionRequestError("n_step cannot exceed 50")
    training_steps = _positive_integer(
        payload.get("training_steps"), "training_steps", 8
    )
    if training_steps > 50:
        raise TeamSessionRequestError("training_steps cannot exceed 50")
    evaluation_seeds = nonnegative_integer(
        payload.get("evaluation_seeds", 0), "evaluation_seeds"
    )
    if evaluation_seeds > 5:
        raise TeamSessionRequestError("evaluation_seeds cannot exceed 5")
    planning_depth = _positive_integer(
        payload.get("planning_depth"), "planning_depth", 1
    )
    if planning_depth > 3:
        raise TeamSessionRequestError("planning_depth cannot exceed 3")
    opponent_mode = str(payload.get("opponent_mode", "hold")).strip().lower()
    if opponent_mode not in {"hold", "random", "greedy"}:
        raise TeamSessionRequestError("opponent_mode must be hold, random, or greedy")
    try:
        settings = ActorCriticTrainingSettings(
            episodes=episodes,
            n_step=n_step,
            actor_learning_rate=finite_number(
                payload.get("actor_learning_rate"), "actor_learning_rate", 0.03
            ),
            critic_learning_rate=finite_number(
                payload.get("critic_learning_rate"), "critic_learning_rate", 0.08
            ),
            temperature=finite_number(
                payload.get("training_temperature"), "training_temperature", 1.0
            ),
            seed=seed,
            use_critic=True,
        )
    except ValueError as error:
        raise TeamSessionRequestError(str(error)) from error
    return LearningRunSettings(
        strategy=strategy,
        learner_team_id=learner_team_id,
        training=settings,
        training_steps=training_steps,
        evaluation_seeds=evaluation_seeds,
        planning_depth=planning_depth,
        opponent_mode=opponent_mode,
    )


def _validate_references(
    graph: nx.DiGraph,
    protected_nodes: Iterable[str],
    protected_edges: Iterable[tuple[str, str]],
    required_paths: Iterable[tuple[str, str]],
) -> None:
    node_set = set(graph.nodes)
    edge_set = set(graph.edges)
    unknown_nodes = set(protected_nodes) - node_set
    unknown_edges = set(protected_edges) - edge_set
    unknown_path_nodes = {node for pair in required_paths for node in pair} - node_set
    if unknown_nodes:
        raise TeamSessionRequestError(f"Protected nodes do not exist: {sorted(unknown_nodes)}")
    if unknown_edges:
        raise TeamSessionRequestError(f"Protected edges do not exist: {sorted(unknown_edges)}")
    if unknown_path_nodes:
        raise TeamSessionRequestError(
            f"Required paths reference unknown nodes: {sorted(unknown_path_nodes)}"
        )


def _frame(
    environment: MultiTeamEnvironment,
    *,
    index: int,
    shared_reward: float,
    move: dict[str, Any] | None,
) -> dict[str, Any]:
    observation = environment.observation_snapshot
    return {
        "index": index,
        "move": move,
        "graph": graph_to_payload(environment.graph_snapshot),
        "classifications": dict(observation.classifications),
        "objective_rewards": {
            team_id: float(evaluation.total)
            for team_id, evaluation in environment.current_rewards.items()
        },
        "shared_reward": float(shared_reward),
    }


def _stable_digest(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def run_team_session(payload: dict[str, Any]) -> dict[str, Any]:
    """Run an ordered, role-safe session and return deterministic replay frames."""

    if not isinstance(payload, dict):
        raise TeamSessionRequestError("Request body must be a JSON object")
    request_schema = payload.get("request_schema_version")
    if request_schema not in (None, "", TEAM_SESSION_SCHEMA_VERSION):
        raise TeamSessionRequestError(
            f"Unsupported team-session schema: {request_schema}"
        )
    graph_data = {
        "schema_version": payload.get("schema_version"),
        "nodes": payload.get("nodes", []),
        "edges": payload.get("edges", []),
    }
    ensure_unique_edges(graph_data)
    graph = build_graph_from_payload(graph_data)

    parsed_teams = [
        _parse_team(raw, index)
        for index, raw in enumerate(as_list(payload.get("teams"), "teams"), start=1)
    ]
    if not parsed_teams:
        raise TeamSessionRequestError("At least one team is required")
    teams = tuple(item[0] for item in parsed_teams)
    roles = tuple(item[1] for item in parsed_teams)
    team_ids = {team.team_id for team in teams}
    if len(team_ids) != len(teams):
        raise TeamSessionRequestError("Team IDs must be unique")
    for team in teams:
        try:
            validate_target_specification(team.target, set(graph.nodes))
            team.as_objective().validate_for_graph(set(graph.nodes))
            if team.min_live_nodes > graph.number_of_nodes():
                raise ValueError(
                    f"Team {team.team_id} min_live_nodes exceeds the baseline graph"
                )
        except (TypeError, ValueError) as error:
            raise TeamSessionRequestError(str(error)) from error
    moves = _parse_moves(payload.get("moves"), team_ids)
    agent_turns = nonnegative_integer(payload.get("agent_turns", 0), "agent_turns")
    if agent_turns > 100:
        raise TeamSessionRequestError("agent_turns cannot exceed 100")

    objective_nodes = {
        node
        for team in teams
        for node in (
            *team.target.trajectories.keys(),
            *team.target.behaviors.keys(),
            *team.target_nodes,
            *team.owned_nodes,
        )
    }
    protected_nodes = set(names(payload.get("protected_nodes"), "protected_nodes")) | objective_nodes
    protected_edges = pairs(payload.get("protected_edges"), "protected_edges")
    required_paths = pairs(payload.get("required_paths"), "required_paths")
    _validate_references(graph, protected_nodes, protected_edges, required_paths)

    horizon = nonnegative_integer(payload.get("iterations", 50), "iterations")
    if not 1 <= horizon <= 200:
        raise TeamSessionRequestError("iterations must be between 1 and 200")
    seed = payload.get("seed", 42)
    if isinstance(seed, bool) or not isinstance(seed, Integral):
        raise TeamSessionRequestError("seed must be an integer")
    learning_run = _parse_learning_settings(payload, teams=teams, seed=int(seed))

    constraints = StructuralConstraintSet.conservative(
        protected_nodes=protected_nodes,
        protected_edges=protected_edges,
        required_paths=required_paths,
    )
    authorization = RoleBasedAuthorizationPolicy(roles)

    def _make_environment(
        step_limit: int,
        base_graph: nx.DiGraph | None = None,
    ) -> MultiTeamEnvironment:
        selected_graph = base_graph if base_graph is not None else graph
        return MultiTeamEnvironment(
            selected_graph,
            teams=teams,
            authorization_policy=authorization,
            structural_mutator=StructuralGraphMutator(selected_graph, constraints),
            observation_builder=SimulationObservationBuilder(horizon=horizon),
            max_steps=max(1, int(step_limit)),
        )

    learned_agent = None
    learning_summary = None
    if (
        learning_run.strategy == "actor_critic"
        and learning_run.training is not None
        and learning_run.learner_team_id
    ):
        try:
            learner_team_id = learning_run.learner_team_id
            opponent_ids = [team.team_id for team in teams if team.team_id != learner_team_id]
            if learning_run.opponent_mode == "random":
                opponent_factories = {
                    team_id: (lambda opponent_seed: RandomAgent(opponent_seed))
                    for team_id in opponent_ids
                }
            elif learning_run.opponent_mode == "greedy":
                opponent_factories = {
                    team_id: (lambda opponent_seed: GreedyAgent())
                    for team_id in opponent_ids
                }
            else:
                opponent_factories = {}

            trainer = ActorCriticTrainer(learning_run.training)
            training_environment_steps = learning_run.training_steps * max(
                1, 1 + len(opponent_factories)
            )
            training_result = trainer.train(
                lambda: _make_environment(training_environment_steps),
                team_id=learner_team_id,
                opponent_factories=opponent_factories,
            )

            def _learned_policy(policy_seed: int):
                if learning_run.planning_depth > 1:
                    transition_model = EnvironmentTransitionModel(
                        lambda candidate: _make_environment(2, candidate),
                        team_id=learner_team_id,
                        seed=policy_seed,
                    )
                    policy = DepthLimitedPlanningAgent(
                        training_result.model,
                        transition_model,
                        depth=learning_run.planning_depth,
                        branch_width=8,
                    )
                else:
                    policy = ActorCriticAgent(
                        training_result.model,
                        seed=policy_seed,
                        deterministic=True,
                    )
                return SpectralTargetGuardAgent(policy)

            learned_agent = _learned_policy(int(seed))
            learning_summary = training_result.to_dict(include_model=False)
            learning_summary.update({
                "checkpoint_id": _stable_digest(training_result.model.to_dict())[:16],
                "training_steps": learning_run.training_steps,
                "opponent_mode": f"frozen_{learning_run.opponent_mode}",
                "planning_depth": learning_run.planning_depth,
                "action_space": "bounded_parameters_and_structural_motifs",
                "deployment_guard": "simulator_shortlist_with_spectral_completion",
            })
            if learning_run.evaluation_seeds:
                benchmark_seeds = tuple(
                    int(seed) + 1000 + index
                    for index in range(learning_run.evaluation_seeds)
                )
                benchmark = PolicyEvaluationHarness(
                    lambda: _make_environment(learning_run.training_steps),
                    team_id=learner_team_id,
                    seeds=benchmark_seeds,
                    episodes=1,
                ).run({
                    "random": lambda benchmark_seed: RandomAgent(benchmark_seed),
                    "greedy": lambda benchmark_seed: GreedyAgent(),
                    "learned": _learned_policy,
                })
                learning_summary["benchmark"] = benchmark.to_dict()
                greedy_profile = PolicyProfile(
                    name="greedy_pool",
                    agent_factories={
                        team.team_id: (lambda profile_seed: GreedyAgent())
                        for team in teams
                    },
                )
                learned_profile_factories = dict(greedy_profile.agent_factories)
                learned_profile_factories[learner_team_id] = _learned_policy
                learned_profile = PolicyProfile(
                    name="learned_vs_frozen_greedy",
                    agent_factories=learned_profile_factories,
                )
                league = LeagueEvaluationHarness(
                    lambda: _make_environment(
                        learning_run.training_steps * max(1, len(teams))
                    ),
                    seeds=benchmark_seeds,
                    rounds=learning_run.training_steps,
                ).run(
                    (greedy_profile, learned_profile),
                    baseline_profile="learned_vs_frozen_greedy",
                    unilateral_deviations={
                        learner_team_id: lambda profile_seed: GreedyAgent()
                    },
                )
                learning_summary["league"] = league.to_dict()
        except (TypeError, ValueError, RuntimeError) as error:
            raise TeamSessionRequestError(f"Could not train learned agent: {error}") from error

    environment = _make_environment(max(1, len(moves) + agent_turns))
    _, reset_info = environment.reset(seed=int(seed))
    frames = [_frame(
        environment,
        index=0,
        shared_reward=float(reset_info["shared_reward"]),
        move=None,
    )]
    for index, move in enumerate(moves, start=1):
        _, shared_reward, _, _, info = environment.step(move)
        frames.append(_frame(
            environment,
            index=index,
            shared_reward=shared_reward,
            move=info["move"],
        ))

    greedy_agent = SpectralTargetGuardAgent(GreedyAgent())
    generated_moves = 0
    next_index = len(frames)
    team_cursor = 0
    exhausted_passes = 0
    while generated_moves < agent_turns and exhausted_passes < len(teams):
        team = teams[team_cursor % len(teams)]
        team_cursor += 1
        if environment.move_counts[team.team_id] >= team.move_budget:
            exhausted_passes += 1
            continue
        exhausted_passes = 0
        policy = (
            learned_agent
            if learned_agent is not None and team.team_id == learning_run.learner_team_id
            else greedy_agent
        )
        move = environment.select_move(team.team_id, policy)
        _, shared_reward, _, _, info = environment.step(move)
        frames.append(_frame(
            environment,
            index=next_index,
            shared_reward=shared_reward,
            move=info["move"],
        ))
        next_index += 1
        generated_moves += 1

    initial = environment.initial_rewards
    current = environment.current_rewards
    cumulative = environment.cumulative_rewards
    team_results = []
    for team in teams:
        team_results.append({
            **team.to_dict(),
            "initial_reward": float(initial[team.team_id].total),
            "final_reward": float(current[team.team_id].total),
            "cumulative_reward": float(cumulative[team.team_id]),
            "final_components": dict(current[team.team_id].components),
        })
    move_log = [record.to_dict() for record in environment.move_log]
    replay_material = {"frames": frames, "move_log": move_log}
    digest = _stable_digest(replay_material)
    return {
        "success": True,
        "session_id": digest[:16],
        "replay_digest": digest,
        "seed": int(seed),
        "iterations": horizon,
        "agent_strategy": learning_run.strategy,
        "learning": learning_summary,
        "agent_turns": generated_moves,
        "baseline": frames[0]["graph"],
        "final": graph_to_payload(environment.graph_snapshot),
        "teams": team_results,
        "move_log": move_log,
        "frames": frames,
        "accepted_moves": sum(1 for record in move_log if record["accepted"]),
        "rejected_moves": sum(1 for record in move_log if not record["accepted"]),
    }
