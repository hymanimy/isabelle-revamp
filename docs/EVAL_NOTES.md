# Headless evaluation notes

## Decisions taken unattended

- M5 shrinking retains one model until the prescribed lib-to-150 step has been
  tried; otherwise dropping every model would make that last shrinking step
  unreachable. If even that final condition does not fit, schedule no real run
  and report the reason. The fixed `max_usd` and `max_hours` are never increased.
- M5 smoke costs and unresolved reservations count against the full USD ceiling
  via `prior_run_costs` / `prior_usd_cost`; M6 gets only the remainder. M6's wall
  clock starts when M6 is actually launched. An unavailable partial report does
  not create its spend ledger or immutable run manifest, so supplying credentials
  and models later can still use `run_id=full`.

- M4 corpus reproducibility audit: the default corpus command now validates and
  retains an existing complete corpus snapshot, including baseline annotations.
  `--rebuild` explicitly resamples and clears cached negative judgments from
  earlier batch timeouts. Adding a previously absent hand-written fresh source
  still triggers extraction. The committed JSONL is the identity of this
  benchmark: resampling is a dataset change and requires a new results run.
  Sorted/seeded candidate order is deterministic; timeout-based eligibility can
  still vary across machines. Earlier exploratory cache outcomes are not a
  guarantee of identical clean-room resampling.

- M4 provenance: results record the HEAD at execution time (`fb0d140...` for
  the baseline); the required milestone commit follows the run. Thus that HEAD
  alone is not a claim that all new M4 files were committed before execution.
  The baseline's local `source_hashes.json` records evaluator source hashes;
  the milestone commit preserves the implementation after acceptance.
- M4 reporting: all five table calculations share the same reporting module.
  Successful-row medians sum all attempts for each lemma first. Attempt-failure
  counters include retries preceding eventual successes. Missing GPU allocation
  measurements are NA, never estimated from API latency or a zero token price.

- M3 trace naming: the requested path lacks a condition component. To prevent
  model/attempt-budget collisions, `attempt_<n>.json` uses a run-wide ordinal
  within each lemma: condition offsets are cumulative maximum attempt counts.
  Each trace also records the condition and its local attempt number. Theory
  names use that ordinal in the specified SHA1 formula.
- M3 leak tests: a literal match of an original `by simp` in a generated answer
  cannot distinguish leakage from independent reconstruction. Tests therefore
  append unique harmless comment canaries to originals, check all normalized
  held-out strings and canaries across every non-held-out-fake trace, and test
  the public task allowlist. Real-provider inputs contain imports and statement
  only, plus preceding model responses and checker feedback. Corpus construction
  must read originals to validate them; only Fake's held-out policy and the
  reporting/corpus stages may access that field.
- M3 successful rows have `failure_class=null`; failures use the requested enum.
  Extra `attempt_failures`, `orig_proof_lines`, `model_ids_returned`, `provider`
  and `cost_is_upper_bound` fields preserve attempt-rate denominators, difficulty,
  API alias changes and incomplete usage. Fake results are test data, never
  real-model measurements.
- M3 uses SQLite (Python standard library) for atomic spend reservations across
  workers. Reserve before each request; settle against returned usage; retain an
  upper bound for interrupted/unknown-usage calls. A restart reuses the original
  wall-clock deadline and trace responses. Calls with no recorded response are
  not automatically retried. Providers must honour configured token limits and
  configured prices must be accurate; this cannot enforce a provider's billing.
- M3 provider requests follow the official
  [OpenAI Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
  and [Anthropic Messages reference](https://platform.claude.com/docs/en/api/messages/create).
  Temperature is zero by default; a condition may explicitly set
  `supports_temperature=false` for an API that rejects it. There is no silent
  fallback or hidden request retry. OpenAI-compatible endpoints may explicitly
  select `token_parameter="max_tokens"` instead of `max_completion_tokens`.
  All credentials remain in environment variables; headers are never logged.

- Continuation audit (2026-10-20): cwd and git root are
  `/Users/leo/Mathematical-proof-revamp`; branch `eval` is already checked out
  at `8b3de98` (M0). Preserved the modified notes/probe, untracked corpus work
  and `eval_overnight.log`; continued the existing branch without resetting it.
  Rechecked `isabelle version` = `Isabelle2025-2` and `isabelle build -b HOL`
  = exit 0, `0:00:02 elapsed time`. Audited all twelve saved M0 observations:
  exits `[0,1,1,0,1,1,1,0,0,0,0,0]`, median 6.999 s. M0 remains passed.
  All three provider environment variables are still absent. The pre-existing
  config is retained; real API calls are unavailable, not simulated measurements.

- Startup (2026-10-20): repository `/Users/leo/Mathematical-proof-revamp`,
  HEAD `abb9d23746692ef498d1549e97fb90b64f21b4ed`. Branch `eval` already existed
  and was checked out at that HEAD. Reused it without resetting history.
- Preserved the pre-existing untracked `eval_overnight.log`; it is not evaluation data.
- `eval/configs/full.json` was absent. Created it with the requested fallback
  budget of USD 25 and eight hours. None of `OPENAI_BASE_URL`, `OPENAI_API_KEY`,
  or `ANTHROPIC_API_KEY` is set. Conditions are therefore empty: no endpoint,
  model identifier, credentials, or prices have been invented. Real-model
  comparisons cannot be measured in this environment.
- Defaulted to one worker pending M0 timings. The runner may use the explicitly
  requested process pool; no agents, worktrees, or detached jobs are used.
- Python is 3.13.15. No `httpx`, `anthropic`, `openai`, or `pytest` is installed
  in the initial Python environment. Dependencies, if needed, will be local.
- M1: `eval/corpus/fresh_statements.thy` is absent. Do not invent a file and
  attribute it to Leo. Promote existing example steps into independent lemmas,
  preserving referenced facts as named assumptions and expanding local `let`
  abbreviations in the statement and solution step. Include a supplied file
  automatically if one is added later. These are example-derived tasks, not
  evidence of training-set novelty; publication must not claim otherwise.
- M1: the current `examples/Sqrt2.thy` is a primes demo, has two admissions,
  imports `HOL-Computational_Algebra.Primes`, and has no `_solution` sibling.
  Only its already complete declarations are candidates; statements needing
  unavailable imports or local facts are rejected by validation. Do not silently
  synthesize missing held-out solutions. Swarm, Cascade and Sqrt4 solutions are
  read without changing them.
- M1: a lexer is deliberately conservative, not a full Isar parser. Unsupported
  declarations are discarded; the target is validated examples, not exhaustive
  extraction. Original proofs are necessarily read by corpus construction for
  validation; downstream real-provider code must never receive them.

## M0: environment

- **What happened.** `isabelle version` prints `Isabelle2025-2`.
  `isabelle build -b HOL` exits 0 and prints `0:00:02 elapsed time`.
  `isabelle getenv -b ISABELLE_HOME` prints
  `/Users/leo/hack/isabelle-env/Isabelle2025-2.app`.
- **Experience.** The installed distribution and prebuilt HOL heap are available.
- **Fix / action.** Use the existing executable and `process_theories`, without
  changing Isabelle, global settings, or the editor bridge.

```text
$ isabelle version
Isabelle2025-2
exit: 0
$ isabelle build -b HOL
0:00:02 elapsed time
exit: 0
```

## M0: command transcripts

```text
$ isabelle process_theories -D examples -O Swarm_solution
Running Draft ...

Output (line 7 of "~/Mathematical-proof-revamp/examples/Swarm_solution.thy"):
theorem sum_first_odds: (\<Sum>i<?n. 2 * i + 1) = ?n\<^sup>2

Output (line 10 of "~/Mathematical-proof-revamp/examples/Swarm_solution.thy"):
have base: (\<Sum>i<0. 2 * i + 1) = 0\<^sup>2

Output (line 13 of "~/Mathematical-proof-revamp/examples/Swarm_solution.thy"):
have next_sum: (\<Sum>i<Suc ?k. 2 * i + 1) = (\<Sum>i<?k. 2 * i + 1) + (2 * ?k + 1)

Output (line 16 of "~/Mathematical-proof-revamp/examples/Swarm_solution.thy"):
have next_square: ?k\<^sup>2 + (2 * ?k + 1) = (Suc ?k)\<^sup>2

Output (line 19 of "~/Mathematical-proof-revamp/examples/Swarm_solution.thy"):
have induction_step:
       (\<Sum>i<?k. 2 * i + 1) = ?k\<^sup>2 \<Longrightarrow> (\<Sum>i<Suc ?k. 2 * i + 1) = (Suc ?k)\<^sup>2

Output (line 25 of "~/Mathematical-proof-revamp/examples/Swarm_solution.thy"):
show (\<Sum>i<k. 2 * i + 1) = k\<^sup>2

Output (line 26 of "~/Mathematical-proof-revamp/examples/Swarm_solution.thy"):
have all_n: (\<Sum>i<?k. 2 * i + 1) = ?k\<^sup>2

Output (line 29 of "~/Mathematical-proof-revamp/examples/Swarm_solution.thy"):
have result: (\<Sum>i<n. 2 * i + 1) = n\<^sup>2

Output (line 30 of "~/Mathematical-proof-revamp/examples/Swarm_solution.thy"):
show (\<Sum>i<n. 2 * i + 1) = n\<^sup>2
Finished Draft (0:00:01 elapsed time)

exit: 0; wall_s: 8.492
```

```text
$ isabelle process_theories -D examples -O Swarm
Running Draft ...

Output (line 7 of "~/Mathematical-proof-revamp/examples/Swarm.thy"):
theorem sum_first_odds: (\<Sum>i<?n. 2 * i + 1) = ?n\<^sup>2

Error (line 7 of "~/Mathematical-proof-revamp/examples/Swarm.thy"):
*** Cheating requires quick_and_dirty mode!
Draft FAILED (see also "isabelle build_log -H Error Draft")
*** Cheating requires quick_and_dirty mode!
*** At command "sorry" (line 10 of "~/Mathematical-proof-revamp/examples/Swarm.thy")
Unfinished session(s): Draft

exit: 1; wall_s: 8.171
```

```text
$ isabelle process_theories -D examples -O -o quick_and_dirty=false Swarm
Running Draft ...

Output (line 7 of "~/Mathematical-proof-revamp/examples/Swarm.thy"):
theorem sum_first_odds: (\<Sum>i<?n. 2 * i + 1) = ?n\<^sup>2

Error (line 7 of "~/Mathematical-proof-revamp/examples/Swarm.thy"):
*** Cheating requires quick_and_dirty mode!
Draft FAILED (see also "isabelle build_log -H Error Draft")
*** Cheating requires quick_and_dirty mode!
*** At command "sorry" (line 10 of "~/Mathematical-proof-revamp/examples/Swarm.thy")
Unfinished session(s): Draft

exit: 1; wall_s: 7.363
```

```text
$ isabelle process_theories -D examples -O -o quick_and_dirty=true Swarm
Running Draft ...

Output (line 7 of "~/Mathematical-proof-revamp/examples/Swarm.thy"):
theorem sum_first_odds: (\<Sum>i<?n. 2 * i + 1) = ?n\<^sup>2

Output (line 10 of "~/Mathematical-proof-revamp/examples/Swarm.thy"):
have base: (\<Sum>i<0. 2 * i + 1) = 0\<^sup>2

Output (line 13 of "~/Mathematical-proof-revamp/examples/Swarm.thy"):
have next_sum: (\<Sum>i<Suc ?k. 2 * i + 1) = (\<Sum>i<?k. 2 * i + 1) + (2 * ?k + 1)

Output (line 16 of "~/Mathematical-proof-revamp/examples/Swarm.thy"):
have next_square: ?k\<^sup>2 + (2 * ?k + 1) = (Suc ?k)\<^sup>2

Output (line 19 of "~/Mathematical-proof-revamp/examples/Swarm.thy"):
have induction_step:
       (\<Sum>i<?k. 2 * i + 1) = ?k\<^sup>2 \<Longrightarrow> (\<Sum>i<Suc ?k. 2 * i + 1) = (Suc ?k)\<^sup>2

Output (line 22 of "~/Mathematical-proof-revamp/examples/Swarm.thy"):
have all_n: (\<Sum>i<?k. 2 * i + 1) = ?k\<^sup>2

Output (line 25 of "~/Mathematical-proof-revamp/examples/Swarm.thy"):
have result: (\<Sum>i<n. 2 * i + 1) = n\<^sup>2

Output (line 26 of "~/Mathematical-proof-revamp/examples/Swarm.thy"):
show (\<Sum>i<n. 2 * i + 1) = n\<^sup>2
Finished Draft (0:00:01 elapsed time)

exit: 0; wall_s: 8.696
```

```text
$ isabelle process_theories -D eval/results/m0/work -O E_syntax_error
Running Draft ...

Output (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_syntax_error.thy"):
theorem probe: True

Error (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_syntax_error.thy"):
*** Outer syntax error (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_syntax_error.thy"): keyword "(" expected,
*** but end-of-input (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_syntax_error.thy") was found
Draft FAILED (see also "isabelle build_log -H Error Draft")
*** Outer syntax error (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_syntax_error.thy"): keyword "(" expected,
*** but end-of-input (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_syntax_error.thy") was found
*** At command "<malformed>" (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_syntax_error.thy")
Unfinished session(s): Draft

exit: 1; wall_s: 7.032
```

```text
$ isabelle process_theories -D eval/results/m0/work -O E_unknown_fact
Running Draft ...

Output (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_unknown_fact.thy"):
theorem probe: True

Error (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_unknown_fact.thy"):
*** Undefined fact: "nonexistent_eval_fact_3819" (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_unknown_fact.thy")
Draft FAILED (see also "isabelle build_log -H Error Draft")
*** Undefined fact: "nonexistent_eval_fact_3819" (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_unknown_fact.thy")
*** At command "by" (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_unknown_fact.thy")
Unfinished session(s): Draft

exit: 1; wall_s: 8.046
```

```text
$ isabelle process_theories -D eval/results/m0/work -O E_method_failed
Running Draft ...

Output (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_method_failed.thy"):
theorem probe: ?x = ?y

Error (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_method_failed.thy"):
*** Failed to apply initial proof method (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_method_failed.thy"):
*** goal (1 subgoal):
***  1. x = y
Draft FAILED (see also "isabelle build_log -H Error Draft")
*** Failed to apply initial proof method (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_method_failed.thy"):
*** goal (1 subgoal):
***  1. x =
***     y
*** At command "by" (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_method_failed.thy")
Unfinished session(s): Draft

exit: 1; wall_s: 7.029
```

```text
$ isabelle process_theories -D eval/results/m0/work -O E_trivial
Running Draft ...

Output (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_trivial.thy"):
theorem probe: True
Finished Draft (0:00:01 elapsed time)

exit: 0; wall_s: 6.999
```

```text
$ isabelle process_theories -D eval/results/m0/work -O E_trivial
Running Draft ...

Output (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_trivial.thy"):
theorem probe: True
Finished Draft (0:00:01 elapsed time)

exit: 0; wall_s: 7.058
```

```text
$ isabelle process_theories -D eval/results/m0/work -O E_trivial
Running Draft ...

Output (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_trivial.thy"):
theorem probe: True
Finished Draft (0:00:01 elapsed time)

exit: 0; wall_s: 6.968
```

```text
$ isabelle process_theories -D eval/results/m0/work -O E_trivial
Running Draft ...

Output (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_trivial.thy"):
theorem probe: True
Finished Draft (0:00:01 elapsed time)

exit: 0; wall_s: 6.967
```

```text
$ isabelle process_theories -D eval/results/m0/work -O E_trivial
Running Draft ...

Output (line 4 of "~/Mathematical-proof-revamp/eval/results/m0/work/E_trivial.thy"):
theorem probe: True
Finished Draft (0:00:01 elapsed time)

exit: 0; wall_s: 7.094
```

Trivial-check median (five sequential runs): **6.999 s**.

## M0: conclusions and check

- **What happened.** `Swarm_solution` exits 0. `Swarm` exits 1 both by default
  and with `-o quick_and_dirty=false`, reporting `Cheating requires
  quick_and_dirty mode!` and `At command "sorry"` with source lines. With
  `-o quick_and_dirty=true`, `Swarm` exits 0 and its output contains no literal
  `sorry` or cheating warning, despite the six admissions in the source.
- **Experience.** Output that looks successful can conceal admissions when
  quick-and-dirty checking is enabled. Output contains theorem declarations
  before a failing proof, so those declarations are not success evidence either.
- **Fix / action.** Evaluation uses explicit `-o quick_and_dirty=false`, a
  separate strict proof scanner, canonical-statement preservation, and error
  parsing. Corpus statement validation alone explicitly enables admissions.
- **What happened.** The three negative examples print `Error (line 4 of
  "…thy"):` followed by `***` messages on stdout, and repeat messages in the
  failed-session summary. Stderr is empty. No column is emitted in these examples.
- **Experience.** Reading only stderr misses every error tested here.
- **Fix / action.** Parse both streams, preserve line numbers, and represent an
  unavailable column as null. The real transcripts are committed in
  `eval/tests/fixtures/{syntax_error,unknown_fact,method_failed}.json`.
- **What happened.** Five checks take 6.999, 7.058, 6.968, 6.967, 7.094 seconds
  (rounded); median 6.999 seconds. Hardware reports six CPUs and 8 GiB RAM.
- **Experience.** Process startup dominates this trivial proof.
- **Fix / action.** Keep the fallback configuration at one worker on this small
  machine; project kernel time from the measured median. Batch corpus validation
  may share startup, but evaluation attempts must remain separate checks.
- **Check.** M0 passed: twelve recorded checks, expected exit codes
  `[0,1,1,0]` for the four Swarm configurations, three failing error fixtures,
  five successful timing runs, and the median recorded above. No Isabelle files
  or protected source directories were changed.

## M1: declaration errors in batch checks

- **What happened.** A mixed batch containing a good declaration and an undefined type prints the declaration error only in `***` summary lines, without an `Error (...)` header. The first corpus pass was stopped before producing a corpus because its header-only error locator needlessly bisected batches.
- **Experience.** Error formatting depends on where checking fails; parsing just one observed shape wastes checks and could miss errors.
- **Fix / action.** Locate affected files in both header and summary lines, then recheck survivors. Only a fully successful, error-free command validates a batch. The statement pass enables quick-and-dirty mode; the original-proof pass explicitly disables it. Commands and exit statuses are retained under `eval/results/corpus/`.

```text
$ isabelle process_theories -D eval/results/corpus/diagnostic -O -o quick_and_dirty=true E_good E_bad
Running Draft ...

Output (line 4 of "~/Mathematical-proof-revamp/eval/results/corpus/diagnostic/E_good.thy"):
theorem probe: True
Draft FAILED (see also "isabelle build_log -H Error Draft")
*** Undefined type name: "missing_type" (line 4 of "~/Mathematical-proof-revamp/eval/results/corpus/diagnostic/E_bad.thy")
*** At command "lemma" (line 4 of "~/Mathematical-proof-revamp/eval/results/corpus/diagnostic/E_bad.thy")
Unfinished session(s): Draft
exit: 1
```

## M1: corpus selection and imported context

- **What happened.** Some distribution theories require local definitions or notation that `Main` explicitly hides (for example lattice top notation). A failed batch can report only its first declaration error.
- **Experience.** Walking every Library theory does not mean its standalone statements are usable with the allowed imports. Sequentially removing one bad statement from a huge batch wastes startup time.
- **Fix / action.** Stopped the second exploratory pass before corpus publication. The selection walks HOL root and Library sources, shuffles each source with seed 20251020, then round-robins public mathematical source theories first; remaining sources are fallback. Source contributions are capped at floor(0.15 * target). Each rejected Main candidate is retried with Complex_Main. Both validation phases still require an error-free exit-zero command; rejections are expected filtering, not proof success.
- **Limitation.** Imported libraries already contain many target facts and simplification rules. This measures reconstruction in that imported environment, not proving library results without their originals in the context. The held-out proof text is withheld from models, but imported facts and training contamination are separate issues.

## M1: timeout cleanup crosses process groups

- **What happened.** An original-proof batch reached its 180 s diagnostic timeout (exit -9; `PROBE TIMEOUT`). Killing only the launcher group left an ML process alive in group 13120; `ps` showed its parent had become PID 1. Isabelle had launched ML via `bash_process` into separate groups.
- **Experience.** A command timeout does not necessarily stop CPU/memory consumption.
- **Fix / action.** Removed that owned orphan, stopped the owned validation tree, and resumed from 76 cached successes after adding descendant-group cleanup. A local process test with a child in a separate session passed. Corpus batches now have a 60 s timeout and the entire uncertain batch is discarded instead of repeatedly bisecting timeouts. All discarded members count as unvalidated, never successful. Completed corpus rows are checkpointed each round. This may bias selection toward faster validations and must be disclosed. No milestone acceptance check has yet passed for M1; interrupted exploratory passes are not successful checks.

## M1: bounded validation groups

- **What happened.** Continuation reached 96 validated library lemmas, then
  several 19-theory original-proof batches hit 60 s. Main/Complex_Main retries
  repeated the same expensive failures.
- **Experience.** One divergent proof prevents retaining otherwise usable
  candidates in that group.
- **Fix / action.** Interrupted the owned corpus process with SIGINT (its
  descendant cleanup ran), preserving checkpoints and receipts. Original-proof
  validation now uses groups of at most five, with a 30 s command timeout.
  Statement batches also use 30 s. Timed-out groups are still rejected in full;
  only exit-zero, error-free checks count. Earlier validation receipts remain
  available. This is a selection-time bound, distinct from evaluation timeouts.
- **Decision taken unattended.** Installed only the allowed direct dependencies
  `pytest` and `httpx` (plus their required transitive packages) in `eval/.venv`;
  no global packages or configuration were changed.

## M2: proof acceptance and statement boundaries

- **What happened.** Exit zero alone does not establish proof. An auxiliary
  fragment with an open comment could also hide the target from parsing while
  leaving the statement's bytes present in the file.
- **Experience.** Text-presence checks need a boundary check as well as a kernel
  verdict.
- **Fix / action.** Scan proof and auxiliary fragments separately, reject
  unbalanced comments/strings/cartouches, then require exit zero, no parsed
  errors, no timeout, a clean scan and the canonical statement verbatim.
  Reject quoted auxiliary names that shadow the target. Always invoke
  `process_theories -o quick_and_dirty=false`. Parse both error streams and both
  `Error (...)` and `***` locations; missing columns remain null. Kill owned
  descendant process groups on timeout, including Isabelle's separate ML group.
- **Decision taken unattended.** The strict scanner also rejects direct ML
  tactic/command hooks and sledgehammer/nitpick, including the broader `try`
  command that may invoke them; `try0` remains allowed. Forbidden tokens inside comments
  and strings are rejected deliberately, including `sorry`; substrings inside
  identifiers such as `append` are allowed. The specified exception is `end`:
  it is rejected as an unquoted command token, not in quoted terms or comments.
  This trades false positives for a
  smaller executable surface. It is not a general-purpose Isar security sandbox.

## M1 acceptance

`python3 -m eval.corpus.build_corpus` exited 0: 250 lib and 40 fresh, all
with matching successful statement/proof validation hashes. Lib spans 20 source
theories; maximum contribution 15/250 (6%). Imports: lib Main 238, Complex_Main
12; fresh Main 1, Complex_Main 39. Original-proof line buckets (1 / 2–3 / 4–8 /
9+): lib 198 / 11 / 19 / 22; fresh 28 / 0 / 9 / 3. Fresh sources: Swarm 6,
Cascade 31, Sqrt4 2, Sqrt2 1. The other Sqrt2 declarations need local facts and
were rejected. Lexer checks passed for attributes, local-context exclusion and
nested proof boundaries. Every retained JSONL row was checked against its
content-hashed validation receipt. Cached runs retain the earlier validation
timeouts documented above.

## M2 acceptance

`eval/.venv/bin/python -m pytest eval/tests -m "not isabelle"`: 61 passed.
`eval/.venv/bin/python -m pytest eval/tests -m isabelle`: 3 passed (13.75 s),
including real Swarm solution acceptance, admitted Swarm rejection and timeout.
Both checks passed again after adding lexical-boundary controls.

## M3 acceptance

Full suite: 71 passed in 64.15 s, including two-worker real-kernel e2e
checks on five fresh fixtures (held_out 5/5; sorry 5/5 rejected without kernel;
simp mixed outcomes; repeat runs write zero rows/calls). After adding a public
task allowlist check and stopped-call diagnostics, all 68 non-Isabelle tests
passed. HTTP provider tests use MockTransport; no real-provider request has
been made or claimed. Baseline will use two workers, following the successful
concurrent kernel checks; full config retains its conservative one worker.

## M4: repeated launches and bounded parallelism

- **What happened.** The first ten completed tactic rows used 52 checks and
  474.3 aggregate kernel seconds with two workers, compared with M0's 6.999 s
  sequential trivial-check median. Some lemmas exhaust all eight methods.
- **Experience.** Both startup overhead and failed attempts matter to wall time;
  a fast successful example is not a representative run-cost estimate.
- **Fix / action.** Retain the prescribed separate checks and 30 s timeouts,
  checkpoint every attempt and completed row, and keep the measured two-worker
  limit. At this point `memory_pressure -Q` reported 46% memory free on 8 GiB.
  No persistent server, sledgehammer baseline or other optional M8 work is used.
- **Accounting fix.** Mocked malformed API answers with returned usage/model IDs
  retain those values even when classified provider_error. A focused test
  confirms the usage is still charged and the exact returned ID is recorded.

## M4: named assumptions and the literal battery

- **What happened.** All eight literal methods failed on
  `fresh/Cascade/denominator_nonzero`. Its original validated proof is
  `using denominator by simp`; the statement names the positive-denominator
  assumption explicitly.
- **Experience.** A short, elementary reference proof does not guarantee that
  the specified bare-method battery succeeds. Fact forwarding and statement
  syntax matter as well as mathematics.
- **Fix / action.** Keep the prerequested battery unchanged. Disclose that no
  `using assms` preface is inserted and that original-proof length is only a
  rough proxy. No post-hoc baseline tuning is mixed into these results.


## M4 acceptance

The complete baseline exited 0: 290 rows and 1391 separate kernel checks.
Library: 125/250 (50.0%, Wilson 95% CI 43.8–56.2%); example-derived fresh:
15/40 (37.5%, CI 24.2–53.0%). All 290 per-attempt receipts and corpus annotations
were audited; all other corpus fields match the M1 commit. Re-running the same
baseline produced zero new rows and left every kernel receipt timestamp unchanged.
`python -m eval.harness.report results/tactics` regenerates summary.md exactly.
The full current test suite passed: 79 tests in 59.13 s. Protected directories
have no tracked or untracked changes. Baseline USD token spend is zero; local
CPU costs are not priced. There were 13 timed-out library attempts, retained
in the failure table.

## M5: smoke checks and budget gate

- **What happened.** Smoke acceptance failed three consecutive checks; no real-model smoke was established.
- **Experience.** Missing models/credentials are unavailable measurements, not failed proofs or zero-cost model evidence.
- **Fix / action.** Stop the real-model phase and produce the required partial report from existing data.

Projection uses all allowed attempts, smoke mean token/latency measurements, 3000 additional feedback tokens per retry plus preceding completions, and a 25% wall-time margin. Kernel hours use the M0 median × attempts / workers. An empty schedule projects zero scheduled work; it is not a model estimate.

```json
{
  "smoke_complete": false,
  "proceed_to_full": false,
  "errors": [
    "check 1: ValueError: No configured models for the real-provider smoke run",
    "check 2: ValueError: No configured models for the real-provider smoke run",
    "check 3: ValueError: No configured models for the real-provider smoke run"
  ],
  "dropped": [],
  "before_shrinking": {
    "conditions": [],
    "lemmas": 290,
    "prior_usd_cost": 0,
    "projected_llm_usd": 0.0,
    "projected_total_usd": 0.0,
    "kernel_hours": 0.0,
    "projected_hours": 0.0
  },
  "projection": {
    "conditions": [],
    "lemmas": 290,
    "prior_usd_cost": 0,
    "projected_llm_usd": 0.0,
    "projected_total_usd": 0.0,
    "kernel_hours": 0.0,
    "projected_hours": 0.0
  },
  "max_usd": 25,
  "max_hours": 8,
  "kernel_median_s": 6.998562707998644,
  "samples": {}
}
```

M5 verification: all 80 non-Isabelle tests passed, including the shrinking
order, last-model subsampling, smoke-cost deduction and three-restart bound.
smoke.json contains exactly five lib and five fresh ids. Three preflight
receipts record missing configured models. OPENAI_BASE_URL, OPENAI_API_KEY and
ANTHROPIC_API_KEY were rechecked and remain absent. No provider request or
smoke result row was fabricated. The fixed limits remain USD 25 / eight hours.
M5 real smoke is unavailable; M6 will contain a partial baseline report only.
