"""Stage 5 frozen-policy league and exploitability tests."""

import unittest

import networkx as nx

try:
    from flowcld_env import (
        GreedyAgent,
        LeagueEvaluationHarness,
        NoOpAction,
        NoOpAgent,
        ParameterAction,
        ParameterName,
        PolicyProfile,
        TargetSpecification,
        TeamDefinition,
        TeamMove,
    )
except ModuleNotFoundError:
    from backend.flowcld_env import (
        GreedyAgent,
        LeagueEvaluationHarness,
        NoOpAction,
        NoOpAgent,
        ParameterAction,
        ParameterName,
        PolicyProfile,
        TargetSpecification,
        TeamDefinition,
        TeamMove,
    )


class _LeagueEnvironment:
    def __init__(self):
        self._graph = nx.DiGraph()
        self._graph.add_node("A", start_amount=0.0, retention=0.5)
        self._step = 0
        self.teams = tuple(
            TeamDefinition(
                team_id=team_id,
                name=team_id.title(),
                role=f"team:{team_id}",
                target=TargetSpecification(),
                move_budget=10,
            )
            for team_id in ("blue", "red")
        )

    @property
    def graph_snapshot(self):
        return self._graph.copy()

    def reset(self, *, seed=None):
        self._step = 0
        return {}, {"seed": seed}

    def legal_parameter_moves(self, team_id):
        if self._step >= 4:
            return ()
        return (
            NoOpAction(),
            ParameterAction(ParameterName.START_AMOUNT, "A", 1.0),
        )

    def select_move(self, team_id, policy):
        team = next(item for item in self.teams if item.team_id == team_id)
        legal = self.legal_parameter_moves(team_id)
        action = policy.select_move(
            self.graph_snapshot,
            team.as_objective(),
            legal,
            lambda move: 1.0 if isinstance(move, ParameterAction) else 0.0,
        )
        return TeamMove(team_id, action)

    def step(self, move):
        self._step += 1
        active = isinstance(move.action, ParameterAction)
        rewards = {
            team.team_id: {
                "reward": 1.0 if active and team.team_id == move.team_id else 0.0,
                "components": {},
            }
            for team in self.teams
        }
        return {}, 0.0, False, self._step >= 4, {"transition_rewards": rewards}


class LeagueEvaluationTests(unittest.TestCase):
    def test_unilateral_deviation_gain_produces_nash_conv_proxy(self):
        hold = PolicyProfile(
            name="hold",
            agent_factories={
                "blue": lambda seed: NoOpAgent(),
                "red": lambda seed: NoOpAgent(),
            },
        )
        result = LeagueEvaluationHarness(
            _LeagueEnvironment, seeds=(1, 2), rounds=2
        ).run(
            (hold,),
            baseline_profile="hold",
            unilateral_deviations={"blue": lambda seed: GreedyAgent()},
        )

        self.assertEqual(result.profiles["hold"].team_mean_returns["blue"], 0.0)
        self.assertEqual(result.exploitability.deviation_gains["blue"], 2.0)
        self.assertEqual(result.exploitability.nash_conv_proxy, 2.0)


if __name__ == "__main__":
    unittest.main()
