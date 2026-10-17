You are working in this repository (hymanimy/isabelle-revamp) on the branch `leo`,
which is already checked out. The repo contains only docs/. Commit after every
milestone with a one-line message naming it. Never force-push.

## Environment (already verified, do not re-derive)
- Isabelle2025-2 is installed at ~/hack/isabelle-env/Isabelle2025-2.app and `isabelle`
  is on PATH. `isabelle version` prints Isabelle2025-2.
- The HOL heap is prebuilt. `isabelle build -b HOL` returns in seconds.
- To check a theory file from the command line (the old `isabelle process` is gone):
    isabelle process_theories -D <dir> -O <TheoryName>
  Verified: in a dir containing Smoke.thy, `isabelle process_theories -D . -O Smoke`
  prints the theorem and exits 0.
- `isabelle vscode_server` exists. `isabelle vscode_server '-?'` prints its options
  (quote the `-?`, zsh expands it bare).
- Node 20+, Python 3.11+, VS Code with `code` on PATH are expected; verify, don't assume.

## Goal
Isabelle/HOL working inside stock VS Code the way Lean does: type an Isar proof in a
.thy file, it is checked live, and a sidebar shows the goal state at the cursor. On top
of that, an MCP server so an AI agent can see the same goal state and submit proofs.
The v0.1 demo is one theory file proving sqrt 2 is irrational, with the sidebar visibly
updating as the proof is written.

## Hard rules
- Do NOT modify Isabelle: no kernel, HOL, Isar syntax or distribution changes. We are a
  client of `isabelle vscode_server`. Reference source is inside the distribution:
  `find ~/hack/isabelle-env/Isabelle2025-2.app -path '*Tools/VSCode*' -maxdepth 6`.
- No Sledgehammer, Nitpick or other extras in v0.1.
- One milestone at a time. Stop at each stopping condition, run the check, commit.
  Do not start milestone N+1 until N passes.
- Discover protocol details by running Isabelle, never by guessing. Record what you
  find in docs/PROTOCOL_NOTES.md.
- Whenever setup, tooling or documentation makes a step harder than it should be for a
  mathematician, add an entry to docs/PAINPOINTS.md in the existing format
  (what happened / experience / fix needed). This log is part of the deliverable.
- Small, readable code. No frameworks beyond those named below.

## Layout to create
  extension/            VS Code extension (TypeScript, vscode-languageclient)
  mcp/                  Python MCP server (FastMCP), talks to the extension over a local socket
  examples/Sqrt2.thy    the demo theory
  scripts/lsp_probe.py  throwaway LSP client for M1
  docs/PROTOCOL_NOTES.md, docs/PROGRESS.md, docs/DEMO.md
  README.md             run the demo in under 5 minutes

## Milestones

### M1 — LSP spike
scripts/lsp_probe.py: start `isabelle vscode_server` as a subprocess over stdio, speak
JSON-RPC with Content-Length framing, send initialize / initialized, textDocument/didOpen
for examples/Sqrt2.thy (first write a version with the theorem statement and `sorry`),
then Isabelle's custom `PIDE/caret_update` notification with a position inside the
proof. Print every notification the server sends. Identify the one carrying the
goal/output state (expected `PIDE/dynamic_output`) and the server option that makes it
plain text rather than HTML (look for something like vscode_html_output; pass as -o).
STOP WHEN: the probe prints the goal state for the open `sorry` as plain text in the
terminal. Commit the probe and PROTOCOL_NOTES.md with exact message names and shapes.

### M2 — Extension skeleton
extension/: package.json contributing the `isabelle` language for *.thy, a TextMate
grammar for the core Isar keywords (theory, imports, begin, end, lemma, theorem, proof,
qed, by, have, show, from, then, hence, thus, obtain, assume, fix, using, unfolding,
also, finally, sorry, oops) and the common Isabelle symbols, and a LanguageClient that
launches `isabelle vscode_server` with the options found in M1. Use the official
extension source as reference; copy the minimum needed and cite the file.
STOP WHEN: opening examples/Sqrt2.thy in the Extension Development Host shows syntax
highlighting and the server starts without error in the Output panel.

### M3 — Goals sidebar
WebviewView "Isabelle Goals". On cursor move in a .thy file (debounced ~150 ms) send
PIDE/caret_update; on PIDE/dynamic_output render the text in a monospace block. Show a
"checking…" line while the server is busy so stale state is never shown as current.
Render diagnostics inline in the editor.
STOP WHEN: moving the cursor through Sqrt2.thy updates the sidebar; replacing `sorry`
with a wrong tactic shows the error; the correct proof shows no subgoals.

### M4 — Demo proof
Complete examples/Sqrt2.thy: sqrt 2 is irrational, in readable Isar (not one `by`
line), importing Complex_Main. Each intermediate `have` must give a different visible
goal state so the sidebar demo is interesting. Must check with zero `sorry`.
STOP WHEN: `isabelle process_theories -D examples -O Sqrt2` exits 0, and docs/DEMO.md
has the five-step click path for the demo.

### M5 — MCP server
The extension opens a localhost TCP socket (random free port, written to
~/.isabelle-revamp/port) serving a tiny JSON protocol. mcp/server.py (FastMCP, stdio)
connects and exposes exactly:
  open(file), edit(file, start_line, start_col, end_line, end_col, text),
  goals_at(file, line, col), errors(file), status()
goals_at returns the same plain text the sidebar shows. mcp/README.md has the one-line
config to register the server with Codex and with Claude Code. One agent per extension
instance; refuse a second connection.
STOP WHEN: with the extension running, an agent calling goals_at on Sqrt2.thy gets the
same text as the sidebar, and after editing `sorry` into the real proof, status()
reports the theory fully checked.

### M6 — Polish (only after M1–M5 are committed)
Theme-aware sidebar, Isabelle symbols rendered as Unicode, header with theory name and
check status. Nothing else.

## Reporting
At each stop, add a short section to docs/PROGRESS.md: what passed, what you had to
discover, what you'd do differently. If blocked for more than ~30 minutes on one
thing, log the blocker in PROGRESS.md and move to the next thing that doesn't depend
on it.
