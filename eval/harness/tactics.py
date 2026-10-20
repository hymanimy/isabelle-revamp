"""The fixed, ordered no-LLM tactic battery."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .agent import assess, atomic_json, summarize
from .budget import Budget, BudgetStop
from .schema import Task

TACTICS = ["by simp", "by auto", "by blast", "by fastforce", "by force",
           "by linarith", "by arith", "by (simp add: algebra_simps)"]


def run_tactics(task: Task, condition: dict, config: dict, metadata: dict,
                offset: int, root: Path, keep_work: bool = False) -> dict:
    if condition["max_attempts"] != 8:
        raise ValueError("The tactic baseline is exactly eight ordered methods")
    budget = Budget(root / config["run_id"] / "budget.sqlite", 0, config.get("max_hours", 8))
    records = []
    for attempt, proof in enumerate(TACTICS, 1):
        path = root / config["run_id"] / "kernel_attempts" / task.id / f"attempt_{attempt}.json"
        if path.exists():
            record = json.loads(path.read_text())
        else:
            remaining = budget.remaining_s()
            if remaining <= 0:
                raise BudgetStop("tactic run wall-clock limit")
            outcome = assess(task, proof, "", config["run_id"], offset+attempt,
                             root, min(30, remaining), keep_work)
            record = {"result": outcome, "tactic": proof, "attempt": attempt,
                      "usd_cost": 0, **metadata}
            atomic_json(path, record)
        records.append(record)
        if record["result"]["proved"]:
            break
    return summarize(task, condition, config["run_id"], records, metadata)


def update_corpus(paths: list[str], rows: list[dict]) -> None:
    outcomes = {r["lemma_id"]: r["proved"] for r in rows
                if r["condition"] == {"model": "tactics", "max_attempts": 8}}
    for path_string in paths:
        path = Path(path_string)
        corpus = [json.loads(line) for line in path.read_text().splitlines()]
        for row in corpus:
            row["tactic_baseline_proved"] = outcomes.get(row["id"])
        temporary = path.with_suffix(".tmp")
        temporary.write_text("".join(json.dumps(row, ensure_ascii=False)+"\n" for row in corpus))
        temporary.replace(path)


def main() -> None:
    from .runner import read_rows, run
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="eval/configs/tactics.json")
    parser.add_argument("--keep-work", action="store_true")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    status = run(config, keep_work=args.keep_work)
    rows = read_rows(Path("eval/results") / config["run_id"] / "results.jsonl")
    update_corpus(config["corpus"], rows)
    if status["completed"] != status["planned"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
