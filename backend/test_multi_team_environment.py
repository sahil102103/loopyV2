"""Stage 4 domain tests for shared objectives and auditable team moves."""

import unittest

import networkx as nx

try:
    from flowcld_env import (
        AddEdgeAction,
        AddNodeAction,
        GreedyAgent,
        MultiTeamEnvironment,
        MutationMode,
        NoOpAction,
        ObjectiveOrientation,
        ParameterAction,
        ParameterName,
        RoleBasedAuthorizationPolicy,
        RoleDefinition,
        SimulationObservationBuilder,
        StructuralActionKind,
        StructuralConstraintSet,
        StructuralGraphMutator,
        StructuralTransaction,
        TargetSpecification,
        TeamDefinition,
        TeamMove,
    )
except ModuleNotFoundError:
    from backend.flowcld_env import (
        AddEdgeAction,
        AddNodeAction,
        GreedyAgent,
        MultiTeamEnvironment,
        MutationMode,
        NoOpAction,
        ObjectiveOrientation,
        ParameterAction,
        ParameterName,
        RoleBasedAuthorizationPolicy,
        RoleDefinition,
        SimulationObservationBuilder,
        StructuralActionKind,
        StructuralConstraintSet,
        StructuralGraphMutator,
        StructuralTransaction,
        TargetSpecification,
        TeamDefinition,
        TeamMove,
    )


def _graph():
    graph = nx.DiGraph()
    for node in ("A", "B", "C"):
        graph.add_node(
            node,
            start_amount=1.0,
            retention=0.5,
            floor=-100.0,
            ceiling=100.0,
        )
    for source, target in (("A", "B"), ("B", "C"), ("C", "A")):
        graph.add_edge(
            source,
            target,
            correlation=0.2,
            decay=0.1,
            delay=0,
            confidence=1.0,
            functional_form="linear",
        )
    return graph


def _reinforcing_pair():
    graph = nx.DiGraph()
    graph.add_node("a", start_amount=1.0, retention=1.0, floor=-100.0, ceiling=100.0)
    graph.add_node("b", start_amount=0.5, retention=1.0, floor=-100.0, ceiling=100.0)
    graph.add_edge(
        "a", "b", correlation=0.8, decay=0.0, delay=0,
        confidence=1.0, functional_form="linear",
    )
    graph.add_edge(
        "b", "a", correlation=0.8, decay=0.0, delay=0,
        confidence=1.0, functional_form="linear",
    )
    return graph


def _teams():
    return (
        TeamDefinition(
            team_id="household",
            name="Household",
            role="team:household",
            target=TargetSpecification(trajectories={"A": (1.0, 1.0, 1.0)}),
            weight=2.0,
        ),
        TeamDefinition(
            team_id="bank",
            name="Bank",
            role="team:bank",
            target=TargetSpecification(behaviors={"B": "Optimal"}),
        ),
        TeamDefinition(
            team_id="designer",
            name="Designer",
            role="team:designer",
            target=TargetSpecification(behaviors={"C": "Optimal"}),
        ),
    )


def _policy():
    return RoleBasedAuthorizationPolicy((
        RoleDefinition(
            name="team:household",
            node_parameters=frozenset({ParameterName.START_AMOUNT}),
            node_targets=frozenset({"A"}),
        ),
        RoleDefinition(
            name="team:bank",
            edge_parameters=frozenset({ParameterName.DECAY}),
            edge_targets=frozenset({("A", "B")}),
        ),
        RoleDefinition(
            name="team:designer",
            structural_actions=frozenset({
                StructuralActionKind.ADD_NODE,
                StructuralActionKind.ADD_EDGE,
            }),
            node_targets=None,
            edge_targets=None,
        ),
    ))


class MultiTeamEnvironmentTests(unittest.TestCase):
    def setUp(self):
        graph = _graph()
        self.environment = MultiTeamEnvironment(
            graph,
            teams=_teams(),
            authorization_policy=_policy(),
            structural_mutator=StructuralGraphMutator(
                graph,
                StructuralConstraintSet.conservative(protected_nodes=("A", "B", "C")),
            ),
            observation_builder=SimulationObservationBuilder(horizon=2),
            max_steps=3,
        )
        self.environment.reset(seed=7)

    def test_authorized_parameter_move_updates_shared_graph_and_scores_every_team(self):
        _, shared_reward, _, _, info = self.environment.step(TeamMove(
            team_id="household",
            action=ParameterAction(
                parameter=ParameterName.START_AMOUNT,
                target="A",
                value=2.0,
                mode=MutationMode.SET,
            ),
        ))

        self.assertEqual(self.environment.graph_snapshot.nodes["A"]["start_amount"], 2.0)
        self.assertTrue(info["move"]["accepted"])
        self.assertEqual(set(info["team_objectives"]), {"household", "bank", "designer"})
        self.assertEqual(shared_reward, info["shared_reward"])
        self.assertEqual(len(self.environment.move_log), 1)

    def test_rejected_move_penalizes_only_its_owner_and_preserves_graph(self):
        before = self.environment.graph_snapshot.nodes["A"]["start_amount"]
        _, _, _, _, info = self.environment.step(TeamMove(
            team_id="bank",
            action=ParameterAction(
                parameter=ParameterName.START_AMOUNT,
                target="A",
                value=5.0,
                mode=MutationMode.SET,
            ),
        ))

        move = info["move"]
        self.assertFalse(move["accepted"])
        self.assertIn("not authorized", move["reason"])
        self.assertEqual(self.environment.graph_snapshot.nodes["A"]["start_amount"], before)
        self.assertEqual(move["objective_components"]["bank"]["invalid_action"], -1.0)
        self.assertEqual(move["objective_components"]["household"]["invalid_action"], 0.0)
        self.assertEqual(move["objective_components"]["designer"]["invalid_action"], 0.0)

    def test_atomic_structural_move_uses_stage_three_constraints(self):
        transaction = StructuralTransaction((
            AddNodeAction("D", start_amount=0.5, retention=0.5),
            AddEdgeAction("C", "D", correlation=0.2),
        ))
        _, _, _, truncated, info = self.environment.step(TeamMove(
            team_id="designer",
            action=transaction,
        ))

        self.assertTrue(info["move"]["accepted"])
        self.assertIn("D", self.environment.graph_snapshot)
        self.assertTrue(self.environment.graph_snapshot.has_edge("C", "D"))
        self.assertFalse(truncated)

    def test_m1_action_space_includes_no_op_and_polarity_flip(self):
        graph = _graph()
        teams = (TeamDefinition(
            team_id="blue",
            name="Blue",
            role="team:blue",
            target=TargetSpecification(behaviors={"A": "Optimal"}),
            target_nodes=frozenset({"A"}),
        ),)
        policy = RoleBasedAuthorizationPolicy((RoleDefinition(
            name="team:blue",
            edge_parameters=frozenset({ParameterName.CORRELATION}),
            edge_targets=frozenset({("A", "B")}),
        ),))
        environment = MultiTeamEnvironment(
            graph,
            teams=teams,
            authorization_policy=policy,
            observation_builder=SimulationObservationBuilder(horizon=2),
            max_steps=2,
        )
        environment.reset(seed=2)

        legal = environment.legal_parameter_moves("blue")
        self.assertTrue(any(isinstance(move, NoOpAction) for move in legal))
        flips = [
            move for move in legal
            if isinstance(move, ParameterAction)
            and move.parameter == ParameterName.CORRELATION
        ]
        self.assertEqual(len(flips), 1)
        self.assertAlmostEqual(flips[0].value, -0.2)

    def test_unified_agent_moves_include_safe_edge_subdivision_through_c(self):
        graph = _reinforcing_pair()
        team = TeamDefinition(
            team_id="blue",
            name="Blue",
            role="team:blue",
            target=TargetSpecification(
                behaviors={"b": "Optimal"}, spectral_radius=0.95
            ),
            owned_nodes=frozenset({"a"}),
            target_nodes=frozenset({"b"}),
            structural_move_cost=0.0,
            structural_budget=4,
        )
        policy = RoleBasedAuthorizationPolicy((RoleDefinition(
            name="team:blue",
            structural_actions=frozenset({
                StructuralActionKind.ADD_NODE,
                StructuralActionKind.ADD_EDGE,
                StructuralActionKind.REMOVE_EDGE,
            }),
            node_targets=None,
            edge_targets=None,
        ),))
        environment = MultiTeamEnvironment(
            graph,
            teams=(team,),
            authorization_policy=policy,
            observation_builder=SimulationObservationBuilder(horizon=10),
            max_steps=2,
        )
        environment.reset(seed=9)

        legacy = environment.legal_parameter_moves("blue")
        legal = environment.legal_moves("blue")
        subdivision = next(
            move for move in legal
            if isinstance(move, StructuralTransaction)
            and move.label == "mediated path: a -> c -> b"
        )

        self.assertTrue(all(isinstance(move, NoOpAction) for move in legacy))
        self.assertEqual(len(subdivision.edits), 4)
        _, _, _, _, info = environment.step(TeamMove("blue", subdivision))
        self.assertTrue(info["move"]["accepted"])
        self.assertIn("c", environment.graph_snapshot)
        self.assertFalse(environment.graph_snapshot.has_edge("a", "b"))
        self.assertTrue(environment.graph_snapshot.has_edge("a", "c"))
        self.assertTrue(environment.graph_snapshot.has_edge("c", "b"))

    def test_greedy_agent_can_choose_an_autonomous_structural_regulator(self):
        graph = _reinforcing_pair()
        team = TeamDefinition(
            team_id="green",
            name="Green",
            role="team:green",
            target=TargetSpecification(
                behaviors={"b": "Optimal"}, spectral_radius=0.95
            ),
            owned_nodes=frozenset({"a"}),
            target_nodes=frozenset({"b"}),
            gamma=1.0,
            structural_move_cost=0.0,
            structural_budget=3,
        )
        policy = RoleBasedAuthorizationPolicy((RoleDefinition(
            name="team:green",
            structural_actions=frozenset({
                StructuralActionKind.ADD_NODE,
                StructuralActionKind.ADD_EDGE,
            }),
            node_targets=None,
            edge_targets=None,
        ),))
        environment = MultiTeamEnvironment(
            graph,
            teams=(team,),
            authorization_policy=policy,
            observation_builder=SimulationObservationBuilder(horizon=10),
            max_steps=1,
        )
        environment.reset(seed=11)

        move = environment.select_move("green", GreedyAgent())

        self.assertIsInstance(move.action, StructuralTransaction)
        self.assertIn("parallel balancing path", move.action.label)
        environment.step(move)
        self.assertIn("c", environment.graph_snapshot)

    def test_stabilizer_and_disruptor_have_opposite_transition_incentives(self):
        graph = _graph()
        target = TargetSpecification(behaviors={"A": "Optimal"})
        teams = (
            TeamDefinition(
                team_id="blue", name="Blue", role="team:blue", target=target,
                orientation=ObjectiveOrientation.STABILIZE,
                target_nodes=frozenset({"A"}), gamma=1.0, parameter_move_cost=0.0,
            ),
            TeamDefinition(
                team_id="red", name="Red", role="team:red", target=target,
                orientation=ObjectiveOrientation.DISRUPT,
                target_nodes=frozenset({"A"}), gamma=1.0, parameter_move_cost=0.0,
            ),
        )
        policy = RoleBasedAuthorizationPolicy((
            RoleDefinition(
                name="team:blue",
                edge_parameters=frozenset({ParameterName.CORRELATION}),
                edge_targets=frozenset({("A", "B")}),
            ),
            RoleDefinition(name="team:red"),
        ))
        environment = MultiTeamEnvironment(
            graph,
            teams=teams,
            authorization_policy=policy,
            observation_builder=SimulationObservationBuilder(horizon=2),
            max_steps=1,
        )
        environment.reset(seed=3)
        _, _, _, _, info = environment.step(TeamMove(
            team_id="blue",
            action=ParameterAction(
                parameter=ParameterName.CORRELATION,
                target=("A", "B"),
                value=-0.2,
                mode=MutationMode.SET,
            ),
        ))
        rewards = info["transition_rewards"]
        self.assertAlmostEqual(rewards["blue"]["reward"], -rewards["red"]["reward"])

    def test_move_budget_rejects_extra_turn_without_mutating_graph(self):
        graph = _graph()
        team = TeamDefinition(
            team_id="blue", name="Blue", role="team:blue",
            target=TargetSpecification(behaviors={"A": "Optimal"}),
            move_budget=1,
        )
        policy = RoleBasedAuthorizationPolicy((RoleDefinition(
            name="team:blue",
            node_parameters=frozenset({ParameterName.START_AMOUNT}),
            node_targets=frozenset({"A"}),
        ),))
        environment = MultiTeamEnvironment(
            graph,
            teams=(team,),
            authorization_policy=policy,
            observation_builder=SimulationObservationBuilder(horizon=2),
            max_steps=2,
        )
        environment.reset(seed=4)
        action = ParameterAction(
            parameter=ParameterName.START_AMOUNT,
            target="A",
            value=2.0,
            mode=MutationMode.SET,
        )
        environment.step(TeamMove(team_id="blue", action=action))
        _, _, _, _, info = environment.step(TeamMove(team_id="blue", action=action))
        self.assertFalse(info["move"]["accepted"])
        self.assertIn("move budget", info["move"]["reason"])


if __name__ == "__main__":
    unittest.main()
