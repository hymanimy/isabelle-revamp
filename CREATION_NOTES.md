# Creation notes

Things learned while building the extension that are not obvious from the code.

## Why results appeared later than in jEdit: `vscode_output_delay`

Isabelle checks a theory incrementally: as each command finishes, the prover's
results (errors, the running/finished colouring, proof states) change. The
VS Code server (`isabelle vscode_server`) does not forward each change. Every change
restarts a timer, and only when the timer runs out with no further change does the
server send everything new to the editor in one batch:

- diagnostics (squiggles and the Problems list),
- decorations (command status colours and semantic highlighting), for the whole file,
- the output at the caret (the Goals panel).

The timer length is the Isabelle system option `vscode_output_delay`, 0.5 s by
default (`etc/options`). Because the timer restarts on every change, the editor
waits for a gap in the results, not a fixed beat. Even a `by simp` that the
prover finishes almost instantly takes about a second to show.

jEdit has the same mechanism, `editor_output_delay`, but at 0.1 s. It can afford
that: jEdit runs in the same JVM as the prover, so an update is a repaint of the
visible text. The VS Code server converts the prover's markup into LSP messages,
builds decorations for the whole file and serialises everything as JSON over a pipe,
so each batch is far more expensive, and its authors chose a conservative delay.

The opposite direction is `vscode_input_delay` (0.1 s): edits and caret moves are
batched before they reach the prover.

### Measurement

The measurement drove `vscode_server` directly over LSP. Each run made 12 edits,
each changing a numeral in one lemma and moving the caret there. Latency is the
median time from an edit to the new result arriving at the caret.

| Theory | 0.5 s (Isabelle default) | 0.2 s | 0.1 s |
|---|---|---|---|
| 20 lemmas | 1154 ms | 215–253 ms | 216–253 ms |
| 300 lemmas | 530–653 ms | 280 ms | — |
| 3000 lemmas | 1026 ms | 1068 ms | 564–1204 ms |

On the 3000-lemma theory, the cost of 12 edits was:

| | 0.5 s | 0.2 s | 0.1 s |
|---|---|---|---|
| Server CPU | 21.9 s | 25.4 s | 33–35 s |
| Traffic to the editor | 26 KiB | 627 KiB | 8–13 MiB |

- **Small and medium theories:** latency is bounded by the delay. 0.2 s is 2–5×
  quicker than the default, and 0.1 s gains nothing more.
- **Large theories:** latency is about 1 s whatever the delay. The bottleneck there
  is the server rebuilding whole-file decorations on every batch, which only a
  server change would fix.
- **0.1 s on large theories:** traffic explodes. In one run, the initial check of the
  3000-lemma theory never went quiet, so the benchmark hit its 10-minute limit.

### Decision

The extension starts the server with `vscode_output_delay=0.2`, setting
`isabelleRevamp.outputDelay`. Its own waits for output to settle (the Goals panel's
message grace and the agent tools' pause between checks) scale with it. If very
large theories misbehave, raise the setting back towards 0.5.

### A side effect: stale forced snapshots

With the shorter delay, a test began to fail now and then: a theory stayed
"checking" forever although Isabelle had finished. The extension sometimes asks
for a full decoration snapshot (`PIDE/decoration_request`), for example when a proof
state arrives. The server may build it from an outdated document snapshot, and it
does not update its own record of what the editor was last sent. If the forced
snapshot catches a command mid-run, the server never reports that command finished,
because from its side nothing changed. This was always possible; more frequent
output made it likelier. The extension now asks again once output settles, until
two snapshots agree.
