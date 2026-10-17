# Isabelle2025-2 protocol spike

Observed on 2026-10-17, macOS arm64, using the installed, unmodified
`~/hack/isabelle-env/Isabelle2025-2.app`.

**Approved M1 approach:** request HTML from the unmodified server and convert it
to plain text in the client. Leo approved this on 2026-10-17 after the original
server-plaintext check exposed the serialization bug documented below.

## Reproduce

From the repository root, the approved M1 check is:

```sh
python3 scripts/lsp_probe.py --isabelle "$HOME/hack/isabelle-env/Isabelle2025-2.app/bin/isabelle" --timeout 30
```

The probe prints the raw notifications and a separate plain-text goal block.
It exits 0 only after recognizing the unfinished `sqrt 2 ∉ ℚ` goal and shutting
down the server cleanly. With `isabelle` on PATH, omit `--isabelle`.

As of M4 the default file is fully proved. The same default position (line 6,
character 4, zero-based) now selects its theorem statement; that command still
has the displayed goal. The M1 transcript below records the earlier placeholder.

To reproduce the original bug, change only the server output mode:

```sh
python3 scripts/lsp_probe.py --isabelle "$HOME/hack/isabelle-env/Isabelle2025-2.app/bin/isabelle" --timeout 30 --server-plaintext
```

That diagnostic exits 1 after the server error and timeout. Both modes shut down
the server with `shutdown` / `exit`. The probe prints all received
JSON messages, including notifications during initialization and shutdown, and
prints the converted goal text separately. Server stderr is inherited.

## Launch options verified with the server

```sh
isabelle vscode_server -n -l HOL \
  -o vscode_html_output=true \
  -o editor_output_state=true
```

- `-n`: skip building the already available session image.
- `-l HOL`: use the installed HOL image.
- `vscode_html_output=true`: returns HTML; the client extracts its text using
  Python's `HTMLParser`. It preserves whitespace inside `pre`, decodes character
  references, and maps `br` to a newline. No HTML is rendered or executed.
- `editor_output_state=true`: needed to expose goal states. The first run omitted
  it: initialization succeeded but no dynamic output arrived within 60 seconds.
- `vscode_html_output=false`: the broken server-plaintext mode, retained only
  as a diagnostic flag in the probe.

`vscode_pide_extensions` was left at its default (`false`). It was not needed for
the `PIDE/dynamic_output` notification. M1 did not verify busy-state notifications
or inline diagnostics; see the M3 findings below.

## Framing and message sequence

Stdio carries UTF-8 JSON-RPC 2.0. Each message is framed as
`Content-Length: <UTF-8 byte count>\r\n\r\n<JSON bytes>`. Count bytes, not characters.
The returned HTML contains literal Unicode symbols.

In the following shapes, `ROOT_URI` and `FILE_URI` stand for the absolute file
URIs of this repository and `examples/Sqrt2.thy`. `SOURCE` is the complete theory
text, encoded as a JSON string. The sample process ID is from the control run.

1. Client request:

   ```json
   {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":57561,"rootUri":"ROOT_URI","capabilities":{},"clientInfo":{"name":"isabelle-revamp-lsp-probe","version":"0.1"}}}
   ```

   The server sends a response with `id: 1` and `result.capabilities`:
   `textDocumentSync: 2`, `hoverProvider: true`, `definitionProvider: true`,
   `documentHighlightProvider: true`, `codeActionProvider: true`, and a
   `completionProvider` object with `resolveProvider: false` and a
   `triggerCharacters` array. Welcome notifications can arrive before the response.

2. After that response, client notification:

   ```json
   {"jsonrpc":"2.0","method":"initialized","params":{}}
   ```

3. Client opens the document:

   ```json
   {"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{"uri":"FILE_URI","languageId":"isabelle","version":1,"text":"SOURCE"}}}
   ```

4. Client places the caret **inside the proof**, on `show ?thesis` immediately
   before `sorry` (editor line 7, column 5):

   ```json
   {"jsonrpc":"2.0","method":"PIDE/caret_update","params":{"uri":"FILE_URI","line":6,"character":4}}
   ```

   Positions are zero-based. The position fields are flat, not nested inside a
   `position` object. This run used ASCII source, so non-ASCII column accounting
   remains to be tested. There is no response ID: output arrives asynchronously.

5. Server output has this envelope:

   ```json
   {"jsonrpc":"2.0","method":"PIDE/dynamic_output","params":{"content":"HTML_STRING"}}
   ```

   `HTML_STRING` begins with `<pre class="source"><span class="state_message">`
   and contains nested `span` and `a` elements. Its visible text is:

   ```text
   proof (prove)
   goal (1 subgoal):
    1. sqrt 2 ∉ ℚ
   ```

   The server returns HTML; the approved client conversion produces this text.
   The observed
   notification has no `uri`, document version, request ID, or `decorations` field.
   Later clients must not assume they can correlate it by a request ID.

6. Shutdown:

   ```json
   {"jsonrpc":"2.0","id":2,"method":"shutdown"}
   {"jsonrpc":"2.0","id":2,"result":"OK"}
   {"jsonrpc":"2.0","method":"exit"}
   ```

   The server then exits 0. Isabelle returns `"OK"`, not `null`.

Other notifications observed:

```json
{"jsonrpc":"2.0","method":"window/logMessage","params":{"type":3,"message":"Welcome to Isabelle/HOL (Isabelle2025-2)"}}
{"jsonrpc":"2.0","method":"window/showMessage","params":{"type":3,"message":"Welcome to Isabelle/HOL (Isabelle2025-2)"}}
{"jsonrpc":"2.0","method":"PIDE/sledgehammer_output","params":{"content":""}}
{"jsonrpc":"2.0","method":"PIDE/sledgehammer_status","params":{"message":"Finished"}}
```

The two Sledgehammer notifications are emitted by the server on shutdown; the
probe never requests Sledgehammer, Nitpick, or any other proof search.

## Plaintext blocker and source explanation

With `editor_output_state=true` and `vscode_html_output=false`, server stderr
reports (the lambda address varies):

```text
*** Session consumer failure: "isabelle.vscode.Dynamic_Output"
*** Bad JSON value: isabelle.vscode.LSP$$$Lambda/0x000000700140cbb0@7b51fb28
```

No goal notification is delivered. The probe times out and exits 1; the server
still answers shutdown normally. This is distinct from a proof error.

The installed reference source explains the observed failure. All paths below
are relative to `Isabelle2025-2.app/src/Tools/VSCode/`:

- `src/pretty_text_panel.scala:62–81` always passes `Some(Decoration(entries))`
  in plaintext mode; the HTML branch at line 60 passes `None`.
- `src/lsp.scala:598–602` constructs `PIDE/dynamic_output` using
  `decorations.map(_.json)`.
- `src/lsp.scala:554–557` defines `Decoration.json(file: JFile)`, which requires
  a file argument. The unapplied method becomes a function, consistent with the
  lambda value rejected by the running JSON serializer.
- `src/language_server.scala:109–110` consults the resources' `editor_output_state`
  option. Explicitly enabling it was necessary in this run, even though session
  startup separately enables the corresponding session option.
- `etc/options:36` declares `vscode_html_output`; `extension/src/lsp.ts:46–68`
  defines the official caret and dynamic-output interfaces.

No distribution files were changed. The client-only HTML-to-text workaround was
approved and implemented. The original wire-level plaintext requirement has
been replaced by plain text at the client boundary; the server bug remains.

## M3: cursor freshness, busy state, and diagnostics

Verified with the unmodified server, then through a real VS Code integration
host. M3 adds `-o vscode_pide_extensions=true` to the M1 launch options.

### Goal output is untagged and deduplicated

`PIDE/dynamic_output` still contains only HTML content. Moving between commands
with identical formatted output need not emit another notification. Clearing the
caret with `PIDE/caret_update` params `{}` emitted empty output in the live probe,
but this is also deduplicated and cannot serve as an unconditional reply barrier.

To avoid treating an old reply as the new cursor's goal, the client uses the
server's built-in state query to confirm each debounced caret selection:

```json
{"jsonrpc":"2.0","method":"PIDE/caret_update","params":{"uri":"FILE_URI","line":6,"character":4}}
{"jsonrpc":"2.0","id":3,"method":"PIDE/state_init","params":{}}
{"jsonrpc":"2.0","id":3,"result":{"state_id":-1}}
{"jsonrpc":"2.0","method":"PIDE/state_output","params":{"id":-1,"content":"HTML_STRING","auto_update":true}}
{"jsonrpc":"2.0","method":"PIDE/state_exit","params":{"id":-1}}
```

The IDs observed were **negative integers** (`-1`, `-2`, `-3`). A state query
does not open a UI panel or invoke proof search; it asks the existing prover for
`print_state`. Its goal text at `show ?thesis` matched the dynamic output:

```text
proof (prove)
goal (1 subgoal):
 1. sqrt 2 ∉ ℚ
```

The extension increments a local generation on cursor/document changes, hides
old text immediately, and sends the caret after 150 ms of quiet. It retires the
previous state ID and ignores its late replies. Notifications received before
the `state_init` response are buffered until their ID is known. Dynamic output
is rendered when it matches the confirmed state; otherwise the tagged state
provides the goal text, including when dynamic output was deduplicated. Error
messages come from diagnostics. The webview receives escaped plain text with
scripts disabled, never executable server HTML.

### Busy decorations are deltas

An in-memory test theory with `ML \<open>OS.Process.sleep (Time.fromReal 2.0)\<close>`
produced this shape while the prover was running:

```json
{"jsonrpc":"2.0","method":"PIDE/decoration","params":{"uri":"FILE_URI","entries":[{"type":"background_running1","content":[{"range":[4,0,4,54]}]},{"type":"text_overview_unprocessed","content":[{"range":[5,0,9,3]},{"range":[11,0,11,3]}]}]}}
```

The example omits other entries from the same notification. Ranges use compact
`[startLine,startCharacter,endLine,endCharacter]` arrays. Subsequent messages
contained the same types with `content: []` when processing finished. Messages
are **deltas**: an omitted type keeps its previous value. The sidebar tracks
`background_running1`, `background_unprocessed1`, `background_canceled`,
`text_overview_running`, and `text_overview_unprocessed` per URI. During pending
cursor work or any of these busy ranges it displays `checking…` without old text.

The client can request a full decoration snapshot using:

```json
{"jsonrpc":"2.0","method":"PIDE/decoration_request","params":{"uri":"FILE_URI"}}
```

The response is another `PIDE/decoration` notification, not a JSON-RPC response.

### Diagnostics distinguish errors from incomplete proofs

Replacing `sorry` with `by simp` produced this actual diagnostic payload (URI
abbreviated; missing severity is intentional):

```json
{"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{"uri":"FILE_URI","diagnostics":[{"jsonrpc":"2.0","range":{"start":{"line":7,"character":7},"end":{"line":7,"character":11}},"message":"Failed to apply initial proof method\\<^here>:\ngoal (1 subgoal):\n 1. sqrt 2 \\<notin> \\<rat>"}]}}
```

The LanguageClient converts it into a VS Code error diagnostic at the correct
range. A correct temporary `(2 :: real) = 2` / `by simp` control emitted
`diagnostics: []` and `No subgoals!`. The real example was left unchanged for M4.

Two traps were reproduced:

- `background_bad` marks `sorry` too; it is **not** a reliable error flag.
  Use actual diagnostics and `text_overview_error` for errors.
- A failed method's state can contain `No subgoals!` from an enclosing proof
  state. Errors take precedence: the sidebar hides that state and shows the
  diagnostic instead. No string match is used to declare a theory checked.

References inside the installed distribution: `src/Tools/VSCode/src/state_panel.scala`
(state query lifecycle), `src/Tools/VSCode/src/lsp.scala` (message shapes),
`src/Tools/VSCode/src/vscode_model.scala` (`publish` deltas), and
`src/Tools/VSCode/src/vscode_resources.scala` (`force_decorations`).

Reproduce the host checks with `bash scripts/check_m3.sh`. This runs the installed
VS Code executable directly so its test exit status is captured; it adds no
framework or downloaded editor. Results are written to `.dev-host/m3-results.json`.

## M4: distinguish an admitted proof from an error

A fresh stdio run on the original M1 placeholder, with M3's launch options,
returned this entry in `PIDE/decoration` (other entries omitted):

```json
{"jsonrpc":"2.0","method":"PIDE/decoration","params":{"uri":"FILE_URI","entries":[{"type":"background_bad","content":[{"range":[7,4,7,9]}]}]}}
```

That exact source range is the `sorry` command. No error diagnostic was emitted;
the dynamic output at that command nevertheless contained `No subgoals!`.
The client keeps these ranges, as decoration deltas, and checks their current
source text for `sorry`. It displays **unfinished (sorry)** for that document
while retaining the cursor's goal. It does not infer admissions from a search
for the word in source: comments, strings and explanatory cartouches are ignored
because they have no corresponding `background_bad` range. Other bad markup is
not reclassified as `sorry`. Busy state and genuine diagnostics/error decorations
keep their existing precedence.

This is a status for admissions in the open document, not a certificate about
the axioms or transitive imports of an arbitrary theory. M4 separately checks
the complete example with `process_theories` and no `sorry` in its source.

## M5: processing observations and local MCP bridge

Before implementation, the [I/Q README's tool list](https://github.com/awslabs/AutoCorrode/blob/main/iq/README.md#mcp-tools)
was read as requested. Its two inspection tools report a file's processing status
and positions of admissions. Our `sorry_positions(file)` uses the M4 observed
marked ranges; `processing_status()` reports all open workspace theory tabs.
Neither calls an invented `PIDE/get_processing_status` method. The stock server
has no I/Q endpoint, and no I/Q plugin is installed.

The M5 stdio probe on the completed example observed `text_keyword2` ranges
`[2,0,2,5]` for the theory's `begin` and `[52,0,52,3]` for `end`. These arrive
alongside the previously verified busy/error/bad ranges. A state query on the
blank line after `end` yielded no proof output; callers should select a theorem
or proof command instead.

The extension invalidates cached completion when a theory's document version
changes. It requires a fresh tagged state response, followed by a full decoration
snapshot for that version, before treating absence of pending ranges as processed.
It continues to consume decoration deltas. The server messages themselves are
still unversioned; the version association and invalidation are client-side.
`goals_at` waits for the annotation snapshot too, so a goal response cannot race
ahead of the current `unfinished (sorry)` status.

`processed` means those pending ranges are empty, not that the proof succeeded.
`fully_checked` additionally requires no diagnostics/error decorations, no
`background_bad`, no marked `sorry` or `oops`, and a closed `begin`/`end` structure
in the server's keyword ranges. This is a conservative status for current editor
buffers, not a general check for axioms/admissions in arbitrary imports. Unknown
versions and inactive edited documents remain pending until a goal query confirms
them. Status aggregation uses actual open editor tabs: `workspace.textDocuments`
was observed to retain closed buffers with unprocessed decorations.

Removing the final theory `end` left running/unprocessed ranges in the live
test. An unfinished theory need not reach a settled, error-free state; it remains
not fully checked. `theory_closed=false` is reported alongside that processing
state instead of assuming that every malformed input will promptly emit an error.

Restoring `end` exposed a second issue: forced snapshots sampled transient
running/unprocessed ranges that later remained stuck in the client's cache. In
`VSCode_Resources.force_decorations` (lines 367–373), `publish_full` returns a
new model but it is not stored, so the forced snapshot does not advance the
normal publication baseline. A normal delta need not clear a transient range
seen only in a forced snapshot. The client therefore requests a fresh full
snapshot every 250 ms while the active theory has pending ranges, and stops
when they clear. This also repairs the sidebar's busy indicator; Isabelle's
distribution remains unchanged.

The first live MCP error check observed an error decoration before its diagnostic
text was available. `errors` therefore returns `has_errors=true, complete=false`
in that interval, rather than treating an empty list as proof of success.

### Local wire format

This is a separate client protocol, not an addition to Isabelle's LSP. The
extension listens on `127.0.0.1:0` and atomically writes JSON `{ "port": PORT,
"token": "RANDOM_TOKEN" }` to `~/.isabelle-revamp/port` with mode `0600`.
The Python server reads it, connects once, and exchanges UTF-8 JSON lines:

```json
{"token":"RANDOM_TOKEN"}
{"ok":true}
{"id":1,"method":"goals_at","params":{"file":"examples/Sqrt2.thy","line":6,"col":4}}
{"id":1,"result":{"file":"ABSOLUTE_PATH","version":1,"line":6,"col":4,"phase":"unfinished","text":"proof (prove)\ngoal (1 subgoal):\n 1. sqrt 2 ∉ ℚ","errors":[]}}
```

The `phase` in this example is from the initial admitted test copy. Responses
contain either `result` or an `error` string and echo the request ID. A second
socket receives `{"error":"An agent is already connected to this extension
instance."}` and closes. Authentication is an internal handshake, not an eighth
MCP tool. Requests are serialized; the Python client uses a 35-second timeout and
never retries edits automatically. Requests are limited to 2 MiB.

The seven methods are exactly `open`, `edit`, `goals_at`, `errors`, `status`,
`sorry_positions`, and `processing_status`. File/range semantics and the complete
result contract are in [mcp/README.md](../mcp/README.md). The Python-facing side is
standard FastMCP stdio, including MCP initialize, tool discovery, and tool calls.
`scripts/check_m5.sh` drives that full route into a real VS Code/Isabelle host;
the host compares received goal text and phase with the sidebar's actual model.

## M6: Unicode presentation and header metadata

A live probe at zero-based line 16, character 4 (`have root_squared`) received
`PIDE/dynamic_output` with the existing `{ "content": HTML }` shape. The square
was encoded literally inside HTML as `<span class="main">⇧2</span>`, not a
`<sup>` element. After stripping tags the goal was `(sqrt 2)⇧2 = 2`. The probe's
original theorem-only success predicate timed out at this different goal; the
notification itself was received and inspected. M6's live editor check verifies
the resulting `(sqrt 2)² = 2` output.

`etc/symbols` assigns `\<^sup>` to U+21E7 (`⇧`) and `\<^sub>` to U+21E9 (`⇩`).
The client copies the distribution's 439 default Unicode assignments and decodes
named escapes in plain diagnostic messages as well as extracted HTML text. It
converts single-character sub/superscripts when Unicode has an equivalent;
unknown/custom symbols and unsupported controls stay verbatim. This is display
conversion only: editor source, coordinates, saved proofs, and Isabelle remain
unchanged. HTML is still stripped and escaped, never inserted from the server.

`goals_at` now also returns `theory` (the active `.thy` basename) and
`checkStatus` (`checking`, `fully_checked`, `unfinished`, or `error`). The latter
uses M5's current-version processing/admission/error/closing-command checks;
it is not inferred from `No subgoals!`. The existing `phase`, `text`, and `errors`
are preserved; goal text and diagnostics now use the Unicode conversion shared
by the sidebar and MCP. No new Isabelle protocol messages are involved.

The view uses VS Code's documented [theme variables](https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content).
Highlighting uses standard [TextMate scopes](https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide),
tested with the installed editor's tokenizer and four built-in themes.

The second-theory header fixture (`lemma "True" by simp`) also showed a position
limit: selecting the final `simp` did not produce a confirmed state, although
`process_theories` checked the file successfully. Moving to the lemma statement
returned `proof (prove)\ngoal (1 subgoal):\n 1. True` and settled the current-version
status. The live header test uses that position. An unavailable cursor state
must not be equated with a failed theory or asserted to be fully checked.

## M7: Swarm cards reuse command decorations

Ran the stock server on `Swarm.thy` with the same M6 options, then sent full-text
`textDocument/didChange` notifications for a correct and an incorrect first step.
No new Isabelle option, proof search, kernel extension, or prover process is
needed for the board. A forced snapshot used the existing notification:

```json
{"method":"PIDE/decoration_request","params":{"uri":"file:///…/Swarm.thy"}}
```

The initial snapshot's `background_bad` ranges were exactly
`[9,4,9,9]`, `[12,4,12,9]`, `[15,4,15,9]`, `[18,4,18,9]`, `[21,4,21,9]`,
and `[24,4,24,9]`, each selecting a literal `sorry`. Replacing the first with
`by simp` removed `[9,4,9,9]` and produced `text_keyword1` range `[9,4,9,6]`
for `by`, alongside `[8,2,8,6]` for `have`. Busy/error ranges were empty after
settling. Replacing it with `by (rule FalseE)` produced `background_bad`
`[9,4,9,6]` and `text_overview_error` `[9,0,9,20]`.

There is no separate `finished` decoration in this server. Its published list
contains command keyword annotations and unprocessed/running/cancelled/error
ranges. `VSCode_Rendering.decorations` constructs that list; `Rendering.background`
and `overview_color` omit pending/error colours for settled successful commands.
M7 requires the existing current-version confirmation/full snapshot, a recognised
command and proof-ending keyword, a structurally closed proof, and no overlapping
pending, bad, admission or error ranges before marking a card green. `also` and
`finally` are standalone chain commands and need no separate proof terminator.
Errors take precedence over admissions within a card. Admissions may appear grey
before a printable cursor goal is available, provided the marked range still
selects literal `sorry` in the current source. Unknown completion stays amber.

The structural lexer ignores strings, nested comments and nested cartouches.
It selects the theorem at the cursor (the first theorem when the cursor is above
it) and collects `have`, `show`, `obtain`, `also`, `finally` at explicit proof
depth one. Nested proofs/brace blocks do not create extra cards. It is a small
client-side structural parser, not a replacement for Isabelle's parser. Source
ranges are recomputed after edits; no theorem is certified by parsing alone.
Cards represent locally checked steps, which can depend on earlier admitted
facts. The header's **kernel-checked ✓** requires the same whole-buffer completion
check as `status()`. If the cursor has no printable proof state, click a card to
obtain the current-version confirmation; absence of a cursor state is not success.

### Two named clients

M7 intentionally supersedes M5's single-connection limit. The authenticated
loopback bridge allows two persistent connections and refuses a third. The
Python tool handler reads the actual MCP initialization metadata via
`get_context().session.client_params.client_info.name` (FastMCP 4.1.0 and its
installed MCP SDK), and sends it outside tool arguments:

```json
{"id":1,"method":"open","params":{"file":"examples/Swarm.thy"},"client_name":"claude-code"}
```

The first request binds a display name to that socket. Claude/Codex names are
normalised; unknown names are bounded, displayed as text, and never used for
authentication. The token handshake is unchanged. The seven MCP tool names and
argument shapes are unchanged. The use of request context follows the
[FastMCP context API](https://gofastmcp.com/servers/context).

Operations from both sockets run in one queue. Each socket remembers versions
returned by `open` and successful edits. `edit` refuses a changed buffer before
applying its range, asking that client to read again. This handles line shifts
without adding a tool argument or silently rebasing an agent's edit. Card IDs
are captured before a successful edit; those cards carry that socket's name
for ten seconds. Edits rejected before reaching the editor do not claim a card.

The live test starts two real FastMCP clients with `Implementation` names
`claude-code` and `codex-mcp-client`; both labels appeared on different cards,
a stale second-client edit was refused, and the six-card completed proof matched
whole-theory completion. The test clients submit fixed proofs; no model inference
or actual Claude/Codex CLI session is claimed by this automated check.

## M8 — Claude Code stream and Ask lifecycle (2026-10-17)

The installed `claude --version` reports **2.1.236 (Claude Code)**. We read
`claude --help`, `claude mcp --help` and `claude mcp get --help`, then ran a real
print-mode probe. `claude mcp get isabelle` reports registration separately from
connection health: an existing local registration returned exit 0 and
`Status: ✘ Failed to connect` while the extension was closed. An absent name
returned exit 1 with `No MCP server named "isabelle-missing-m8". Configured servers: isabelle`.
No registration or global settings were changed.

Actual print-mode requirement, tested without `--verbose`:

```text
Error: When using --print, --output-format=stream-json requires --verbose
```

Ask launches the installed executable with an argument array, without a shell:

```text
claude -p --output-format stream-json --verbose --include-partial-messages
  --tools ""
  --allowedTools mcp__isabelle__open mcp__isabelle__edit mcp__isabelle__goals_at
    mcp__isabelle__errors mcp__isabelle__status mcp__isabelle__sorry_positions
    mcp__isabelle__processing_status
  --permission-mode dontAsk --strict-mcp-config --mcp-config <JSON>
  --disable-slash-commands --settings '{"disableAllHooks":true}'
  --no-session-persistence --system-prompt <fixed preamble and coordinate guidance>
```

The user's text is written to stdin and stdin closes. This also avoids the
variadic `--mcp-config` option consuming a trailing positional prompt as a
configuration filename. The preamble names the absolute active theory path and
**one-based** cursor line, then explains that MCP uses **zero-based UTF-16**
positions. It requests structured Isar, current diagnostics/status after edits,
and an explicit fully-checked or stuck outcome. Explanation requests inspect
errors without editing. The host retains the visible theory when focus enters
the webview. Later messages include the session's earlier user/assistant text as
context; each run reads the current editor buffer anew.

Built-in tools are disabled with `--tools ""`; the explicit seven MCP permissions
avoid an interactive permission prompt. Skills and hooks are disabled for this
child. `--strict-mcp-config` limits discovery to the bundled `isabelle` server:
`mcp/.venv/bin/python mcp/server.py --port-file <this bridge's discovery file>`.
It is passed as JSON after verifying the user's existing `isabelle` registration
in the workspace root. This routes edits to the correct extension window and
loads no other MCP servers. It does not install/register anything, bypass all
permissions, or call a model HTTP API from the extension. Claude uses its own
installed authentication and model selection.

Observed stream: newline-delimited JSON, UTF-8. This is **not** Content-Length
framing. A real minimal response included the following shapes (extra metadata
omitted):

```json
{"type":"system","subtype":"init","tools":[],"mcp_servers":[]}
{"type":"stream_event","event":{"type":"message_start","message":{"id":"msg_...","content":[]}}}
{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Stream ready."}}}
{"type":"assistant","message":{"id":"msg_...","content":[{"type":"text","text":"Stream ready."}]}}
{"type":"result","subtype":"success","is_error":false,"result":"Stream ready.","permission_denials":[]}
```

Text deltas update a retained transcript item immediately. Complete assistant
messages reconcile pending text blocks within their message ID instead of
duplicating them. Tool-use blocks are keyed by their `id`; their `name` and decoded `input`
produce one-line labels. Partial `input_json_delta.partial_json` fragments are
assembled before displaying coordinates. `edit Demo.thy 7:4–9:10` and
`goals_at 12:6` deliberately use the MCP's zero-based coordinates. Tool results,
thinking, credentials and raw protocol metadata are not dumped into the panel.
`result.is_error`, permission denials, malformed JSON and nonzero exit without
completion produce transcript notices. Split UTF-8 code points/JSON records
are handled across stdout chunks; a record is limited to 2 MiB.

One request owns the child through preflight, streaming and termination. Stop
signals the child's process group on macOS/Linux, including its MCP subprocess,
then escalates to SIGKILL after 1.5 seconds. The application under test is macOS;
Windows currently uses Node's direct-child `kill` fallback. The ten-minute timer
includes preflight. Submitted edits remain in VS Code; Stop never rolls them
back and never signals the independent Isabelle language server. A second
request is refused until the child closes. Deactivation also stops the child.

Goals now uses a nonce-restricted persistent webview. Goal and transcript updates
are separate `postMessage` messages and render through `textContent`; they never
replace the textarea, draft or transcript DOM. The webview saves only its draft
with VS Code's webview state; the extension holds the transcript for the window's
extension session. Reloading the extension starts a new transcript.

The first real `prove this` acceptance run exercised the tool path as well:
`open`, `sorry_positions`, another `open`, `edit Demo.thy 10:0–15:9`,
`goals_at 14:2`, `errors`, `status`. The decoded stream yielded one item per tool
and the final `fully_checked: true` reply without duplicated text. Actual MCP
edits showed **Claude** badges and all three cards became green. The independent
board completion flag, not Claude's prose, supplied the acceptance assertion.

A second real stream probe explained why `TrueI` fails on an arithmetic equality.
It exposed a subtle block-index mismatch: Claude emitted `content_block_start`
for **thinking at index 0**, an `assistant` message containing only that thinking
block, then **text at index 1**, followed by another `assistant` message with the
same message ID whose `content` array contained **only the text block** (array
index 0). The complete-block message arrived before `content_block_stop`.
Matching array indices therefore duplicated a long final reply. The decoder now
reconciles pending text blocks in order within each message ID; thinking remains
undisplayed. Replaying that captured real stream produces exactly one answer,
and the deterministic subprocess fixture includes this observed sequence.

## M9 A — display symbols, unchanged source

`isabelle getenv -b ISABELLE_HOME` returns the installed distribution directory.
At activation we read its `etc/symbols` lines (`\<name> ... code: 0x...`), retaining
only valid Unicode assignments. The bundled M6 table is an offline fallback,
with an Output warning if the installed table cannot be read.

Editor decorations cover the original ASCII range with
`textDecoration: 'none; display: none'`; `before.contentText` supplies Unicode
with `display: inline`. Ranges use `ClosedClosed`. A caret inside the range, or
any selection overlapping it (including Find), reveals its original spelling.
No document edits or coordinate translation occur. Single-character powers with
a Unicode superscript are display replacements; multi-character powers remain
literal. Goals and tile labels additionally space a sum binder with U+2009.

Reference: Isabelle's `src/Tools/VSCode/extension/src/script_decorations.ts`
uses hidden decorations for formatting controls. We use the requested
before-content pattern for symbol names. The `.source` class follows
`etc/isabelle.css`, with VS Code theme fonts/colours instead of fixed colours.
`vscode_unicode_symbols_edits=false` explicitly keeps server completions ASCII;
`src/Tools/VSCode/src/vscode_rendering.scala` reads this option for completion
replacement text. Completion inside quoted formulae needs stock VS Code's
`editor.quickSuggestions.strings` enabled; language defaults now enable it and
`editor.tabCompletion` for Isabelle only.

Observed in stock VS Code (`vscode.executeCompletionItemProvider` and
`editor.action.triggerSuggest` / `acceptSelectedSuggestion`): typing `\Sum`
at line 1, columns 7–11 returned a single completion with label/insertText
`\<Sum>`, filterText `\Sum`, detail `\<Sum> (symbol "∑")`, and a text edit
replacing exactly `[1,7,1,11]` with `\<Sum>`. The accepted document contains
ASCII, not `∑`. The receipt is `.dev-host/m9a-completion.json`.
