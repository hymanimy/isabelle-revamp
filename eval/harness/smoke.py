"""Ten-lemma smoke, conservative projection, and the prescribed shrinking order."""
from __future__ import annotations

import argparse
from collections import Counter
import copy
import json
from pathlib import Path
import random
import statistics
import sys

from .agent import atomic_json
from .budget import Budget
from .runner import load_tasks, read_rows, run


def make_smoke(full: dict) -> dict:
    config = copy.deepcopy(full)
    config["run_id"] = full.get("smoke_run_id", "smoke")
    seen = set()
    conditions = []
    for condition in full["conditions"]:
        if condition["model"] not in seen:
            seen.add(condition["model"])
            conditions.append({**condition, "max_attempts": 1})
    config["conditions"] = conditions
    config["prior_usd_cost"] = sum(
        value for name, value in full.get("prior_run_costs", {}).items()
        if name != config["run_id"])
    rng = random.Random(20251020)
    tasks = load_tasks(full)
    ids = []
    for stratum in ("lib", "fresh"):
        candidates = sorted(t.id for t in tasks if t.stratum == stratum)
        if len(candidates) < 5:
            raise ValueError(f"Smoke needs five {stratum} lemmas")
        ids.extend(rng.sample(candidates, 5))
    config["lemma_ids"] = ids
    return config


def sample_statistics(rows: list[dict]) -> dict[str, dict]:
    result = {}
    for model in sorted({r["condition"]["model"] for r in rows}):
        group = [r for r in rows if r["condition"]["model"] == model]
        # Do not let authentication failures make a functioning provider look cheap.
        usable = [r for r in group if r["failure_class"] != "provider_error"]
        if usable:
            result[model] = {
                "prompt": statistics.mean(r["prompt_tokens"] for r in usable),
                "completion": statistics.mean(r["completion_tokens"] for r in usable),
                "llm_s": statistics.mean(r["llm_wall_s"] for r in usable)}
    return result


def project(config: dict, counts: dict[str, int], samples: dict[str, dict],
            kernel_median_s: float) -> dict:
    n = min(counts.get("lib", 0), config.get("lib_limit", counts.get("lib", 0)))
    n += sum(value for name, value in counts.items() if name != "lib")
    cost, kernel_s, llm_s = 0., 0., 0.
    details = []
    for condition in config["conditions"]:
        model, k = condition["model"], condition["max_attempts"]
        if model not in samples:
            raise ValueError(f"No usable smoke measurements for {model}")
        sample, rate = samples[model], config["cost_usd_per_m"][model]
        # Worst-case attempt counts, plus explicit retry-context growth allowance.
        prompt = sample["prompt"]*k + (sample["completion"] + 3000)*k*(k-1)/2
        output = sample["completion"]*k
        amount = n * (prompt*rate["prompt"] + output*rate["completion"]) / 1e6
        cost += amount
        kernel_s += n*k*kernel_median_s
        llm_s += n*k*sample["llm_s"]
        details.append({"model": model, "max_attempts": k, "lemmas": n, "usd": amount})
    prior = config.get("prior_usd_cost", 0)
    return {"conditions": details, "lemmas": n, "prior_usd_cost": prior,
            "projected_llm_usd": cost, "projected_total_usd": prior+cost,
            "kernel_hours": kernel_s/config["workers"]/3600,
            "projected_hours": 1.25*(kernel_s+llm_s)/config["workers"]/3600}


def shrink(config: dict, counts: dict[str, int], samples: dict[str, dict],
           median_s: float) -> tuple[dict, dict, list[str]]:
    config = copy.deepcopy(config)
    dropped = []
    def fits() -> bool:
        estimate = project(config, counts, samples, median_s)
        return (estimate["projected_total_usd"] <= config["max_usd"]
                and estimate["projected_hours"] <= config["max_hours"])
    if not fits():
        removed = [c for c in config["conditions"] if c["max_attempts"] == 4]
        config["conditions"] = [c for c in config["conditions"] if c["max_attempts"] != 4]
        if removed:
            dropped.append("Dropped all max_attempts=4 conditions")
    models = list(dict.fromkeys(c["model"] for c in config["conditions"]))
    while not fits() and len(models) > 1:
        model = models.pop(0)
        config["conditions"] = [c for c in config["conditions"] if c["model"] != model]
        dropped.append(f"Dropped model in config order: {model}")
    if not fits() and counts.get("lib", 0) > 150:
        config["lib_limit"] = min(config.get("lib_limit", counts["lib"]), 150)
        dropped.append("Subsampled lib to 150 sorted lemma ids")
    if not fits():
        dropped.append("No remaining condition fits; dropped the final model")
        config["conditions"] = []
    return config, project(config, counts, samples, median_s), dropped


def prepare_and_gate(path: Path) -> tuple[dict, bool]:
    full = json.loads(path.read_text())
    observations = json.loads(Path("eval/results/m0/observations.json").read_text())
    median = observations["trivial_median_s"]
    smoke = make_smoke(full)
    atomic_json(Path("eval/configs/smoke.json"), smoke)
    directory = Path("eval/results") / smoke["run_id"]
    directory.mkdir(parents=True, exist_ok=True)
    errors, status = [], None
    # A failed check is bounded to three attempts; no unattended question waits.
    for attempt in range(1, 4):
        try:
            if not smoke["conditions"]:
                raise ValueError("No configured models for the real-provider smoke run")
            status = run(smoke)
            if status["status"] != "complete" or status["completed"] != status["planned"]:
                raise RuntimeError("Smoke incomplete: " + status["status"])
            break
        except Exception as exc:
            message = f"check {attempt}: {type(exc).__name__}: {exc}"
            errors.append(message)
            atomic_json(directory / f"check_{attempt}.json", {"error": message})
            print(message, file=sys.stderr)
    rows = read_rows(directory / "results.jsonl")
    prior_runs = dict(full.get("prior_run_costs", {}))
    ledger = directory / "budget.sqlite"
    if ledger.exists():
        prior_runs[smoke["run_id"]] = Budget(ledger, smoke["max_usd"], smoke["max_hours"]).total()
    full["prior_run_costs"] = prior_runs
    full["prior_usd_cost"] = sum(prior_runs.values())
    dropped = []
    for model in dict.fromkeys(c["model"] for c in full["conditions"]):
        group = [r for r in rows if r["condition"]["model"] == model]
        if len(group) == 10 and all(r["failure_class"] == "provider_error" for r in group):
            full["conditions"] = [c for c in full["conditions"] if c["model"] != model]
            dropped.append(f"Dropped {model}: provider_error on all 10 smoke lemmas")
    counts = dict(Counter(t.stratum for t in load_tasks(full)))
    samples = sample_statistics(rows)
    checked = status is not None and status["status"] == "complete"
    before = project(full, counts, samples, median) if not full["conditions"] or checked else None
    if before is not None:
        full, projection, shrinking = shrink(full, counts, samples, median)
        dropped += shrinking
    else:
        projection = None
    usable = checked and bool(full["conditions"]) and projection is not None
    if usable:
        usable = (projection["projected_total_usd"] <= full["max_usd"]
                  and projection["projected_hours"] <= full["max_hours"])
    atomic_json(path, full)
    decision = {"smoke_complete": checked, "proceed_to_full": usable, "errors": errors,
                "dropped": dropped, "before_shrinking": before, "projection": projection,
                "max_usd": full["max_usd"], "max_hours": full["max_hours"],
                "kernel_median_s": median, "samples": samples}
    atomic_json(directory / "projection.json", decision)
    notes = Path("docs/EVAL_NOTES.md")
    with notes.open("a") as out:
        out.write("\n## M5: smoke checks and budget gate\n\n")
        out.write("- **What happened.** " + ("Smoke completed." if checked else
                  "Smoke acceptance failed three consecutive checks; no real-model smoke was established.") + "\n")
        out.write("- **Experience.** Missing models/credentials are unavailable measurements, not failed proofs or zero-cost model evidence.\n")
        out.write("- **Fix / action.** " + ("Proceed to M6 automatically within the fixed limits." if usable else
                  "Stop the real-model phase and produce the required partial report from existing data.") + "\n\n")
        out.write("Projection uses all allowed attempts, smoke mean token/latency measurements, "
                  "3000 additional feedback tokens per retry plus preceding completions, "
                  "and a 25% wall-time margin. Kernel hours use the M0 median × attempts / workers. "
                  "An empty schedule projects zero scheduled work; it is not a model estimate.\n\n")
        out.write("```json\n" + json.dumps(decision, indent=2) + "\n```\n")
    return full, usable


def run_full_with_restarts(config: dict) -> dict:
    failures = []
    for restart in range(4):  # Initial execution plus at most three restarts.
        try:
            return run(config)
        except Exception as exc:
            message = f"Full run restart {restart}: {type(exc).__name__}: {exc}"
            failures.append(message)
            print(message, file=sys.stderr)
            if restart == 3:
                with Path("docs/EVAL_NOTES.md").open("a") as out:
                    out.write("\n## M6: exhausted process restarts\n\n"
                              "- **What happened.** The initial process and three restarts failed.\n"
                              "- **Experience.** Some rows may be incomplete.\n"
                              "- **Fix / action.** Retain all receipts and generate the partial report.\n\n"
                              + "```text\n" + "\n".join(failures) + "\n```\n")
                raise
    raise AssertionError("Unreachable")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="eval/configs/full.json")
    parser.add_argument("--run-full", action="store_true")
    args = parser.parse_args()
    config, usable = prepare_and_gate(Path(args.config))
    if args.run_full:
        from .report import generate, prepare_partial
        directory = Path("eval/results") / config["run_id"]
        try:
            if usable:
                run_full_with_restarts(config)
        finally:
            prepare_partial(directory, config, "real_models_unavailable")
            (directory / "summary.md").write_text(generate(directory))
    if not usable:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
