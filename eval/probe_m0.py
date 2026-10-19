"""Reproduce M0 observations without modifying source theories or Isabelle."""
from __future__ import annotations

import json
import os
from pathlib import Path
import signal
import statistics
import subprocess
import time


def run(args: list[str], timeout: float = 120) -> dict:
    start = time.monotonic()
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, start_new_session=True)
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        out, err = proc.communicate()
        err += "\nPROBE TIMEOUT\n"
    return {"command": args, "exit_code": proc.returncode, "stdout": out,
            "stderr": err, "wall_s": time.monotonic() - start}


def main() -> None:
    work = Path("eval/results/m0/work")
    work.mkdir(parents=True, exist_ok=True)
    fixtures = Path("eval/tests/fixtures")
    fixtures.mkdir(parents=True, exist_ok=True)
    records = []
    for theory, options in [("Swarm_solution", []), ("Swarm", []),
                            ("Swarm", ["-o", "quick_and_dirty=false"]),
                            ("Swarm", ["-o", "quick_and_dirty=true"])]:
        record = run(["isabelle", "process_theories", "-D", "examples", "-O",
                      *options, theory])
        records.append(record)
        print(theory, options, record["exit_code"], round(record["wall_s"], 2), flush=True)
    cases = {"syntax_error": 'lemma probe: "True" by (',
             "unknown_fact": 'lemma probe: "True" by (rule nonexistent_eval_fact_3819)',
             "method_failed": 'lemma probe: "(x::nat) = y" by simp',
             "trivial": 'lemma probe: "True" by simp'}
    times = []
    for kind, body in cases.items():
        name = "E_" + kind
        source = f"theory {name}\nimports Main\nbegin\n{body}\nend\n"
        (work / f"{name}.thy").write_text(source)
        for _ in range(5 if kind == "trivial" else 1):
            record = run(["isabelle", "process_theories", "-D", str(work), "-O", name])
            records.append(record)
            print(kind, record["exit_code"], round(record["wall_s"], 2), flush=True)
            if kind == "trivial":
                assert record["exit_code"] == 0, record
                times.append(record["wall_s"])
            else:
                assert record["exit_code"] != 0, record
                (fixtures / f"{kind}.json").write_text(json.dumps(
                    {**record, "theory_text": source}, indent=2) + "\n")
    median = statistics.median(times)
    (Path("eval/results/m0") / "observations.json").write_text(
        json.dumps({"records": records, "trivial_median_s": median}, indent=2) + "\n")
    with Path("docs/EVAL_NOTES.md").open("a") as out:
        out.write("\n## M0: command transcripts\n\n")
        for r in records:
            out.write("```text\n$ " + " ".join(r["command"]) + "\n")
            out.write(r["stdout"] + r["stderr"])
            out.write(f'\nexit: {r["exit_code"]}; wall_s: {r["wall_s"]:.3f}\n```\n\n')
        out.write(f"Trivial-check median (five sequential runs): **{median:.3f} s**.\n")
    print("median", median, flush=True)


if __name__ == "__main__":
    main()
