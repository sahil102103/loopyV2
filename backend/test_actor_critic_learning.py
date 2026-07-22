"""Stage 5 actor-critic, checkpoint, and evaluation regression tests."""

from __future__ import annotations

import tempfile
import unittest

import networkx as nx

try:
    from flowcld_env import (
        ActorCriticAgent,
        ActorCriticTrainer,
        ActorCriticTrainingSettings,
        BoundedStructuralCandidateGenerator,
        DepthLimitedPlanningAgent,
        GreedyAgent,
        LinearActorCritic,
        MessagePassingFeatureEncoder,
        MutationMode,
        NoOpAction,
        ParameterAction,
        ParameterName,
        PlannedTransition,
        PolicyEvaluationHarness,
        RandomAgent,
        StructuralTransaction,
        TargetSpecification,
        TeamDefinition,
        TeamMove,
        Objective,
    )
except ModuleNotFoundError:
    from backend.flowcld_env import (
        ActorCriticAgent,
        ActorCriticTrainer,
        ActorCriticTrainingSettings,
        BoundedStructuralCandidateGenerator,
        DepthLimitedPlanningAgent,
        GreedyAgent,
        LinearActorCritic,
        MessagePassingFeatureEncoder,
        MutationMode,
        NoOpAction,
        ParameterAction,
        ParameterName,
        PlannedTransition,
        PolicyEvaluationHarness,
        RandomAgent,
        StructuralTransaction,
        TargetSpecification,
        TeamDefinition,
        TeamMove,
        Objective,
    )


class _OneStepEnvironment:
    """Small stationary board where one action is always better."""

    def __init__(self):
        graph = nx.DiGraph()
        graph.add_node(
            "A", start_amount=0.0, retention=0.5, floor=-10.0, ceiling=10.0
        )
        self._baseline = graph
        self._graph = graph.copy()
        self._done = False
        self.teams = (TeamDefinition(
            team_id="blue",
            name="Blue",
            role="team:blue",
            target=TargetSpecification(),
            owned_nodes=frozenset({"A"}),
            target_nodes=frozenset({"A"}),
            gamma=0.9,
            move_budget=1,
        ),)

    @property
    def graph_snapshot(self):
        return self._graph.copy()

    def reset(self, *, seed=None):
        self._graph = self._baseline.copy()
        self._done = False
        return {}, {"seed": seed}

    def legal_parameter_moves(self, team_id):
        if team_id != "blue" or self._done:
            return ()
        return (
            NoOpAction(),
            ParameterAction(
                parameter=ParameterName.START_AMOUNT,
                target="A",
                value=1.0,
                mode=MutationMode.SET,
            ),
        )

    def select_move(self, team_id, policy):
        legal = self.legal_parameter_moves(team_id)
        team = self.teams[0]
        action = policy.select_move(
            self.graph_snapshot,
            team.as_objective(),
            legal,
            lambda move: 1.0 if isinstance(move, ParameterAction) else -1.0,
        )
        return TeamMove(team_id=team_id, action=action)

    def step(self, move):
        good = isinstance(move.action, ParameterAction)
        if good:
            self._graph.nodes["A"]["start_amount"] = 1.0
        self._done = True
        reward = 1.0 if good else -1.0
        return {}, reward, True, False, {
            "transition_rewards": {"blue": {"total": reward, "components": {}}}
        }


class _TwoStepTransitionModel:
    def __init__(self, trap, setup):
        self.trap = trap
        self.setup = setup

    def legal_moves(self, graph):
        if float(graph.nodes["A"]["start_amount"]) == 0.0:
            return (self.trap, self.setup)
        return (NoOpAction(),)

    def step(self, graph, action):
        candidate = graph.copy()
        state = float(candidate.nodes["A"]["start_amount"])
        if state == 0.0 and isinstance(action, ParameterAction):
            candidate.nodes["A"]["start_amount"] = action.value
            return PlannedTransition(
                reward=1.0 if action.value > 0 else 0.0,
                next_graph=candidate,
                terminated=False,
            )
        return PlannedTransition(
            reward=-3.0 if state > 0 else 2.0,
            next_graph=candidate,
            terminated=True,
        )


class ActorCriticLearningTests(unittest.TestCase):
    def test_actor_critic_learns_preferred_action_and_value_baseline(self):
        settings = ActorCriticTrainingSettings(
            episodes=80,
            n_step=1,
            actor_learning_rate=0.12,
            critic_learning_rate=0.15,
            temperature=0.8,
            seed=9,
        )
        result = ActorCriticTrainer(settings).train(
            _OneStepEnvironment, team_id="blue"
        )
        environment = _OneStepEnvironment()
        environment.reset(seed=1)
        team = environment.teams[0]
        agent = ActorCriticAgent(result.model, deterministic=True, seed=1)
        decision = agent.decide(
            environment.graph_snapshot,
            team.as_objective(),
            environment.legal_parameter_moves("blue"),
        )

        self.assertIsInstance(decision.action, ParameterAction)
        self.assertGreater(decision.probabilities[1], 0.8)
        self.assertNotEqual(float(abs(result.model.value_weights).sum()), 0.0)
        self.assertEqual(result.algorithm, "n_step_actor_critic")

    def test_deterministic_deployment_guard_rejects_a_worse_policy_move(self):
        environment = _OneStepEnvironment()
        environment.reset(seed=1)
        team = environment.teams[0]
        legal = environment.legal_parameter_moves("blue")
        encoder = MessagePassingFeatureEncoder()
        encoded = encoder.encode(
            environment.graph_snapshot, team.as_objective(), legal
        )
        model = LinearActorCritic(
            state_size=len(encoded.state),
            action_size=encoded.actions.shape[1],
            policy_weights=[0.0] * (len(encoded.state) + encoded.actions.shape[1]),
            value_weights=[0.0] * len(encoded.state),
        )
        agent = ActorCriticAgent(model, deterministic=True, seed=1)

        selected = agent.select_move(
            environment.graph_snapshot,
            team.as_objective(),
            legal,
            lambda move: 1.0 if isinstance(move, ParameterAction) else -1.0,
        )

        self.assertIsInstance(selected, ParameterAction)

    def test_model_checkpoint_round_trip_is_json_and_prediction_stable(self):
        encoder = MessagePassingFeatureEncoder()
        environment = _OneStepEnvironment()
        environment.reset(seed=1)
        team = environment.teams[0]
        encoded = encoder.encode(
            environment.graph_snapshot,
            team.as_objective(),
            environment.legal_parameter_moves("blue"),
        )
        model = LinearActorCritic(
            state_size=len(encoded.state), action_size=encoded.actions.shape[1], seed=5
        )
        with tempfile.TemporaryDirectory() as directory:
            path = model.save(f"{directory}/policy.json")
            loaded = LinearActorCritic.load(path)

        original = ActorCriticAgent(model, encoder=encoder, deterministic=True).decide(
            environment.graph_snapshot,
            team.as_objective(),
            environment.legal_parameter_moves("blue"),
        )
        restored = ActorCriticAgent(loaded, encoder=encoder, deterministic=True).decide(
            environment.graph_snapshot,
            team.as_objective(),
            environment.legal_parameter_moves("blue"),
        )
        self.assertEqual(original.action.to_dict(), restored.action.to_dict())
        self.assertEqual(original.probabilities.tolist(), restored.probabilities.tolist())

    def test_planning_agent_exposes_serializable_policy_lifecycle(self):
        environment = _OneStepEnvironment()
        environment.reset(seed=1)
        team = environment.teams[0]
        encoder = MessagePassingFeatureEncoder()
        encoded = encoder.encode(
            environment.graph_snapshot,
            team.as_objective(),
            environment.legal_parameter_moves("blue"),
        )
        model = LinearActorCritic(
            state_size=len(encoded.state),
            action_size=encoded.actions.shape[1],
            seed=5,
        )
        transition_model = _TwoStepTransitionModel(
            ParameterAction(
                ParameterName.START_AMOUNT, "A", 1.0, MutationMode.SET
            ),
            ParameterAction(
                ParameterName.START_AMOUNT, "A", -1.0, MutationMode.SET
            ),
        )
        original = DepthLimitedPlanningAgent(
            model, transition_model, depth=2, branch_width=2
        )
        checkpoint = original.state_dict()
        restored = DepthLimitedPlanningAgent(
            model, transition_model, depth=1, branch_width=1
        )
        restored.load_state_dict(checkpoint)

        self.assertEqual(restored.depth, 2)
        self.assertEqual(restored.branch_width, 2)
        self.assertEqual(restored.model.to_dict(), original.model.to_dict())

    def test_policy_state_encodes_optional_spectral_objective(self):
        environment = _OneStepEnvironment()
        environment.reset(seed=1)
        graph = environment.graph_snapshot
        encoder = MessagePassingFeatureEncoder()
        without_target = Objective(name="Blue")
        with_target = Objective(
            name="Blue",
            target=TargetSpecification(spectral_radius=0.85),
        )

        plain = encoder.encode_state(graph, without_target)
        spectral = encoder.encode_state(graph, with_target)

        self.assertEqual(len(plain), encoder.state_size)
        self.assertEqual(len(spectral), encoder.state_size)
        self.assertNotEqual(plain.tolist(), spectral.tolist())

    def test_policy_features_distinguish_mediated_and_balancing_transactions(self):
        graph = nx.DiGraph()
        graph.add_node("a", start_amount=1.0, retention=1.0)
        graph.add_node("b", start_amount=0.5, retention=1.0)
        graph.add_edge(
            "a", "b", correlation=0.8, decay=0.0, delay=0,
            confidence=1.0, functional_form="linear",
        )
        objective = Objective(
            name="Blue",
            owned_nodes=frozenset({"a"}),
            target_nodes=frozenset({"b"}),
            target=TargetSpecification(spectral_radius=0.95),
        )
        candidates = BoundedStructuralCandidateGenerator().generate(
            graph, objective, remaining_edits=4
        )
        transactions = [
            move for move in candidates
            if isinstance(move, StructuralTransaction)
            and move.label in {
                "mediated path: a -> c -> b",
                "balancing path: a -> c -> b",
            }
        ]
        encoder = MessagePassingFeatureEncoder()
        encoded = encoder.encode(graph, objective, transactions)

        self.assertEqual(len(transactions), 2)
        self.assertNotEqual(encoded.actions[0].tolist(), encoded.actions[1].tolist())

    def test_plain_reinforce_baseline_remains_available_without_critic_updates(self):
        result = ActorCriticTrainer(ActorCriticTrainingSettings(
            episodes=5,
            actor_learning_rate=0.1,
            critic_learning_rate=0.1,
            use_critic=False,
            seed=3,
        )).train(_OneStepEnvironment, team_id="blue")

        self.assertEqual(result.algorithm, "reinforce")
        self.assertEqual(float(abs(result.model.value_weights).sum()), 0.0)

    def test_seed_matched_harness_compares_random_greedy_and_learned(self):
        trained = ActorCriticTrainer(ActorCriticTrainingSettings(
            episodes=40, n_step=1, actor_learning_rate=0.12,
            critic_learning_rate=0.12, seed=4,
        )).train(_OneStepEnvironment, team_id="blue")
        result = PolicyEvaluationHarness(
            _OneStepEnvironment,
            team_id="blue",
            seeds=(2, 3, 5),
            episodes=2,
        ).run({
            "random": lambda seed: RandomAgent(seed),
            "greedy": lambda seed: GreedyAgent(),
            "learned": lambda seed: ActorCriticAgent(
                trained.model, seed=seed, deterministic=True
            ),
        })

        self.assertEqual(set(result.curves), {"random", "greedy", "learned"})
        self.assertEqual(result.curves["greedy"].overall_mean, 1.0)
        self.assertEqual(result.curves["learned"].overall_mean, 1.0)
        self.assertGreater(result.curves["learned"].overall_mean,
                           result.curves["random"].overall_mean)

    def test_depth_limited_planning_avoids_one_step_reward_trap(self):
        environment = _OneStepEnvironment()
        environment.reset(seed=1)
        objective = Objective(
            name="Blue",
            owned_nodes=frozenset({"A"}),
            target_nodes=frozenset({"A"}),
            gamma=0.9,
        )
        trap = ParameterAction(ParameterName.START_AMOUNT, "A", 1.0)
        setup = ParameterAction(ParameterName.START_AMOUNT, "A", -1.0)
        encoder = MessagePassingFeatureEncoder()
        encoded = encoder.encode(environment.graph_snapshot, objective, (trap, setup))
        model = LinearActorCritic(
            state_size=len(encoded.state),
            action_size=encoded.actions.shape[1],
            policy_weights=[0.0] * (len(encoded.state) + encoded.actions.shape[1]),
            value_weights=[0.0] * len(encoded.state),
        )
        transition_model = _TwoStepTransitionModel(trap, setup)

        one_step = DepthLimitedPlanningAgent(
            model, transition_model, encoder=encoder, depth=1, prior_weight=0.0
        ).select_move(environment.graph_snapshot, objective, (trap, setup), lambda _: 0.0)
        two_step = DepthLimitedPlanningAgent(
            model, transition_model, encoder=encoder, depth=2, prior_weight=0.0
        ).select_move(environment.graph_snapshot, objective, (trap, setup), lambda _: 0.0)

        self.assertEqual(one_step.value, 1.0)
        self.assertEqual(two_step.value, -1.0)


if __name__ == "__main__":
    unittest.main()
