"""A proof-only agent with durable, per-call traces and kernel feedback."""
from __future__ import annotations

from collections import Counter
from dataclasses import asdict
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import signal
import tempfile
import time

from .assemble import assemble, target_name
from .budget import Budget, BudgetStop
from .classify import classify
from .kernel import check, proved
from .llm import Anthropic, Completion, Fake, OpenAICompatible, Provider
from .scanner import scan
from .schema import Result, Task

SYSTEM_PROMPT = """Prove the supplied canonical Isabelle lemma using its existing imports.
Write readable structured Isar: named have steps with one-line by justifications.
Prefer a flat chain; use nested proof/qed only when fix/assume is needed.
Prefer simp or rule over auto when they express the mathematics.
try0 is allowed. Never use sledgehammer or nitpick. No new imports.
Never use sorry, oops, axioms, ML, setup, declarations or proof-skipping tricks.
Do not change or repeat the target statement.
Respond only with <proof>proof text</proof>, optionally preceded by
<aux>proved auxiliary lemmas</aux>. Auxiliary lemmas cannot reuse the target name.
Only the Isabelle kernel determines whether a proof succeeds."""


def atomic_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    with temporary.open("w") as out:
        json.dump(data, out, ensure_ascii=False, indent=2)
        out.write("\n")
        out.flush()
        os.fsync(out.fileno())
    temporary.replace(path)


def extract_blocks(text: str) -> tuple[str, str]:
    match = re.fullmatch(r"\s*(?:<aux>(.*?)</aux>\s*)?<proof>(.*?)</proof>\s*", text, re.S)
    if not match or "<proof>" in match[2] or "</proof>" in match[2]:
        raise ValueError("Expected exactly one <proof> block and optional preceding <aux>")
    return match[2].strip(), (match[1] or "").strip()


def feedback(error: str) -> str:
    return "\n".join(error.splitlines()[:40])[:3000]


def assess(task: Task, proof: str, aux: str, run_id: str, ordinal: int,
           root: Path, timeout_s: float, keep_work: bool = False) -> dict:
    outcome = {"proof_text": proof, "aux_lemmas": aux, "proved": False,
               "failure_class": None, "error": "", "kernel_wall_s": 0.}
    reasons = scan(proof, aux, target_name(task.statement))
    if reasons:
        return {**outcome, "failure_class": "cheat_rejected", "error": "\n".join(reasons)}
    work_root = root / run_id / "work"
    work_root.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="attempt_", dir=work_root))
    try:
        theory = assemble(task.statement, task.imports, proof, aux, lemma_id=task.id,
                          run_id=run_id, attempt=ordinal)
        result = check(theory, directory, timeout_s)
        accepted = proved(result, theory, task.statement, proof, aux, target_name(task.statement))
        return {**outcome, "proved": accepted,
                "failure_class": None if accepted else classify(result),
                "error": "\n".join(e.message for e in result.errors) or
                         (result.stderr if not accepted else ""),
                "kernel_wall_s": result.wall_s, "kernel": asdict(result)}
    finally:
        if not keep_work:
            shutil.rmtree(directory)


def method_counts(text: str) -> dict[str, int]:
    from eval.corpus.build_corpus import lex
    names = "simp auto blast metis fastforce force arith linarith induction try0".split()
    try:
        counts = Counter(t.value for t in lex(text))
    except ValueError:
        counts = Counter()
    result = {name: counts[name] for name in names}
    result["induction"] += counts["induct"]
    # Other counts explicit by invocations with an unlisted first method.
    result["other"] = sum(m not in names + ["induct"] for m in
                          re.findall(r"\bby\s+\(?\s*([A-Za-z_][\w']*)", text))
    return result


def summarize(task: Task, condition: dict, run_id: str, records: list[dict],
              metadata: dict) -> dict:
    last = records[-1]["result"]
    completions = [r.get("completion", {}) for r in records]
    ids = [c["model_id"] for c in completions if c.get("model_id")]
    failures = Counter(r["result"]["failure_class"] for r in records if not r["result"]["proved"])
    row = Result(
        run_id, task.id, task.stratum,
        {"model": condition["model"], "max_attempts": condition["max_attempts"]},
        last["proved"], len(records), last["failure_class"], last["error"][:500],
        last["proof_text"], len(last["proof_text"].splitlines()),
        method_counts(last["proof_text"] + "\n" + last["aux_lemmas"]),
        last["aux_lemmas"], sum(c.get("prompt_tokens", 0) for c in completions),
        sum(c.get("completion_tokens", 0) for c in completions),
        sum(r.get("usd_cost", 0.) for r in records), sum(c.get("wall_s", 0.) for c in completions),
        sum(r["result"]["kernel_wall_s"] for r in records), ids[-1] if ids else None,
        metadata["isabelle_version"], metadata["git_sha"], datetime.now(timezone.utc).isoformat(),
        task.orig_proof_lines, dict(failures), sorted(set(ids)),
        any(r.get("cost_is_upper_bound", False) for r in records), condition["provider"])
    return row.to_dict()


def provider_for(condition: dict, config: dict, task: Task, timeout: float) -> Provider:
    if condition["provider"] == "fake":
        return Fake.from_corpus(condition.get("policy", "simp"), config["corpus"], task.id)
    cls = {"openai_compatible": OpenAICompatible, "anthropic": Anthropic}[condition["provider"]]
    return cls(max_tokens=config.get("max_completion_tokens", 2048), timeout_s=timeout,
               supports_temperature=condition.get("supports_temperature", True),
               token_parameter=condition.get("token_parameter", "max_completion_tokens"))


def deadline_expired(signum: int, frame: object) -> None:
    raise TimeoutError("LLM wall-clock deadline reached")


def run_task(task: Task, condition: dict, config: dict, metadata: dict,
             offset: int, root: Path, keep_work: bool = False) -> dict | None:
    run_id = config["run_id"]
    budget = Budget(root / run_id / "budget.sqlite", config["max_usd"], config.get("max_hours", 8))
    messages = [{"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"imports {' '.join(task.imports)}\n\n{task.statement}"}]
    records = []
    rates = config.get("cost_usd_per_m", {}).get(condition["model"], {"prompt": 0, "completion": 0})
    for attempt in range(1, condition["max_attempts"] + 1):
        ordinal = offset + attempt
        path = root / "traces" / run_id / task.id / f"attempt_{ordinal}.json"
        if path.exists():
            record = json.loads(path.read_text())
            if "completion" not in record:
                raise BudgetStop(f"Interrupted call without a response: {path}; no automatic retry")
        else:
            max_tokens = config.get("max_completion_tokens", 2048)
            # Byte-level upper bound plus generous message framing allowance.
            input_bound = len(json.dumps(messages, ensure_ascii=False).encode()) + 4096
            upper_bound = (input_bound * rates["prompt"] + max_tokens * rates["completion"]) / 1e6
            budget.reserve(str(path), upper_bound)
            record = {"run_id": run_id, "lemma_id": task.id, "condition": condition,
                      "attempt": attempt, "trace_ordinal": ordinal, "messages": list(messages),
                      "requested_model": condition["model"], "reserved_usd": upper_bound,
                      **metadata}
            atomic_json(path, record)  # Write before the call, even if the process dies.
            timeout = min(config.get("provider_timeout_s", 120), budget.remaining_s())
            provider = provider_for(condition, config, task, max(.001, timeout))
            old_handler = signal.signal(signal.SIGALRM, deadline_expired)
            signal.setitimer(signal.ITIMER_REAL, max(.001, timeout))
            started = time.monotonic()
            try:
                completion = provider.complete(messages, condition["model"])
            except Exception as exc:
                completion = Completion("", 0, 0, None, time.monotonic() - started,
                                        error=type(exc).__name__, usage_known=False)
            finally:
                signal.setitimer(signal.ITIMER_REAL, 0)
                signal.signal(signal.SIGALRM, old_handler)
            record["completion"] = asdict(completion)
            record["cost_is_upper_bound"] = not completion.usage_known
            record["usd_cost"] = ((completion.prompt_tokens * rates["prompt"]
                                   + completion.completion_tokens * rates["completion"]) / 1e6
                                  if completion.usage_known else upper_bound)
            atomic_json(path, record)  # Full raw response before parsing or checking.
            budget.settle(str(path), record["usd_cost"])
        completion = Completion(**record["completion"])
        # Idempotent reconciliation covers crashes between trace write and settlement.
        budget.settle(str(path), record["usd_cost"])
        if "result" not in record:
            if completion.error:
                outcome = {"proved": False, "failure_class": "provider_error",
                           "error": completion.error, "proof_text": "", "aux_lemmas": "", "kernel_wall_s": 0.}
            else:
                try:
                    proof, aux = extract_blocks(completion.text)
                except ValueError as exc:
                    outcome = {"proved": False, "failure_class": "parse_error", "error": str(exc),
                               "proof_text": "", "aux_lemmas": "", "kernel_wall_s": 0.}
                else:
                    remaining = budget.remaining_s()
                    if remaining <= 0:
                        raise BudgetStop("wall-clock limit before kernel check")
                    outcome = assess(task, proof, aux, run_id, ordinal, root,
                                     min(config["kernel_timeout_s"], remaining), keep_work)
            record["result"] = outcome
            atomic_json(path, record)
        records.append(record)
        if record["result"]["proved"]:
            break
        # Previous response includes the proof and any auxiliary lemmas verbatim.
        messages += [{"role": "assistant", "content": completion.text},
                     {"role": "user", "content": "Kernel/checker feedback:\n" +
                      feedback(record["result"]["error"])}]
    return summarize(task, condition, run_id, records, metadata)
