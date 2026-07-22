"""Focused tests for the framework-independent epsilon-greedy baseline."""

from __future__ import annotations

import tempfile
import unittest

import networkx as nx

try:
    from flowcld_env import (
        AddEdgeAction,
        AddNodeAction,
        EpsilonGreedyPolicy,
        EpsilonGreedySettings,
        EpsilonGreedyTrainer,
        EpsilonGreedyTrainingSettings,
        MutationMode,
        NoOpAction,
        Objective,
        ObjectiveOrientation,
        ParameterAction,
        ParameterName,
        PolicyTransition,
        StructuralTransaction,
        TargetSpecification,
        TeamDefinition,
        TeamMove,
        action_abstraction_key,
    )
except ModuleNotFoundError:
    from backend.flowcld_env import (
        AddEdgeAction,
        AddNodeAction,
        EpsilonGreedyPolicy,
        EpsilonGreedySettings,
        EpsilonGreedyTrainer,
        EpsilonGreedyTrainingSettings,
        MutationMode,
        NoOpAction,
        Objective,
        ObjectiveOrientation,
        ParameterAction,
        ParameterName,
        PolicyTransition,
        StructuralTransaction,
        TargetSpecification,
        TeamDefinition,
        TeamMove,
        action_abstraction_key,
    )


def _graph():
    graph = nx.DiGraph()
    graph.add_node("A", start_amount=1.0, retention=0.5)
    graph.add_node("B", start_amount=1.0, retention=0.5)
    graph.add_edge("A", "B", correlation=0.5, decay=0.1, delay=0)
    return graph


def _objective(orientation=ObjectiveOrientation.STABILIZE):
    return Objective(
        name="test",
        orientation=orientation,
        owned_nodes=frozenset({"A"}),
        target_nodes=frozenset({"B"}),
    )


def _increase(target="A", value=0.6):
    return ParameterAction(
        ParameterName.RETENTION, target, value, MutationMode.SET
    )


def _decrease(target="A", value=0.4):
    return ParameterAction(
        ParameterName.RETENTION, target, value, MutationMode.SET
    )


def _transition(policy, action, reward, *, accepted=True):
    graph = _graph()
    policy.update(PolicyTransition(
        graph=graph,
        objective=_objective(),
        action=action,
        reward=reward,
        next_graph=graph.copy(),
        done=False,
        accepted=accepted,
        context={"team_id": "blue"},
    ))


class _BanditEnvironment:
    """One-step environment with a stable preferred action family."""

    def __init__(self):
        self._baseline = _graph()
        self._graph = self._baseline.copy()
        self._done = False
        self.teams = (TeamDefinition(
            team_id="blue",
            name="Blue",
            role="team:blue",
            target=TargetSpecification(),
            owned_nodes=frozenset({"A"}),
            target_nodes=frozenset({"B"}),
            move_budget=1,
        ),)

    @property
    def graph_snapshot(self):
        return self._graph.copy()

    def reset(self, *, seed=None):
        self._graph = self._baseline.copy()
        self._done = False
        return {}, {"seed": seed}

    def legal_moves(self, team_id):
        if team_id != "blue" or self._done:
            return ()
        return (NoOpAction(), _increase(), _decrease())

    legal_parameter_moves = legal_moves

    def select_move(self, team_id, policy):
        action = policy.select_move(
            self.graph_snapshot,
            self.teams[0].as_objective(),
            self.legal_moves(team_id),
            lambda move: 999.0 if isinstance(move, NoOpAction) else -999.0,
        )
        return TeamMove(team_id=team_id, action=action)

    def step(self, move):
        self._done = True
        reward = 1.0 if move.action == _decrease() else -1.0
        if isinstance(move.action, ParameterAction):
            self._graph.nodes["A"]["retention"] = float(move.action.value)
        return {}, reward, True, False, {
            "move": {"accepted": True},
            "transition_rewards": {
                "blue": {"reward": reward, "components": {}}
            },
        }


class EpsilonGreedyPolicyTests(unittest.TestCase):
    def test_fixed_seed_makes_exploration_deterministic(self):
        settings = EpsilonGreedySettings(epsilon=1.0, epsilon_min=1.0, seed=7)
        first = EpsilonGreedyPolicy(settings)
        second = EpsilonGreedyPolicy(settings)
        first.reset(seed=19, training=True)
        second.reset(seed=19, training=True)
        legal = (NoOpAction(), _increase(), _decrease())

        sequence_a = [first.select_move(_graph(), _objective(), legal, lambda _: 0).to_dict()
                      for _ in range(20)]
        sequence_b = [second.select_move(_graph(), _objective(), legal, lambda _: 0).to_dict()
                      for _ in range(20)]
        self.assertEqual(sequence_a, sequence_b)

    def test_epsilon_one_explores_multiple_legal_actions(self):
        policy = EpsilonGreedyPolicy(EpsilonGreedySettings(
            epsilon=1.0, epsilon_min=1.0, seed=3
        ))
        policy.reset(seed=3, training=True)
        selected = {
            str(policy.select_move(
                _graph(), _objective(), (NoOpAction(), _increase(), _decrease()),
                lambda _: 0,
            ).to_dict())
            for _ in range(80)
        }
        self.assertEqual(len(selected), 3)

    def test_epsilon_zero_exploits_highest_learned_value(self):
        policy = EpsilonGreedyPolicy(EpsilonGreedySettings(
            epsilon=0.0, epsilon_min=0.0, seed=4
        ))
        policy.reset(seed=4, training=True)
        _transition(policy, _decrease(), 2.0)
        _transition(policy, _increase(), -1.0)
        selected = policy.select_move(
            _graph(), _objective(), (NoOpAction(), _increase(), _decrease()),
            lambda _: 1000.0,
        )
        self.assertEqual(selected, _decrease())

    def test_incremental_sample_average_and_visit_counts(self):
        policy = EpsilonGreedyPolicy(EpsilonGreedySettings(
            epsilon=0.0, epsilon_min=0.0
        ))
        policy.reset(training=True)
        _transition(policy, _decrease(), 1.0)
        _transition(policy, _decrease(), 3.0)
        key = action_abstraction_key(_graph(), _objective(), _decrease())
        self.assertEqual(policy.counts[key], 2)
        self.assertAlmostEqual(policy.values[key], 2.0)

    def test_epsilon_decay_stops_at_lower_bound(self):
        policy = EpsilonGreedyPolicy(EpsilonGreedySettings(
            epsilon=0.8, epsilon_min=0.2, epsilon_decay=0.5
        ))
        policy.reset(training=True)
        for _ in range(5):
            _transition(policy, _decrease(), 1.0)
        self.assertEqual(policy.epsilon, 0.2)

    def test_tie_breaking_is_seeded_and_order_independent(self):
        legal = (NoOpAction(), _increase(), _decrease())
        reversed_legal = tuple(reversed(legal))
        first = EpsilonGreedyPolicy(EpsilonGreedySettings(
            epsilon=0.0, epsilon_min=0.0, seed=12
        ))
        second = EpsilonGreedyPolicy(first.settings)
        first.reset(seed=12, training=False)
        second.reset(seed=12, training=False)
        self.assertEqual(
            first.select_move(_graph(), _objective(), legal, lambda _: 0),
            second.select_move(_graph(), _objective(), reversed_legal, lambda _: 0),
        )

    def test_action_keys_generalize_targets_values_and_structural_motifs(self):
        graph = _graph()
        self.assertEqual(
            action_abstraction_key(graph, _objective(), _increase("A", 0.6)),
            action_abstraction_key(graph, _objective(), _increase("B", 0.8)),
        )
        first = StructuralTransaction((
            AddNodeAction("C", start_amount=0.1, retention=0.5),
            AddEdgeAction("A", "C", correlation=0.4),
        ))
        second = StructuralTransaction((
            AddEdgeAction("B", "D", correlation=-0.2),
            AddNodeAction("D", start_amount=1.0, retention=0.8),
        ))
        self.assertEqual(
            action_abstraction_key(graph, _objective(), first),
            action_abstraction_key(graph, _objective(), second),
        )
        self.assertNotEqual(
            action_abstraction_key(graph, _objective(), first),
            action_abstraction_key(
                graph, _objective(ObjectiveOrientation.DISRUPT), first
            ),
        )

    def test_checkpoint_round_trip_preserves_values_counts_and_rng(self):
        policy = EpsilonGreedyPolicy(EpsilonGreedySettings(
            epsilon=0.5, epsilon_min=0.1, epsilon_decay=0.9, seed=8
        ))
        policy.reset(seed=8, training=True)
        _transition(policy, _decrease(), 2.5)
        with tempfile.TemporaryDirectory() as directory:
            restored = EpsilonGreedyPolicy.load(policy.save(f"{directory}/policy.json"))
        self.assertEqual(restored.values, policy.values)
        self.assertEqual(restored.counts, policy.counts)
        self.assertEqual(restored.epsilon, policy.epsilon)
        self.assertEqual(restored.state_dict()["rng_state"], policy.state_dict()["rng_state"])

    def test_checkpoint_rejects_mismatched_values_and_counts(self):
        checkpoint = dict(EpsilonGreedyPolicy().state_dict())
        checkpoint["values"] = {"stabilize|no_op": 1.0}
        checkpoint["counts"] = {}
        with self.assertRaisesRegex(ValueError, "matching keys"):
            EpsilonGreedyPolicy().load_state_dict(checkpoint)

    def test_evaluation_mode_neither_explores_nor_updates(self):
        policy = EpsilonGreedyPolicy(EpsilonGreedySettings(
            epsilon=1.0, epsilon_min=0.1, seed=5
        ))
        policy.reset(training=True)
        _transition(policy, _decrease(), 2.0)
        before = policy.state_dict()
        policy.reset(seed=5, training=False)
        _transition(policy, _increase(), 100.0)
        selected = policy.select_move(
            _graph(), _objective(), (NoOpAction(), _increase(), _decrease()),
            lambda _: -1000.0,
        )
        self.assertEqual(selected, _decrease())
        self.assertEqual(policy.values, before["values"])
        self.assertEqual(policy.counts, before["counts"])

    def test_rejected_action_learns_from_actual_invalid_penalty(self):
        policy = EpsilonGreedyPolicy(EpsilonGreedySettings(
            epsilon=0.0, epsilon_min=0.0
        ))
        policy.reset(training=True)
        _transition(policy, _increase(), -1.0, accepted=False)
        key = action_abstraction_key(_graph(), _objective(), _increase())
        self.assertEqual(policy.values[key], -1.0)
        self.assertEqual(policy.counts[key], 1)

    def test_candidate_preview_is_not_used_for_selection_or_updates(self):
        policy = EpsilonGreedyPolicy(EpsilonGreedySettings(
            epsilon=0.0, epsilon_min=0.0, seed=2
        ))
        policy.reset(training=True)
        _transition(policy, _decrease(), 1.0)

        def forbidden_preview(_):
            raise AssertionError("epsilon-greedy must not query candidate preview")

        selected = policy.select_move(
            _graph(), _objective(), (NoOpAction(), _increase(), _decrease()),
            forbidden_preview,
        )
        self.assertEqual(selected, _decrease())

    def test_trainer_learns_a_real_preference_from_committed_rewards(self):
        policy = EpsilonGreedyPolicy(EpsilonGreedySettings(
            epsilon=0.8,
            epsilon_min=0.05,
            epsilon_decay=0.96,
            seed=9,
        ))
        result = EpsilonGreedyTrainer(EpsilonGreedyTrainingSettings(
            episodes=100, seed=9
        )).train(_BanditEnvironment, team_id="blue", policy=policy)
        environment = _BanditEnvironment()
        environment.reset(seed=99)
        selected = result.policy.select_move(
            environment.graph_snapshot,
            environment.teams[0].as_objective(),
            environment.legal_moves("blue"),
            lambda _: 999.0,
        )
        self.assertEqual(selected, _decrease())
        self.assertGreater(
            result.policy.values[
                action_abstraction_key(_graph(), _objective(), _decrease())
            ],
            result.policy.values[
                action_abstraction_key(_graph(), _objective(), _increase())
            ],
        )


if __name__ == "__main__":
    unittest.main()
