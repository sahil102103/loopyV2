"""Run the seed-matched Step 2 policy baseline comparison.

This is an exploratory engineering benchmark. It deliberately reuses the
production environment, action candidates, simulator, and objective reward.
It does not establish scientific validity for the current reward function.
"""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Callable

import networkx as nx

from flowcld_env import (
    ActorCriticAgent,
    ActorCriticTrainer,
    ActorCriticTrainingSettings,
    DetailedPolicyEvaluationHarness,
    EpsilonGreedyPolicy,
    EpsilonGreedySettings,
    EpsilonGreedyTrainer,
    EpsilonGreedyTrainingSettings,
    GreedyAgent,
    MultiTeamEnvironment,
    NoOpAgent,
    ObjectiveOrientation,
    ParameterName,
    RandomAgent,
    RoleBasedAuthorizationPolicy,
    RoleDefinition,
    SimulationObservationBuilder,
    StructuralActionKind,
    StructuralConstraintSet,
    StructuralGraphMutator,
    TargetSpecification,
    TeamDefinition,
)


EnvironmentFactory = Callable[[], MultiTeamEnvironment]


def _node(graph: nx.DiGraph, name: str, start: float, retention: float) -> None:
    graph.add_node(
        name,
        start_amount=start,
        retention=retention,
        floor=-10.0,
        ceiling=10.0,
        formula=None,
        sink_formula=None,
        source_formula=None,
    )


def _edge(
    graph: nx.DiGraph,
    source: str,
    target: str,
    correlation: float,
    *,
    decay: float = 0.1,
) -> None:
    graph.add_edge(
        source,
        target,
        correlation=correlation,
        decay=decay,
        confidence=1.0,
        delay=0,
        functional_form="linear",
    )


def _scenario(
    name: str,
    graph: nx.DiGraph,
    *,
    orientation: ObjectiveOrientation,
    target: TargetSpecification,
    parameter_permissions: frozenset[ParameterName],
    structural_permissions: frozenset[StructuralActionKind] = frozenset(),
    structural_budget: int = 0,
    max_steps: int = 4,
) -> EnvironmentFactory:
    role_name = f"benchmark:{name}"
    role = RoleDefinition(
        name=role_name,
        node_parameters=frozenset(
            parameter for parameter in parameter_permissions
            if parameter in {ParameterName.START_AMOUNT, ParameterName.RETENTION}
        ),
        edge_parameters=frozenset(
            parameter for parameter in parameter_permissions
            if parameter not in {ParameterName.START_AMOUNT, ParameterName.RETENTION}
        ),
        structural_actions=structural_permissions,
        node_targets=None,
        edge_targets=None,
    )
    team = TeamDefinition(
        team_id="learner",
        name=name,
        role=role_name,
        orientation=orientation,
        target=target,
        owned_nodes=frozenset(graph.nodes),
        target_nodes=frozenset({"b"}),
        preset="balanced",
        move_budget=max_steps,
        structural_budget=structural_budget,
        min_live_nodes=graph.number_of_nodes(),
    )
    baseline = copy.deepcopy(graph)

    def factory() -> MultiTeamEnvironment:
        fresh = copy.deepcopy(baseline)
        return MultiTeamEnvironment(
            fresh,
            teams=(team,),
            authorization_policy=RoleBasedAuthorizationPolicy((role,)),
            structural_mutator=StructuralGraphMutator(
                fresh,
                StructuralConstraintSet.conservative(
                    protected_nodes=baseline.nodes,
                ),
            ),
            observation_builder=SimulationObservationBuilder(horizon=24),
            max_structural_candidates=12,
            max_steps=max_steps,
        )

    return factory


def scenarios() -> dict[str, EnvironmentFactory]:
    stabilizer = nx.DiGraph()
    _node(stabilizer, "a", 0.8, 0.75)
    _node(stabilizer, "b", 0.4, 0.7)
    _edge(stabilizer, "a", "b", 0.55)
    _edge(stabilizer, "b", "a", -0.45)

    disruptor = copy.deepcopy(stabilizer)

    spectral = nx.DiGraph()
    # This fixture makes the reward tension visible: reducing a strongly
    # unstable loop toward a low radius can also drive its tiny signal below
    # the evaluator's live-activity threshold over the fixed horizon.
    _node(spectral, "a", 0.001, 0.95)
    _node(spectral, "b", 0.0005, 0.95)
    _edge(spectral, "a", "b", 0.85, decay=0.0)
    _edge(spectral, "b", "a", 0.85, decay=0.0)

    structural = nx.DiGraph()
    _node(structural, "a", 0.8, 0.9)
    _node(structural, "b", 0.4, 0.9)
    _edge(structural, "a", "b", 0.8, decay=0.0)
    _edge(structural, "b", "a", 0.8, decay=0.0)

    parameter_moves = frozenset({
        ParameterName.RETENTION,
        ParameterName.DECAY,
        ParameterName.CORRELATION,
    })
    structural_moves = frozenset({
        StructuralActionKind.ADD_NODE,
        StructuralActionKind.ADD_EDGE,
        StructuralActionKind.REMOVE_EDGE,
    })
    return {
        "stabilizer": _scenario(
            "stabilizer",
            stabilizer,
            orientation=ObjectiveOrientation.STABILIZE,
            target=TargetSpecification(behaviors={"b": "Optimal"}),
            parameter_permissions=parameter_moves,
        ),
        "disruptor": _scenario(
            "disruptor",
            disruptor,
            orientation=ObjectiveOrientation.DISRUPT,
            target=TargetSpecification(behaviors={"b": "Optimal"}),
            parameter_permissions=parameter_moves,
        ),
        "spectral_weak_activity": _scenario(
            "spectral weak activity",
            spectral,
            orientation=ObjectiveOrientation.STABILIZE,
            target=TargetSpecification(
                behaviors={"b": "Optimal"},
                spectral_radius=0.55,
            ),
            parameter_permissions=parameter_moves,
            max_steps=8,
        ),
        "bounded_structural": _scenario(
            "bounded structural",
            structural,
            orientation=ObjectiveOrientation.STABILIZE,
            target=TargetSpecification(
                behaviors={"b": "Optimal"},
                spectral_radius=0.9,
            ),
            parameter_permissions=frozenset(),
            structural_permissions=structural_moves,
            structural_budget=4,
            max_steps=3,
        ),
    }


def _restored_epsilon(checkpoint: dict, seed: int) -> EpsilonGreedyPolicy:
    policy = EpsilonGreedyPolicy()
    policy.load_state_dict(checkpoint)
    policy.reset(seed=seed, training=False)
    return policy


def run(*, training_episodes: int, seeds: tuple[int, ...]) -> dict:
    report = {
        "status": "exploratory_not_research_validated",
        "training_episodes": training_episodes,
        "evaluation_seeds": list(seeds),
        "scenarios": {},
    }
    for index, (scenario_name, environment_factory) in enumerate(scenarios().items()):
        training_seed = 700 + index * 100
        epsilon_settings = EpsilonGreedySettings(
            epsilon=0.35,
            epsilon_min=0.03,
            epsilon_decay=0.97,
            seed=training_seed,
        )
        untrained_checkpoint = EpsilonGreedyPolicy(epsilon_settings).state_dict()
        epsilon_result = EpsilonGreedyTrainer(EpsilonGreedyTrainingSettings(
            episodes=training_episodes,
            seed=training_seed,
        )).train(
            environment_factory,
            team_id="learner",
            policy=EpsilonGreedyPolicy(epsilon_settings),
        )
        trained_checkpoint = dict(epsilon_result.policy.state_dict())

        actor_result = ActorCriticTrainer(ActorCriticTrainingSettings(
            episodes=training_episodes,
            n_step=3,
            seed=training_seed,
        )).train(environment_factory, team_id="learner")

        benchmark = DetailedPolicyEvaluationHarness(
            environment_factory,
            team_id="learner",
            seeds=seeds,
        ).run({
            "no_op": lambda seed: NoOpAgent(),
            "random": lambda seed: RandomAgent(seed),
            "greedy_preview": lambda seed: GreedyAgent(),
            "epsilon_untrained": lambda seed: _restored_epsilon(
                untrained_checkpoint, seed
            ),
            "epsilon_trained": lambda seed: _restored_epsilon(
                trained_checkpoint, seed
            ),
            "actor_critic": lambda seed: ActorCriticAgent(
                actor_result.model,
                seed=seed,
                deterministic=True,
                simulator_guard=False,
            ),
        })
        report["scenarios"][scenario_name] = {
            "benchmark": benchmark.to_dict(),
            "epsilon_training": epsilon_result.to_dict(),
            "actor_critic_training": actor_result.to_dict(),
        }
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--training-episodes", type=int, default=40)
    parser.add_argument("--seeds", default="101,211,307")
    parser.add_argument("--output", type=Path)
    arguments = parser.parse_args()
    seeds = tuple(int(value.strip()) for value in arguments.seeds.split(",") if value.strip())
    report = run(training_episodes=arguments.training_episodes, seeds=seeds)
    serialized = json.dumps(report, indent=2, sort_keys=True)
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(serialized + "\n", encoding="utf-8")
    print(serialized)


if __name__ == "__main__":
    main()
