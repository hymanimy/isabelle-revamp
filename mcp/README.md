# Isabelle MCP

The Python stdio server connects to the running VS Code extension. It exposes
exactly seven tools, uses FastMCP 4.1.0, and never launches a second prover.

From the repository root, install once:

```sh
python3 -m venv mcp/.venv
mcp/.venv/bin/python -m pip install -r mcp/requirements.txt
```

Use Python 3.11+. Start the extension with **F5**, open `examples/Sqrt2.thy`, and
run **Isabelle: Show Goals**. For an existing development window, compile and
run **Developer: Reload Window**. **Output → Isabelle** should report the MCP
bridge ready. Its discovery file is `~/.isabelle-revamp/port`.

Register with either client, running the corresponding one-line command from
the repository root (the commands store absolute paths):

```sh
codex mcp add isabelle -- "$PWD/mcp/.venv/bin/python" "$PWD/mcp/server.py"
```

```sh
claude mcp add --transport stdio --scope local isabelle -- "$PWD/mcp/.venv/bin/python" "$PWD/mcp/server.py"
```

These forms were checked against the installed CLI help and the official
[Codex MCP documentation](https://developers.openai.com/codex/mcp) and
[Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).
Registration is left to you; the test runner does not change client configuration.
For **Isabelle: Ask**, Claude Code must also be signed in and on VS Code's PATH.
Ask checks `claude mcp get isabelle` from the workspace root, then supplies the
bundled server and this extension's discovery file explicitly to that child.
It changes no registration and allows only these seven tools; a run occupies
one of the two client slots. See [the Ask demo](../docs/DEMO.md#ask-isabelle).
M7 supports two simultaneous clients; a third connection is refused. Each client
runs its own stdio server and shares the extension's prover. Restart the MCP
connections after reloading the extension.

## Tools and coordinates

Paths may be absolute or relative to the first workspace folder. Files must
already exist, end in `.thy`, and resolve inside an open workspace folder, even
through symlinks. All positions use **zero-based lines and UTF-16 columns**;
range ends are exclusive. A BMP symbol uses one column; an emoji uses two.

| Tool | Result and behavior |
| --- | --- |
| `open(file)` | Opens the editor and returns its current `text`, `version`, and `saved` flag. Includes unsaved user edits. |
| `edit(file, start_line, start_col, end_line, end_col, text)` | Replaces the range through VS Code, saves the buffer, and returns its new version/status. Uses the editor's undo history. A stale client version is rejected; read with `open` immediately before editing. |
| `goals_at(file, line, col)` | Moves the visible cursor to a proof command and waits up to 30 seconds. Returns Unicode `text` identical to the sidebar, plus `phase`, diagnostics, the file/version/position, `theory` and `checkStatus`. |
| `errors(file)` | Returns error messages/ranges, `has_errors`, and `complete`. `complete=false` means an empty or partial list is inconclusive. |
| `status()` | Returns per-file checking/error/unfinished/fully_checked states and an aggregate `fully_checked` flag for all open theory tabs. |
| `sorry_positions(file)` | Returns server-marked `[start_line,start_col,end_line,end_col]` ranges and a `complete` flag. Comments and strings containing the word are ignored. |
| `processing_status()` | Returns per-file `known`, `processed`, `processing`, version, and pending ranges; the top-level `processing` flag is true if any open theory is pending. |

The last two tools follow the purposes of I/Q's `get_sorry_positions` and
`get_processing_status`, read before implementation in the
[AutoCorrode I/Q tool list](https://github.com/awslabs/AutoCorrode/blob/main/iq/README.md#mcp-tools).
Our parameter-free processing query lists open theory tabs rather than accepting
I/Q's file argument. We do not load I/Q or modify Isabelle.

## Agent workflow

1. Call `open` to read the current buffer, then `goals_at` on the theorem or a
   `have` command. Blank lines, the final `end`, and a completed top-level `by`
   tactic need not return a proof state. The sidebar follows this same cursor.
2. Use `sorry_positions` to find admitted steps. If its list is incomplete,
   first obtain a goal for that document version and poll `processing_status`.
3. Read `open` again, recompute the range, and submit an edit. Then poll
   processing and inspect `errors` and `status`.
   **unfinished (sorry)** is distinct from an error. `No subgoals!` alone is not
   completion: an admitted or failed command can also produce that text.
4. Check the target file's `fully_checked` and `saved` fields. The aggregate is
   true only when every open theory tab passes; closing a tab removes it from
   that aggregate. No tabs means `fully_checked=false`.

Completion is conservative: a fresh goal query and full decoration snapshot
must confirm the current version; there must be no pending work, errors, bad
markup, `sorry` or `oops`, and the server-highlighted theory `begin`/`end`
structure must close. Editing a theory invalidates cached completion, including
potential dependents. An inactive edited file remains unknown until queried
again. This describes the submitted editor buffers, not a certificate about
axioms or admissions in arbitrary imported libraries.

`edit` saves the whole current buffer, including existing unsaved edits. It does
not retry on network failure. If a response is lost, read the buffer before
retrying: the edit may already have applied. A user moving the cursor or editing
the document while `goals_at` waits causes that query to fail explicitly.

Editor operations from both clients are serialized. Each connection remembers
the version returned by its last `open` or successful `edit`; a change by the
other client or by hand invalidates that version. A stale edit returns
`The buffer changed since this client last read it. Call open and recompute the edit range.`
The seven tool signatures remain unchanged.

**Isabelle Swarm** tags edited cards for ten seconds using MCP initialization's
client name (normalised to Claude/Codex for those clients). This is self-reported
display metadata, not authentication. The connection token remains the local
authentication mechanism. See [SWARM_PROMPT.md](../docs/SWARM_PROMPT.md) for the demo.

## Verify end to end

```sh
bash scripts/check_m5.sh
```

This uses the installed VS Code application and Isabelle, runs M3/M4 regressions,
then drives all seven tools through a real FastMCP stdio client. It compares
goals with the actual sidebar model, replaces a `sorry` with the complete M4
proof in a disposable Sqrt2 copy, and checks completion, errors, processing,
connection refusal, and file boundaries. The real example remains unchanged.
Receipts are in `.dev-host/m5-results.json`. Profiles and discovery files stay
under `.dev-host/` during tests. Pass another VS Code application executable as
the script's first argument if needed.

`bash scripts/check_m7.sh` also kernel-checks the committed odd-sum reference and
tests six live cards, manual/error/processing transitions, clicks, two named
clients, stale-edit refusal, card-by-card completion and tag expiry. It includes
M3–M6 regressions. No language model is invoked by the test.

The bridge binds only to `127.0.0.1` on a random port. The discovery file is JSON
containing the port and a random connection token, written with mode `0600`.
The Python bridge authenticates automatically; no extra MCP tool is exposed.
The most recently started extension window owns discovery. Existing connections
stay with their original window; cleanup never removes another window's file.
For an isolated instance, set `ISABELLE_REVAMP_PORT_FILE` on VS Code and pass the
same path to `mcp/server.py --port-file PATH`. Treat the bridge as local access
under your OS account, not as a sandbox for untrusted proof text or ML commands.
