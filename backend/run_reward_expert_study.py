"""Command-line workflow for the blinded FlowCLD expert reward study."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from flowcld_env.expert_study import (
    DEFAULT_STUDY_SEED,
    analyze_rankings,
    generate_expert_study,
    validate_ranking_file,
)
from flowcld_env.reward_validation import RewardValidationThresholds


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate and analyze blinded FlowCLD expert rankings."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    generate = subparsers.add_parser("generate", help="Generate a blinded review packet")
    generate.add_argument("--output", type=Path, required=True)
    generate.add_argument("--seed", type=int, default=DEFAULT_STUDY_SEED)
    generate.add_argument("--horizon", type=int, default=40)

    validate = subparsers.add_parser("validate", help="Validate completed ranking CSV")
    validate.add_argument("--study", type=Path, required=True)
    validate.add_argument("--rankings", type=Path, required=True)

    analyze = subparsers.add_parser("analyze", help="Produce JSON and Markdown analysis")
    analyze.add_argument("--study", type=Path, required=True)
    analyze.add_argument("--rankings", type=Path, required=True)
    analyze.add_argument("--output", type=Path, required=True)
    analyze.add_argument("--minimum-spearman", type=float, default=0.6)
    analyze.add_argument("--minimum-pairwise", type=float, default=0.7)
    analyze.add_argument("--minimum-outcomes", type=int, default=4)

    arguments = parser.parse_args()
    if arguments.command == "generate":
        result = generate_expert_study(
            arguments.output, seed=arguments.seed, horizon=arguments.horizon
        )
    elif arguments.command == "validate":
        records = validate_ranking_file(arguments.study, arguments.rankings)
        result = {
            "valid": True,
            "record_count": len(records),
            "expert_count": len({record.expert_id for record in records}),
        }
    else:
        result = analyze_rankings(
            arguments.study,
            arguments.rankings,
            arguments.output,
            thresholds=RewardValidationThresholds(
                arguments.minimum_spearman,
                arguments.minimum_pairwise,
                arguments.minimum_outcomes,
            ),
        )
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
