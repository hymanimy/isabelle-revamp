"""Generate the method/results skeleton; preserve human interpretation separately."""
from __future__ import annotations

import argparse
from pathlib import Path

from .agent import SYSTEM_PROMPT
from .report import report_directory

BEGIN = "<!-- BEGIN GENERATED SUMMARY -->"
END = "<!-- END GENERATED SUMMARY -->"


def generate(summary: str) -> str:
    body = summary.partition("\n\n")[2]
    partial = "No completed real-model observations." in summary
    status = (
        "The current measurements are the completed no-LLM tactic baseline. "
        "The real-model smoke and full phases were unavailable because models "
        "and provider credentials were not configured. No real-model performance "
        "or value over tactics is claimed."
        if partial else
        "The completed observations and coverage are shown in the generated "
        "tables below. Incomplete coverage must not be interpreted as a "
        "full-corpus success rate."
    )
    return f"""# Headless proof evaluation — write-up skeleton

## Abstract

TODO(Leo)

## Research question

TODO(Leo)

The operational question is how often proposed proof text passes the Isabelle
kernel under a fixed statement and import context. A model's assertion that it
has proved something is never a success criterion.

## Measurement status

{status}
No contamination-free generalization result is claimed. Fake providers are
test fixtures and are excluded from the tables.

## Corpus and contamination

`lib` comes from the installed Isabelle distribution. The builder walks HOL and
Library source theories, extracts named top-level lemma/theorem/corollary
declarations outside local blocks, strips name attributes, and retains
source-file/line provenance. It validates the statement with an admission in
explicit quick-and-dirty mode, then validates the original proof with that mode
disabled. Source selection is sorted and seeded, with a per-source cap.
Existing complete corpus snapshots are retained on ordinary revalidation;
`--rebuild` explicitly changes the dataset. Selection timeouts can affect
eligibility across machines.

Treat the library stratum as potentially contaminated: its statements and
proofs are public training material. Main/Complex_Main also retain original
facts and simplification rules, so library reconstruction happens in that
imported environment.

`fresh` currently contains validated steps derived from Swarm, Cascade, Sqrt2
and Sqrt4 in this repository. Local dependencies become named assumptions and
local abbreviations are expanded. Its training-data novelty is unverified;
no hand-written fresh source was supplied. The strata are reported separately
throughout, with no pooled success rate. Corpus sizes and proof-length buckets
appear in the generated tables.

## Exact evaluation method

The agent receives the canonical statement and its imports, never the held-out
proof. A public-task allowlist enforces that boundary. Distinct private canaries
and a positive control test check decoded trace strings for leaks; a common
independently generated proof such as `by simp` is not itself evidence of a leak.

The response must contain a proof block, with an optional preceding auxiliary
lemma block. The harness scans both fragments, prevents target-name shadowing
and cross-boundary lexical constructs, and inserts the statement verbatim into
a fresh theory. Each attempt uses its own temporary directory and headless
`isabelle process_theories` invocation with `quick_and_dirty=false`.

A result is proved only when the process exits zero, the scan passes, the
captured kernel output contains no parsed error, the check did not time out,
and the canonical statement remains verbatim. Timeouts kill the owned process
tree, including separate Isabelle ML process groups. No kernel, HOL, Isar or
distribution code is changed; the VS Code/MCP bridge is not used.

On failure, the next turn contains the previous model response and bounded
kernel/checker feedback. Missing response blocks are parse errors. The loop
stops at the first accepted proof or its configured attempt limit.
Sledgehammer, Nitpick and the broader `try` command are rejected; `try0` is
allowed. The numerical feedback, proof-length, token, timeout and budget limits
are stated in the generated summary below.

Every harness provider invocation has a durable request trace before the call
and a full response/usage/latency trace before parsing. Returned model identifiers,
Isabelle version and execution HEAD are retained. Failed or interrupted calls
with unknown usage retain a conservative spend reservation; requests without
a recorded response are not silently repeated. Rows already present for the
same run, lemma and condition are skipped.
Trace paths are `eval/results/traces/<run_id>/<lemma_id>/attempt_<n>.json`;
the ordinal is unique across conditions within a lemma, with the local attempt
number and condition also recorded inside the trace.

The adapters use environment credentials only. Temperature is zero by default;
explicit unsupported-temperature exceptions are recorded in request/config
data. Provider transport was tested with mocked HTTP responses, while proof
acceptance was tested against real Isabelle. Live provider observations,
where available, are reported separately from those tests.

The baseline tries the literal methods in this order:
`simp`, `auto`, `blast`, `fastforce`, `force`, `linarith`, `arith`,
then `simp add: algebra_simps`. It stops at its first accepted proof.
It adds no `using assms` preface, induction guess, Metis call, or external
prover baseline. The fixed method order is part of the measurement.

The budget gate uses smoke token/latency observations and measured kernel
startup time. It first removes larger attempt budgets, then models in config
order, then reduces the library sample while retaining the final model where
possible. Smoke spending shares the fixed USD ceiling. The full runner is
resumable, checks its persistent budget/deadline, and has bounded process
restarts. Incomplete coverage and unavailable measurements are reported explicitly.

## Exact system prompt

```text
{SYSTEM_PROMPT}
```

The initial user message is exactly:

```text
imports <space-separated canonical imports>

<canonical statement>
```

Subsequent user messages begin `Kernel/checker feedback:` and contain the
bounded error text. The previous response is retained as the preceding
assistant turn. The held-out proof is used for corpus validation and the
explicit held-out Fake test policy, never a real-provider prompt.

## Generated measurements

The following content is copied from `eval/results/full/summary.md`.
Tables derive from the saved result rows. Protocol, coverage and budget
metadata additionally use the local run context and ledger, where present.

{BEGIN}
{body.rstrip()}
{END}

## Interpretation

TODO(Leo)

## Limitations

- Only one prompt style and one default temperature were specified.
- {"There is no live real-model measurement in this report." if partial else "Model coverage and any incomplete runs are shown in the generated summary."}
- The library is public and its imported facts remain available; the
  example-derived stratum has no verified novelty guarantee.
- Related decomposed steps are dependent observations. Wilson intervals are
  descriptive and do not correct for that dependence or selection.
- Kernel timeouts and corpus validation filtering can favour faster tasks.
- The literal tactic battery is sensitive to fact forwarding and statement
  syntax. Original proof length is a rough proxy, not a difficulty label.
- No Sledgehammer/Nitpick runs are included in the agent loop, and the optional
  external-prover/AFP/persistent-server extensions were not performed.
- Token costs use configured prices and exclude CPU and engineering costs.
  Missing GPU-allocation measurements remain unavailable.
- Milestone commits follow checks. Execution HEADs and local source hashes,
  including the baseline's pre-milestone HEAD, are explained in EVAL_NOTES.md.
- Raw rows and private receipts are gitignored as requested. Publishing the
  summary alone does not constitute a release of the raw evaluation data.

Further interpretation and publication claims: TODO(Leo)

## Reproduce in five commands

Prerequisites: the supported Isabelle installation and Python are available.
Set provider credentials in environment variables and put explicit model IDs,
prices and limits in `eval/configs/full.json` before requesting real calls.
OpenAI-compatible access uses `OPENAI_BASE_URL` and `OPENAI_API_KEY`; Anthropic
access uses `ANTHROPIC_API_KEY`.
Use a new run ID when changing a measured configuration or corpus. Re-running
only the report command regenerates the existing local tables without API calls.
The unavailable placeholder in this checkout does not reserve the full run ID.

```sh
python3 -m venv eval/.venv && eval/.venv/bin/python -m pip install -r eval/requirements.txt
eval/.venv/bin/python -m eval.probe_m0 && eval/.venv/bin/python -m eval.corpus.build_corpus
eval/.venv/bin/python -m eval.harness.tactics
eval/.venv/bin/python -m eval.harness.smoke --run-full
eval/.venv/bin/python -m eval.harness.report results/full && eval/.venv/bin/python -m eval.harness.writeup
```

In an environment without configured real models, the smoke command records
the failed checks, writes the partial report, and exits nonzero. Continue with
the final reporting command to obtain the available baseline-only write-up.
The generator overwrites the skeleton; keep authored interpretation separately
or copy it back after regenerating.
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", default="results/full")
    parser.add_argument("--output", default="docs/EVAL_RESULTS.md")
    args = parser.parse_args()
    summary = (report_directory(args.results) / "summary.md").read_text()
    Path(args.output).write_text(generate(summary))


if __name__ == "__main__":
    main()
