# Headless evaluation notes

## Decisions taken unattended

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
- **What happened.** Five checks take 6.999, 7.061, 6.968, 6.967, 7.094 seconds
  (rounded); median 6.999 seconds. Hardware reports six CPUs and 8 GiB RAM.
- **Experience.** Process startup dominates this trivial proof.
- **Fix / action.** Keep the fallback configuration at one worker on this small
  machine; project kernel time from the measured median. Batch corpus validation
  may share startup, but evaluation attempts must remain separate checks.
- **Check.** M0 passed: twelve recorded checks, expected exit codes
  `[0,1,1,0]` for the four Swarm configurations, three failing error fixtures,
  five successful timing runs, and the median recorded above. No Isabelle files
  or protected source directories were changed.
