# Isabelle MCP

An MCP server that lets an agent such as Claude Code work in the same Isabelle
session as you: read theories, see goals, edit, and check. It exposes seven
tools and never launches a second prover; it forwards each call to the VS Code
window running the extension.

The server is `extension/src/mcpServer.ts`, bundled into `out/mcpServer.js`. It
runs on the Node.js built into VS Code (`ELECTRON_RUN_AS_NODE=1`), so neither
Node nor Python needs to be installed.

## Register with Claude Code

Run **Isabelle: Register MCP Server with Claude Code** from the command palette.
It registers the server for all your projects (`--scope user`) and replaces any
earlier `isabelle` registration, including a project-local one. After an
extension update moves the bundled server, the extension re-registers it
automatically. Restart running Claude Code sessions afterwards.

The command runs the equivalent of (paths for your install are printed by
**Isabelle Revamp: Setup check**):

```sh
claude mcp add --scope user isabelle -e ELECTRON_RUN_AS_NODE=1 -- <VS Code binary> <extension>/out/mcpServer.js
```

Other MCP clients can start the same command with the same environment variable,
for example `codex mcp add isabelle --env ELECTRON_RUN_AS_NODE=1 -- <VS Code binary> <extension>/out/mcpServer.js`.

The server connects on the first tool call, not at startup, so a registration
for all projects is harmless in projects without Isabelle.

## Which VS Code window

Every VS Code window running the extension publishes a discovery file in
`~/.isabelle-revamp/windows/` with its bridge port, a random token and its
workspace folders. The MCP server uses the window whose workspace folder most
closely contains the directory the agent was started in, or the only window if
there is just one. With several windows and none matching, tools report which
windows exist. Start the agent in the theory project's folder, for example from
VS Code's integrated terminal.

## Development

`npm run compile --prefix extension` writes an unbundled `out/mcpServer.js` that
loads its dependencies from `extension/node_modules`; `npm run build` replaces it
with the bundle. Register the development copy with the command above, using
`extension/out/mcpServer.js` from this checkout, or run
**Isabelle: Register MCP Server with Claude Code** in the development host.
Reload the window after changing bridge code; the MCP server reconnects on the
next call.

## Tools and coordinates

Paths may be absolute or relative to the first workspace folder. Files must
already exist, end in `.thy`, and resolve inside an open workspace folder, even
through symlinks. All positions use **zero-based lines and UTF-16 columns**;
range ends are exclusive. A BMP symbol uses one column; an emoji uses two.

| Tool | Result and behavior |
| --- | --- |
| `open(file)` | Returns the file's current `text`, `version`, and `saved` flag as VS Code holds it, including unsaved user edits. Does not open a tab or move the user's cursor. |
| `edit(file, start_line, start_col, end_line, end_col, text)` | Replaces the range through VS Code, saves the buffer, and returns its new version/status. Uses the editor's undo history. A stale client version is rejected; read with `open` immediately before editing. |
| `goals_at(file, line, col)` | Waits up to 30 seconds until Isabelle has checked up to a proof command and its output has settled. Returns Unicode `text` (the proof state plus messages such as try0 suggestions), `phase`, diagnostics of that command, the file/version/position, `theory` and `checkStatus`. Does not move the user's cursor. |
| `errors(file)` | Returns error messages/ranges, `has_errors`, and `complete`. `complete=false` means an empty or partial list is inconclusive. |
| `status()` | Returns per-file checking/error/unfinished/fully_checked states and an aggregate `fully_checked` flag, for the theories open in the user's tabs plus those this client has read or edited. |
| `sorry_positions(file)` | Returns server-marked `[start_line,start_col,end_line,end_col]` ranges and a `complete` flag. Comments and strings containing the word are ignored. |
| `processing_status()` | Returns per-file `known`, `processed`, `processing`, version, and pending ranges; the top-level `processing` flag is true if any open theory is pending. |

`sorry_positions` and `processing_status` follow the purposes of I/Q's `get_sorry_positions` and
`get_processing_status`, read before implementation in the
[AutoCorrode I/Q tool list](https://github.com/awslabs/AutoCorrode/blob/main/iq/README.md#mcp-tools).
Our parameter-free processing query lists those same theories rather than accepting
I/Q's file argument. We do not load I/Q or modify Isabelle.

## Agent workflow

1. Call `open` to read the current buffer, then `goals_at` on the theorem or a
   `have` command. Blank lines, the final `end`, and a completed top-level `by`
   tactic need not return a proof state. Queries never move the user's cursor;
   while one runs, the user's Goals panel waits for it.
2. Use `sorry_positions` for the exact admitted command ranges. If `complete`
   is false, obtain a goal for that document version and poll
   `processing_status`.
3. Read `open` again, recompute the range, and submit an edit. Then poll
   processing and inspect `errors` and `status`.
   **unfinished (sorry)** is distinct from an error. `No subgoals!` alone is not
   completion: an admitted or failed command can also produce that text.
4. Check the target file's `fully_checked` and `saved` fields. The aggregate is
   true only when every listed theory passes. No theories means
   `fully_checked=false`.

Isabelle checks only near the user's cursor, like Isabelle/jEdit. `status`,
`errors`, `sorry_positions` and `processing_status` therefore check each theory
in full first, for a bounded time per call; checking progress is kept between
calls, so poll until `complete` or `fully_checked`.

Completion is conservative: a fresh goal query and full decoration snapshot
must confirm the current version; there must be no pending work, errors, bad
markup, `sorry` or `oops`, and the server-highlighted theory `begin`/`end`
structure must close. Editing a theory invalidates cached completion, including
potential dependents. An inactive edited file remains unknown until queried
again. This describes the submitted editor buffers, not a certificate about
axioms or admissions in arbitrary imported libraries.

`edit` saves the whole current buffer, including existing unsaved edits. It does
not retry on network failure. If a response is lost, read the buffer before
retrying: the edit may already have applied. Editing the document while
`goals_at` waits makes that query fail explicitly.

Editor operations from all clients run one at a time. Each connection remembers
the version returned by its last `open` or successful `edit`; a change by
another client or by hand invalidates that version. A stale edit returns
`The buffer changed since this client last read it. Call open and recompute the edit range.`

Each edit is briefly highlighted in the editor with the client's name, taken
from MCP initialization's self-reported client name. This is display metadata,
not authentication; the connection token remains the local authentication
mechanism.

## Verify end to end

```sh
npm run test:integration --prefix extension -- mcp,agentEdits
```

This starts the bundled server the way Claude Code does and drives all seven
tools through the MCP SDK's client against VS Code and Isabelle: it replaces a
`sorry` with a complete proof in a disposable copy of the sqrt-2 fixture, and
checks goals, messages, completion, errors, processing, authentication and file
boundaries. Receipts are in `.dev-host/m5-results.json`.
Profiles and discovery files stay under `.dev-host/` during tests.

The bridge binds only to `127.0.0.1` on a random port. Discovery files are JSON,
written with mode `0600` in a `0700` directory; each window removes its own file
on exit, and files of windows that crashed are removed when next read. The MCP
server authenticates with the token automatically; no extra tool is exposed.
For an isolated instance, set `ISABELLE_REVAMP_PORT_FILE` to the same path for
VS Code and the MCP server; both then use only that file. Treat the bridge as
local access under your OS account, not as a sandbox for untrusted proof text or
ML commands.
