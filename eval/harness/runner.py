"""Bounded process-pool orchestration. Only the parent appends result rows."""
from __future__ import annotations

import argparse
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait
from dataclasses import asdict
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess

from .agent import atomic_json, run_task
from .budget import Budget, BudgetStop, available_usd
from .schema import Result, Task, key


def load_tasks(config: dict) -> list[Task]:
    tasks = [Task.from_row(json.loads(line)) for path in config["corpus"]
             for line in Path(path).read_text().splitlines() if line.strip()]
    if "lemma_ids" in config:
        wanted = set(config["lemma_ids"])
        tasks = [t for t in tasks if t.id in wanted]
        if {t.id for t in tasks} != wanted:
            raise ValueError("Unknown configured lemma id")
    if "lib_limit" in config:
        lib = sorted((t for t in tasks if t.stratum == "lib"), key=lambda t: t.id)
        keep = {t.id for t in lib[:config["lib_limit"]]}
        tasks = [t for t in tasks if t.stratum != "lib" or t.id in keep]
    if len({t.id for t in tasks}) != len(tasks):
        raise ValueError("Duplicate lemma ids")
    for t in tasks:
        if not re.fullmatch(r"[A-Za-z0-9_./'-]+", t.id) or ".." in Path(t.id).parts or t.id.startswith("/"):
            raise ValueError("Unsafe lemma id")
    return tasks


def read_rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text().splitlines():
        if line.strip():
            row = json.loads(line)
            Result(**row).validate()
            rows.append(row)
    if len({key(r) for r in rows}) != len(rows):
        raise ValueError("Duplicate result keys")
    return rows


def validate_config(config: dict) -> None:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", config["run_id"]):
        raise ValueError("Unsafe run id")
    for name in ("max_usd", "max_hours"):
        value = config.get(name, 8 if name == "max_hours" else -1)
        if not math.isfinite(value) or value < 0:
            raise ValueError(f"Invalid {name}")
    if config["workers"] < 1 or config["kernel_timeout_s"] <= 0:
        raise ValueError("Workers and kernel timeout must be positive")
    prior = config.get("prior_usd_cost", 0)
    if not math.isfinite(prior) or not 0 <= prior <= config["max_usd"]:
        raise ValueError("Prior smoke spending exceeds the fixed ceiling")
    seen = set()
    for condition in config["conditions"]:
        identity = (condition["model"], condition["max_attempts"])
        if identity in seen or condition["max_attempts"] < 1:
            raise ValueError("Duplicate or invalid condition")
        seen.add(identity)
        if condition["provider"] not in {"fake", "tactics", "openai_compatible", "anthropic"}:
            raise ValueError("Unknown provider")
        if condition["provider"] not in {"fake", "tactics"}:
            rates = config["cost_usd_per_m"][condition["model"]]
            if any(not math.isfinite(rates[k]) or rates[k] < 0 for k in ("prompt", "completion")):
                raise ValueError("Missing/invalid explicit model pricing")


def execute(task: Task, condition: dict, config: dict, metadata: dict,
            offset: int, root: Path, keep_work: bool) -> dict | None:
    try:
        if condition["provider"] == "tactics":
            from .tactics import run_tactics
            return run_tactics(task, condition, config, metadata, offset, root, keep_work)
        return run_task(task, condition, config, metadata, offset, root, keep_work)
    except BudgetStop as exc:
        atomic_json(root / config["run_id"] / "stopped" / task.id / f"condition_{offset}.json",
                    {"reason": str(exc), "condition": condition})
        return None


def run(config: dict, root: Path = Path("eval/results"), keep_work: bool = False) -> dict:
    validate_config(config)
    tasks = load_tasks(config)
    directory = root / config["run_id"]
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "run.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        metadata = {
            "isabelle_version": subprocess.check_output(["isabelle", "version"], text=True).strip(),
            "git_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()}
        fingerprint = hashlib.sha256(json.dumps(
            [config, [asdict(t) for t in tasks]], sort_keys=True).encode()).hexdigest()
        manifest_path = directory / "manifest.json"
        if manifest_path.exists():
            if json.loads(manifest_path.read_text())["fingerprint"] != fingerprint:
                raise ValueError("Config/corpus changed; use a new run_id")
        else:
            atomic_json(manifest_path, {"config": config, "fingerprint": fingerprint,
                                       "tasks": [asdict(t) for t in tasks], **metadata})
        path = directory / "results.jsonl"
        # Preserve an incomplete append, then recover only the unterminated tail.
        if path.exists() and path.read_bytes() and not path.read_bytes().endswith(b"\n"):
            data = path.read_bytes()
            tail = data.rsplit(b"\n", 1)[-1]
            (directory / "interrupted_tail.json").write_bytes(tail)
            path.write_bytes(data[:len(data)-len(tail)])
        rows = read_rows(path)
        if rows and not (directory / "budget.sqlite").exists():
            raise ValueError("Spend ledger missing for existing rows; refusing a fresh budget")
        completed = {key(r) for r in rows}
        jobs, offset = [], 0
        for condition in config["conditions"]:
            for task in tasks:
                identity = (config["run_id"], task.id, condition["model"], condition["max_attempts"])
                if identity not in completed:
                    jobs.append((task, condition, config, metadata, offset, root, keep_work))
            offset += condition["max_attempts"]
        budget = Budget(directory / "budget.sqlite", available_usd(config), config.get("max_hours", 8))
        atomic_json(directory / "status.json", {
            "status": "running", "written": 0, "completed": len(rows),
            "planned": len(tasks)*len(config["conditions"]),
            "usd_reserved_or_spent": config.get("prior_usd_cost", 0) + budget.total(), **metadata})
        pending, iterator, written, stopped = {}, iter(jobs), 0, False
        with ProcessPoolExecutor(max_workers=config["workers"]) as pool, path.open("a") as out:
            def submit_one() -> bool:
                nonlocal stopped
                if budget.remaining_s() <= 0:
                    stopped = True
                    return False
                job = next(iterator, None)
                if job is None:
                    return False
                pending[pool.submit(execute, *job)] = job[0].id
                return True
            for _ in range(config["workers"]):
                if not submit_one():
                    break
            while pending:
                ready, _ = wait(pending, return_when=FIRST_COMPLETED)
                for future in ready:
                    pending.pop(future)
                    row = future.result()
                    if row is None:
                        stopped = True
                    else:
                        out.write(json.dumps(row, ensure_ascii=False) + "\n")
                        out.flush()
                        os.fsync(out.fileno())
                        written += 1
                        print(row["lemma_id"], json.dumps(row["condition"], separators=(",", ":")),
                              row["proved"], row["attempts_used"], row["failure_class"],
                              f'{row["usd_cost"]:.6f}', flush=True)
                    if not stopped:
                        submit_one()
        status = {"status": "no_conditions" if not config["conditions"] else
                  "budget_or_interrupted_call" if stopped else "complete",
                  "written": written, "completed": len(rows) + written,
                  "planned": len(tasks)*len(config["conditions"]),
                  "usd_reserved_or_spent": config.get("prior_usd_cost", 0) + budget.total(),
                  **metadata}
        atomic_json(directory / "status.json", status)
        return status


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config")
    parser.add_argument("--keep-work", action="store_true")
    args = parser.parse_args()
    status = run(json.loads(Path(args.config).read_text()), keep_work=args.keep_work)
    if status["status"] == "no_conditions":
        raise SystemExit(2)


if __name__ == "__main__":
    main()
