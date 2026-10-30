You are working in this repository (retinapeg/Mathematical-proof-revamp). Create and check out
a branch `eval` from the current HEAD. Commit after every milestone with a one-line message
naming it. Never force-push. Do not touch `extension/`, `mcp/`, `demo/` or `examples/` except
to read them.

## Environment (verify in M0, do not assume)
- Isabelle2025-2 on PATH; `isabelle version` prints Isabelle2025-2. HOL heap prebuilt
  (`isabelle build -b HOL` returns in seconds).
- Headless check of a theory: `isabelle process_theories -D <dir> -O <TheoryName>`.
  The old `isabelle process` is gone. Verified on this repo: `isabelle process_theories -D demo -O Swarm`.
- Python 3.11+. Dependencies allowed: `httpx`, `anthropic`, `openai`, `pytest`. Nothing else.
- LLM access is through environment variables only:
  `OPENAI_BASE_URL` + `OPENAI_API_KEY` (any OpenAI-compatible endpoint, including a local vLLM
  server for open-weight models on GPU), and/or `ANTHROPIC_API_KEY`. Never hard-code keys.

## Goal
Measure how well an LLM, given only a lemma statement and the Isabelle kernel's feedback,
produces proofs the kernel accepts — over a few hundred lemmas, several models, and a
no-LLM baseline — and produce a results table honest enough to publish. The MCP server in
`mcp/` cannot be used: it bridges to a live VS Code window. The eval gets its own headless
driver around `isabelle process_theories`.

The thesis being tested is the README's: the agent proposes, only the kernel says proved.

## Hard rules
- Isabelle is untouched: no kernel, HOL, Isar or distribution changes.
- The agent NEVER sees the held-out original proof. The agent supplies proof text only; the
  harness assembles the theory file from the canonical statement + the agent's text. The
  statement can therefore never be altered by the agent.
- Exit code 0 from `process_theories` is never, on its own, "proved". A run is proved only if:
  exit code 0 AND the cheat scanner passes AND the kernel output contains no error AND the
  theory contains the canonical statement verbatim.
- Every LLM call is logged in full (prompt, response, model string, tokens, latency) to
  `eval/results/traces/<run_id>/<lemma_id>/attempt_<n>.json`. No exceptions.
- Temperature 0 where the API supports it; record the exact model identifier returned by
  the API, the Isabelle version and the git SHA in every results row.
- Runs are resumable: a row already present in `results.jsonl` for (run_id, lemma_id,
  condition) is skipped.
- No sledgehammer or nitpick in the agent loop (parity with `demo/CLAUDE.md`). `try0` is
  allowed as a method the agent may write. Sledgehammer is a separate optional baseline (M8).
- Small, readable code. One module per concern. Type hints. No framework.
- Stop at each STOP WHEN, run the check, commit. Do not start milestone N+1 until N passes.
- This run is UNATTENDED. Nobody will answer a question. Never wait for input; if a decision
  is needed, take the conservative option, record it in docs/EVAL_NOTES.md under
  "Decisions taken unattended", and continue.
- Budget is fixed up front in `eval/configs/full.json`: `max_usd` (LLM spend) and
  `max_hours` (wall clock for M6). At M5, proceed to M6 automatically only if the projected
  cost ≤ max_usd AND projected hours ≤ max_hours; otherwise shrink the run (drop
  max_attempts=4 first, then drop models in config order, then subsample lib to 150) until it
  fits, record what was dropped, and proceed. The runner aborts cleanly at either limit;
  whatever finished is reported.
- If a milestone's check fails three times in a row, stop that milestone, write what
  failed to docs/EVAL_NOTES.md, and still produce the report from whatever data exists.
  A partial summary.md beats an empty one.
- If Isabelle is not found or the HOL heap is missing at M0, run `isabelle build -b HOL`
  once (up to 30 min), then re-check; if still missing, stop and write the error to
  docs/EVAL_NOTES.md.

## Layout to create
  eval/
    corpus/
      build_corpus.py        extract statements from .thy sources, validate, write JSONL
      lib.jsonl              stratum "lib": statements from the Isabelle2025-2 distribution
      fresh.jsonl            stratum "fresh": statements Leo supplies (see M1)
      afp_recent.jsonl       stratum "afp_recent": optional (M8)
    harness/
      assemble.py            canonical statement + agent proof text -> theory file
      kernel.py              run process_theories with timeout, capture output, parse errors
      scanner.py             cheat scanner
      classify.py            map kernel errors to a failure class
      llm.py                 provider abstraction (OpenAI-compatible, Anthropic, Fake)
      agent.py               the attempt loop
      tactics.py             the no-LLM tactic battery baseline
      runner.py              parallel, resumable orchestration; writes results.jsonl
      report.py              results.jsonl -> summary.md (tables, CIs, cost)
      schema.py              the results row dataclass + validation
    configs/
      smoke.json             10 lemmas, 1 model, 1 attempt
      full.json              the real run
    tests/                   pytest; see M2/M3
    results/                 gitignored except summary.md and EVAL_RESULTS.md
  docs/EVAL_NOTES.md         everything discovered empirically about process_theories
  docs/EVAL_RESULTS.md       the write-up (M7)

## Corpus format (one JSON object per line)
  {"id": "lib/List/rev_rev_ident", "stratum": "lib", "source_file": "...", "source_line": 123,
   "imports": ["Main"], "statement": "lemma rev_rev_ident: \"rev (rev xs) = xs\"",
   "held_out_proof": "by (induct xs) auto", "orig_proof_lines": 1, "orig_proof_chars": 24,
   "tactic_baseline_proved": null}
`held_out_proof` is read ONLY by the report module (for the difficulty proxy) and by the
Fake LLM in tests. It is never passed to a real model. Enforce this with a leak test (M3).

## Results row (one per lemma x condition x run)
  run_id, lemma_id, stratum, condition {model, max_attempts}, proved (bool), attempts_used,
  failure_class in {parse_error, unknown_fact, method_failed, unfinished_goal, type_error,
  timeout, cheat_rejected, provider_error, other}, final_error (first 500 chars),
  proof_text (final attempt), proof_lines, methods_used (counts of simp/auto/blast/metis/
  fastforce/force/arith/linarith/induction/try0/other), aux_lemmas, prompt_tokens,
  completion_tokens, usd_cost, llm_wall_s, kernel_wall_s, model_id_returned, isabelle_version,
  git_sha, timestamp.

## Milestones

### M0 — Environment and the meaning of exit codes
Run `isabelle process_theories -D examples -O Swarm_solution` (expect exit 0) and
`-O Swarm` (contains six `sorry`). Record in docs/EVAL_NOTES.md: exit codes, whether `sorry`
is reported in output, and whether passing `-o quick_and_dirty=false` makes a `sorry` theory
fail (try it; record the exact flag that works or that none does). Record how errors appear
in the output (the `***` lines, their positions) with three real examples: a syntax error,
an undefined fact, a failed `by simp`. Measure wall time of a trivial theory check five
times; record the median (this sets the parallelism budget).
STOP WHEN: EVAL_NOTES.md answers all of the above with command transcripts. Commit.

### M1 — Corpus
`build_corpus.py`:
- `lib`: walk `$(isabelle getenv -b ISABELLE_HOME)/src/HOL/` (List.thy, Nat.thy, Set.thy,
  Finite_Set.thy, Library/*.thy and others). Extract top-level `lemma`/`theorem`/`corollary`
  statements that are NOT inside `context`, `locale`, `class` or `instantiation` blocks, with
  their original proof text (from the end of the statement to the end of the proof: a `by`
  line, or a `proof … qed` block, or `..`/`.`). Strip the name's attributes
  (`[simp]`, `[intro]` …) from the canonical statement but keep the name.
- Validate every candidate: assemble `imports Main` (or `Complex_Main` where the source needs
  it) + statement + `sorry` and run the kernel check with quick_and_dirty on. Keep only those
  that load (this filters out statements that need local definitions or notation). Then
  assemble statement + held-out proof and check it is accepted; keep only those too.
- Target ≥ 250 validated `lib` lemmas, stratified so no single source theory contributes
  more than 15%. Deterministic selection (sorted, seeded).
- `fresh`: a file Leo writes by hand, `eval/corpus/fresh_statements.thy`, in the style of
  `examples/Swarm.thy` (a named `have` per step is fine: decompose each theorem into its
  steps as separate lemmas). The existing `examples/*.thy` and their `_solution` files are the
  first entries: decompose Swarm, Cascade, Sqrt2, Sqrt4 into per-step lemmas with the solution
  step as held-out proof. Validate exactly as above. Target 25–40.
- Print corpus statistics: per stratum count, imports distribution, orig_proof_lines
  histogram (buckets 1, 2–3, 4–8, 9+).
STOP WHEN: `python -m eval.corpus.build_corpus` writes lib.jsonl and fresh.jsonl, every
row passes both validations, and the statistics print. Commit (the JSONL files are committed).

### M2 — Kernel checker, scanner, classifier, with tests
- `assemble.py`: `assemble(statement, imports, proof_text, aux_lemmas="") -> str` producing
  `theory <Name> imports … begin <aux> <statement> <proof> end`. The theory name is derived
  from the lemma id and is unique per attempt. The statement string is inserted verbatim.
- `kernel.py`: `check(theory_text, workdir, timeout_s) -> KernelResult(exit_code, stdout,
  stderr, errors: list[KernelError(line, col, message)], wall_s, timed_out)`. One lemma per
  theory file, one temp dir per attempt, killed on timeout (kill the process group).
- `scanner.py`: reject proof text containing any of: `sorry`, `oops`, `axiomatization`,
  `quick_and_dirty`, `skip_proof`, `cheat`, `ML`, `ML_prf`, `ML_val`, `setup`, `declare`,
  `consts`, `defs`, `overloading`, `code_printing`, `theory`, `imports`, `begin`, `end`
  (as a top-level keyword), `lemmas`, `declare`, `translations`, `notation`, `no_notation`,
  `hide_fact`, `hide_const`. Also reject if proof_text > 8000 chars. Be strict: a `sorry`
  inside a comment is still rejected (document this). Aux lemmas are scanned identically
  and additionally must not share a name with the target.
- `classify.py`: regexes over the kernel errors, in priority order: timeout → cheat →
  "Outer syntax error"/"Inner syntax error"/"Bad name" → parse_error; "Undefined fact"/
  "Unknown fact"/"Undefined type name"/"Undeclared" → unknown_fact; "Type unification
  failed"/"Type error" → type_error; "Failed to finish proof"/"Failed to apply initial proof
  method"/"empty result sequence" → method_failed; "Failed to refine"/"unfinished"/"goal"
  remaining → unfinished_goal; else other.
- Tests (pytest, `eval/tests/`): scanner positives and negatives (incl. `sorry` in a comment,
  `end` inside an identifier like `append` must NOT trigger); assemble preserves the statement
  byte-for-byte; classifier on the three real error transcripts from M0 (saved as fixtures);
  kernel check on `examples/Swarm_solution.thy` content → proved, on `examples/Swarm.thy`
  content → not proved (mark `@pytest.mark.isabelle`; skipped when Isabelle is absent).
STOP WHEN: `pytest eval/tests -m "not isabelle"` and `pytest eval/tests -m isabelle` both
pass. Commit.

### M3 — Agent loop with a fake model, end-to-end
- `llm.py`: `complete(messages, model) -> Completion(text, prompt_tokens, completion_tokens,
  model_id, wall_s)` for three providers: OpenAICompatible (httpx or openai SDK; base URL from
  env), Anthropic, and Fake. Fake is constructed with a policy: `"held_out"` (returns the
  held-out proof), `"simp"` (returns `by simp`), `"sorry"` (returns `sorry`), `"garbage"`.
  Cost table per model in the run config (USD per 1M prompt/completion tokens; 0 for
  self-hosted, in which case record GPU hours separately in the run config).
- `agent.py`: the loop. System prompt = the proof-style rules from `demo/CLAUDE.md`
  (structured Isar, named `have`s, one-line `by`, `try0` allowed, no sledgehammer/nitpick,
  no new imports) plus the output contract: respond with the proof text only, between
  `<proof>` and `</proof>`; optional `<aux>` block for auxiliary lemmas placed before the
  target. User turn = imports + canonical statement. Each subsequent attempt appends the
  kernel's error lines (max 40 lines, max 3000 chars) and the previous proof text. Stop at
  first proved or at max_attempts. Extract the blocks; if missing, failure_class=parse_error
  for that attempt and feed that back.
- `runner.py`: reads a config `{run_id, corpus: [paths], conditions: [{model, provider,
  max_attempts}], workers, kernel_timeout_s, max_usd}`, runs lemma × condition over a
  process pool sized by `workers`, appends rows to `results/<run_id>/results.jsonl` as they
  finish, skips rows already present, writes traces, and aborts cleanly if cumulative
  usd_cost exceeds `max_usd`.
- Tests: e2e with Fake("held_out") on 5 `fresh` lemmas → 5/5 proved; Fake("sorry") → 5/5
  cheat_rejected with no kernel call made; Fake("simp") → some proved, the rest
  method_failed/unfinished_goal; resumability: run twice, second run makes zero LLM calls.
  Leak test: after any run, grep every trace file for each lemma's `held_out_proof`
  (normalised whitespace); must appear in zero traces except Fake("held_out") runs, which
  the test excludes.
STOP WHEN: all M3 tests pass. Commit.

### M4 — Tactic battery baseline (no LLM)
`tactics.py`: for each lemma, try in order, each as a separate kernel check with a 30 s
timeout: `by simp`, `by auto`, `by blast`, `by fastforce`, `by force`, `by linarith`,
`by arith`, `by (simp add: algebra_simps)`, `by (induction rule: …)` is NOT attempted
(needs a variable), `by (metis)` is NOT attempted. Record which method proved it.
Run over the whole corpus; write `tactic_baseline_proved` back into the corpus JSONL and
a results run `run_id=tactics` with condition `{model: "tactics", max_attempts: 8}`.
STOP WHEN: the baseline run completes and `report.py` prints the baseline proved % per
stratum. Commit the updated corpus and summary.

### M5 — Smoke with real models, then budget gate
`configs/smoke.json`: 10 lemmas (5 lib, 5 fresh), every model listed in `configs/full.json`,
max_attempts 1. Run it. Any model whose provider errors on all 10 is dropped from the full
run (record it). Write a projection to docs/EVAL_NOTES.md for the full run (corpus × models ×
max_attempts ∈ {1, 4}): LLM cost from smoke token counts, kernel hours from the M0 median ×
expected attempts / workers. Apply the budget rule from Hard rules. Commit.
STOP WHEN: the projection is written and `configs/full.json` reflects any shrinking.
Proceed to M6 without asking.

### M6 — Full run
Run `configs/full.json`. Resumable; if the process dies, rerun the same command (wrap the
run in a retry loop of up to 3 restarts). Then `report.py` → `results/full/summary.md` with:
- Table 1: proved % with Wilson 95% CI, by model × max_attempts × stratum; tactic baseline
  as the first row.
- Table 2: "value over tactics": lemmas proved by the model that the battery did not, and
  the reverse.
- Table 3: failure class distribution per model (parse_error, unknown_fact, …). Report the
  hallucinated-fact rate (unknown_fact / failed attempts) explicitly.
- Table 4: proved % by orig_proof_lines bucket (the difficulty curve).
- Table 5: cost per proved lemma (USD, or GPU-hours), median llm_wall_s and kernel_wall_s.
- Methods used in accepted proofs (simp/auto/metis/… counts) per model.
STOP WHEN: summary.md exists and every number in it can be regenerated from results.jsonl
by `python -m eval.harness.report results/full`. Commit summary.md.

### M7 — Write-up skeleton
docs/EVAL_RESULTS.md: what was measured, the corpus and its strata with the contamination
caveat stated plainly (lib statements and proofs are in training data; fresh ones are not;
report them separately and never pool them), the exact loop and prompt, the tables from
summary.md, limitations (one prompt style, no sledgehammer in the loop, single
temperature, kernel timeout), and how to reproduce in five commands. Leave the prose
sections as `TODO(Leo)`; fill in the method and numbers.
STOP WHEN: the file exists with every number sourced from summary.md. Commit.

### M8 — Optional, only if asked
- Sledgehammer baseline via `isabelle mirabelle` on the same corpus.
- `afp_recent` stratum from AFP entries dated after the models' cutoffs.
- Persistent `isabelle server` session instead of one `process_theories` per attempt, if
  kernel time dominates.

## Before you start: `eval/configs/full.json` must already exist
Leo creates it before launching you. Expected shape:
  {"run_id": "full", "corpus": ["eval/corpus/lib.jsonl", "eval/corpus/fresh.jsonl"],
   "conditions": [{"model": "<id>", "provider": "openai_compatible"|"anthropic",
                   "max_attempts": 1}, {... "max_attempts": 4}],
   "cost_usd_per_m": {"<id>": {"prompt": 0.0, "completion": 0.0}},
   "workers": 8, "kernel_timeout_s": 120, "max_usd": 0.0, "max_hours": 8}
If it is missing, create it from the environment variables present (whatever `OPENAI_BASE_URL`
serves: query `/v1/models` and use every model listed; Anthropic only if its key is set),
with `max_usd` 25 and `max_hours` 8, and record that you did.

## Conventions
- Theory names: `E_<sha1(lemma_id + run_id + attempt)[:10]>`; temp dirs under
  `eval/results/<run_id>/work/`, deleted after each attempt unless `--keep-work`.
- Logging: one line per finished row to stdout: `lemma_id condition proved attempts
  failure_class usd`. Nothing else on stdout during runs.
- Record every empirical discovery about `process_theories` in docs/EVAL_NOTES.md as you
  go, in the existing PAINPOINTS format (what happened / experience / fix).
