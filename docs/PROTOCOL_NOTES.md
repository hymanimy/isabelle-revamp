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

## M10.6 — library navigation protection

Observed `isabelle getenv -b ISABELLE_HOME ISABELLE_HOME_USER` returns one
absolute path per line: the app directory and `~/.isabelle/Isabelle2025-2`.
The read-only patterns cover the app and the parent `~/.isabelle` directory.
VS Code's `files.readonlyInclude` is a pattern-to-boolean object, set at
workspace scope only. Existing values (including explicit false overrides)
are preserved. No filesystem permissions or Isabelle distribution files change.
`vscode.executeDefinitionProvider` on the type `real` returns the installed
`src/HOL/Real.thy`. `TextEditor.edit` is a trusted API and bypasses the editor's
read-only policy; it is unsuitable as a typing-lock test. The host acceptance
uses the `type` command with auto-save off and verifies the buffer and disk.

## M10.4 — theme scopes from existing decorations

The grammar uses standard `keyword.control`, `keyword.operator`, `string.quoted`,
`comment.block`, `constant.character.escape`, and `constant.numeric` scopes.
Additional ordinary Isar commands (including case/next/with) use keyword scopes.
The existing PIDE decoration cache supplies `text_free`, `text_bound`,
`text_skolem`, `text_tfree`, `text_tvar`, `text_var`. These become document
semantic tokens with standard TextMate fallback scopes (`variable.other`,
`variable.parameter`, `variable.other.constant`, `entity.name.type`). No new
server requests or syntactic guesses about bound variables are needed.
Only annotations confirmed for the current document version are exposed.

Reference: Isabelle `src/Tools/VSCode/extension/src/decorations.ts`, `text_colors`.
Workspace token colour recommendations cover built-in light/dark/high-contrast
families. Custom themes retain their own standard-scope palette.

## M10.1 — Unicode transport, ASCII source and abbreviations

A live stdio probe ran `vscode_server -n -l HOL` with `vscode_html_output=true`,
`editor_output_state=true`, `vscode_pide_extensions=true`,
`vscode_unicode_symbols_output=true`, `vscode_unicode_symbols_edits=true`.
The last two options are now explicit in the extension. Completion for
`\noteq` returned `label: "≠"`, `filterText: "\\noteq"`, and
`textEdit: {range:{start:{line:1,character:7},end:{line:1,character:13}},newText:"≠"}`.
The client encodes insertion text (including resolved/additional edits) back to
`\<noteq>` without changing that range. MCP insertions use the same encoding.

`PIDE/abbrevs_request` is a **notification without params**, not a JSON-RPC
request. The response notification is `PIDE/abbrevs_response` with
`{abbrevs:[[input,replacement],...]}`. HOL returned 20 session entries, including
`["hence","then have"]`, `["thus","then show"]`, and
`["\\tag","✐‹tag \u0007›"]`; U+0007 is a cursor placeholder, converted to a
VS Code snippet tabstop. Empty replacements are not offered. Crucially, this
response does **not** contain the base symbol abbreviations: `~=` / `==>` / `!!`
and named `\noteq` come from installed `etc/symbols` entries plus their names.
The completion provider combines both authoritative sources.

The small `Entry`/`Symbols` catalogue is ported from the official
`src/Tools/VSCode/extension/src/symbol.ts` (Makarius). That implementation reads
font JSON via `ISABELLE_VSCODIUM_RESOURCES`; stock VS Code has no such bundled
resource. We load the same symbol/code/abbrev data from the installed table.
Glyph decorations remain on ASCII ranges, reveal at the cursor/selection, and
honour `prettySymbols`. `unicodeOnSave` defaults false: a save participant
encodes recognised pasted Unicode symbols in workspace theories. Explicit true
decodes symbol spellings on save. This opt-in changes saved source and therefore
its subsequent columns; display-only mode and ordinary completion do not.
Raw receipts: `.dev-host/m10-abbrevs.json`, `m10-raw-completion.json`.

## M10.2 — script controls on ASCII source

`scriptDecorations.ts` ports the hiding and relative font-size/position rules
from Isabelle's `src/Tools/VSCode/extension/src/script_decorations.ts` (Denis
Paluca). The original scans single decoded characters; this client scans
Isabelle symbol tokens with original UTF-16 offsets. Single sub/sup/bold controls
apply to one following non-whitespace symbol; bsub/esub and bsup/esup delimit
balanced blocks. Both encoded and decoded forms use the installed symbol table.
Malformed controls stay visible. A selected control reveals its source and
suspends that group's formatting. No document edits occur. Generic glyph
replacements exclude hidden controls so an extra ⇧/⇩ is not drawn.

## M10.3 — coloured goal HTML

A live probe at Sqrt2's square step returned `<pre class="source">` containing
nested `state_message`, `text_fold`, `keyword1`, `subgoal`, `notation`, `typing`,
`main`, and `const` spans. The exponent arrived as literal `⇧2` inside
`<span class="main">`; a surrounding anchor pointed to `Power.thy#26`.
This is actual server output, not text with colours inferred from spelling.
Receipt: `.dev-host/m10-goal-source.html`.

The sidebar reconstructs only `span`, `a`, `pre`, `br` and validated class names.
Source attributes never pass through; scripts/styles/embedded content are
removed, other tag wrappers dropped, and decoded text is escaped anew.
Control tokens are interpreted across text nodes, rendered with generated
sup/sub/bold span classes. CSS class names follow `etc/isabelle.css`, using
VS Code light/dark colours. Tagged state confirmation still gates rich output:
stale/unfinished processing hides it, and actual errors clear the goal.
`outputText.ts` remains the plain-text path; `goals_at` explicitly omits HTML.
Entity link routing is the later item 8, not enabled by raw href attributes.

## M10.7 — cartouches

The installed symbol table supplies `abbrev: <<` for `\<open>` and `abbrev: >>`
for `\<close>`; they use item 1's completion provider and ASCII persistence.
Language configuration auto-closes both glyph and ASCII forms, including nested
cartouches outside comments. The selection command requires one complete quoted
string, decodes ordinary quote/backslash and ASCII numeric escapes, checks
balanced embedded cartouches, and replaces only the selected range with ASCII
`\<open>...\<close>`. It performs no background conversion of examples.
Live acceptance exposed an ambiguity in the installed table: `<<` also expands
to `\<guillemotleft>`. Cartouche entries now have the first sort key and
`preselect: true`; other choices remain available. The same applies to `>>`.

## M10.8 — definition links and editor hover

Observed HTML links include
`file:/.../src/HOL/NthRoot.thy#397` for `sqrt` and
`file:/.../src/HOL/Power.thy#26` for the power operator. The fragment is a
**one-based line**, not a character offset or range. No hover body accompanies
these anchors. Reference: `src/Tools/VSCode/src/pretty_text_panel.scala` builds
links from `Position.Def_File` and `Position.Def_Line`.

The allowlist extracts valid local file/line targets into a host-side table and
renders only generated link classes on the anchor; raw href/event attributes
never reach the webview. A monotonically increasing goal revision binds click
and hover messages to that table. Ctrl/Cmd-click resolves canonical paths within
the workspace or Isabelle libraries, opens the file, and selects the entity name
when unique on the indicated line. Otherwise it reveals the line without
claiming a server-supplied column. `vscode.executeHoverProvider` at the same
position supplies the tooltip; code-fence presentation is converted to text.
Stale hover results are discarded. HTTP, command, remote file, query-string,
invalid-line, and out-of-root targets are inert/refused.

## M11 — packaging and installed startup

- VS Code 1.138.0, Node 26.8.2, npm 11.19.1 and Python 3.13.15 were observed.
  Build dependencies are pinned to `@vscode/vsce` 4.0.0 and esbuild 0.28.2.
  The extension still targets `@types/vscode` 1.104.0 / engine `^1.104.0`.
- Followed the official [bundling guide](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
  and [packaging guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension):
  type-check separately, bundle Node/CommonJS with only `vscode` external,
  ship dependency licenses, and allowlist VSIX files. `vsce.dependencies=false`
  suppresses dependency walking; `vsce.packagePath=../dist` applies to direct
  `npx vsce package` as well as `npm run package`.
- `isabelle build -n -l HOL` exited 0 on the installed HOL heap. Setup check uses
  that exact dry-run command, not a guessed heap path. Executable discovery is
  setting → PATH → `/Applications/Isabelle*/bin/isabelle` →
  `~/hack/isabelle-env/Isabelle*/bin/isabelle` → `~/Isabelle*/bin/isabelle`.
- Ask's explicit MCP config now uses `command: "python3"`, arguments
  `[<absolute installed extension>/mcp/launch.py, "--port-file", <this window's file>]`.
  The launcher creates an isolated sibling `.venv` on first use; installation
  output goes to stderr, then `exec` starts the bundled `server.py`. The seven
  MCP tools and Claude stream/permission flags are unchanged.
- `--extensionTestsPath` without `--extensionDevelopmentPath` did not execute
  the API harness or activate the installed extension in that attempted test
  launch. The API harness was instead run against the installed extension path;
  then both test flags were omitted for the separate regular-window MCP check.
  The latter returned `proof (prove)`, one subgoal `(sqrt 2)² = 2`, and fully
  checked status. No development host remained running during that check.
- VS Code adds installation metadata to `package.json`; shipped manifest values,
  JavaScript bundle and bundled MCP source were checked against the final VSIX.

## M12 — recursive proof graph and whole-document perspective

No new Isabelle request or prover code is involved. Nodes come from the existing
Isar lexer, recursively tracking `proof`/`qed`, cases and brace scopes. Quoted
terms, cartouches and nested comments stay opaque. Named fact use and implicit
chaining supply directed edges; parent links separately describe proof nesting.
A conclusion has an edge to the obligation it discharges. Case assumptions flow
to their uses, avoiding a spurious cycle back into the case. This is a source
explanation, not a kernel dependency certificate.

The first live Cascade test exposed `vscode_caret_perspective`'s default of 50:
with the cursor on line 1, `processing_status` kept unprocessed ranges from
line 52 onwards; moving it to the theorem moved that boundary by nine lines.
The installed `src/Tools/VSCode/etc/options` documents `0` as unrestricted;
`src/Tools/VSCode/src/vscode_model.scala:110` implements the whole visible
model's range in that mode. Launch now includes `-o vscode_caret_perspective=0`.
The rerun produced all 52 annotated nodes and all 38 open leaves. This is needed
for honest whole-theory completion, rather than treating out-of-view work as done.

`PIDE/state_init` at a theory header does not supply a proof-state confirmation.
Opening the graph outside a theorem selects the nearest theorem first. The
same tagged state and full-decoration/version gate as Goals/MCP is retained.
Graph focus retains the open source tab; MCP edits preserve graph focus while
moving the source cursor and querying its state. Closing the source tab still
invalidates Ask context.

`proof_graph(file)` is the eighth MCP tool. Its response includes `file`, `uri`,
`version`, `theory`, `complete`, `fully_checked`, `proved`, `total`, `elapsed`
(milliseconds), `nodes` and `edges`. Each node has `id`, `name`, `statement`,
`command`, `status`, a four-integer zero-based UTF-16 `range`, `parent` (null for
a theorem), and an optional ten-second `agent` display tag. Edge entries have
`from`, `to`, and `kind` (`fact`, `implicit`, or `nesting`). The tool is read-only;
unknown or stale annotation versions cannot certify green nodes. Root completion
uses the same `fully_checked` decision as `status()`.

The editor tab uses bundled `@dagrejs/dagre` 3.1.1 and graphlib 4.0.5, with no CDN
or webview network access. Layout runs per visible node set; status updates use
SVG classes and CSS transforms. Nested layouts place consumers above their
prerequisites; arrows retain the logical prerequisite → consumer direction.
Replay consumes locally recorded status frames at 8× and issues no prover calls.
`workbench.action.maximizeEditorHideSidebar` targets the editor group; maximizing
the bottom panel would instead enlarge the terminal/Output surface.

The first 200-node SVG timing receipt had one missed frame during repeated fold
layout. Dagre now runs only on source topology changes; folds filter cached
positions and remove empty containers, keeping remaining targets stationary.
The focused receipt recorded 194 frames at a 16.7 ms baseline, a 17.7 ms maximum
gap, 200 pulses and zero missed intervals; status-only updates ran zero layouts.
The check counts an animation-frame interval over 1.8× the measured baseline as
missed, records visibility/reduced-motion settings, and reports the raw timing.

On macOS, an occluded Electron window can report the webview as hidden and
suspend animation frames ([Electron BrowserWindow documentation](https://www.electronjs.org/docs/latest/api/browser-window)).
The timing harness therefore launches its isolated test window with
`--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`
and `--disable-background-timer-throttling`, following the
[Chrome tooling flags](https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md).
These are test-process flags, not extension or global settings. Logical fold
completion uses a coalesced timer, and replay catches up overdue frames without
waiting on a separate throttled zero-delay timer for each one. The production
extension keeps normal OS background behavior.

## M12 named-step amendment: line anchors and read-only goal previews

The graph now projects source structure onto the theorem/lemma and explicitly
named outer `have`, `show`, and `obtain` commands. `obtain x :: nat where fact:`
is named by `fact`, never by its typed witness `x`. Nested proof commands and
unnamed chains affect their enclosing node's status, with dependencies projected
onto named owners. `proof_graph` adds one-based `line` while retaining zero-based
UTF-16 `range`; it uses exactly the ids displayed by the webview.

Live goal-preview experiment (stock Isabelle2025-2, `check_m12.sh`):

1. Pause the existing Goals panel with notification
   `PIDE/state_auto_update`, `{"id":<panel id>,"enabled":false}`.
2. Send `PIDE/caret_update` with the hovered node's existing ASCII coordinates,
   then request `PIDE/state_init`, `{}`. Its response is `{"state_id":<id>}`.
3. Pin the new panel with `PIDE/state_auto_update`,
   `{"id":<new id>,"enabled":false}`. Keep the temporary server caret until
   its tagged output arrives: restoring it before output races the dispatcher.
4. Read `PIDE/state_output` for that new id, convert its HTML to plain text, then
   release it with `PIDE/state_exit`, `{"id":<new id>}`. Restore the live caret
   and resume the existing panel with `enabled:true`.

The reduction tile returned its actual one-subgoal state including `coprime`;
the editor selection, source, document version, and original Goals text stayed
unchanged. Preview setup and ordinary goal queries share a short serialization
queue. Preview replies never certify a document version. Results are cached
only for that document version and node. Reference: distribution
`src/Tools/VSCode/src/state_panel.scala` and `lsp.scala` (`State_Auto_Update`).

## M13 bottom panel

`contributes.viewsContainers.panel` hosts Ask (`isabelleRevamp.ask`) and the
amended graph (`isabelleRevamp.proofGraph`) together. The editor-tab renderer
remains available through **Open in editor column**; both surfaces receive the
same model and recorded timeline. Demo Layout uses existing VS Code commands
`workbench.action.joinAllGroups`, `workbench.action.positionPanelBottom`,
`workbench.action.alignPanelJustify`, `workbench.action.closeSidebar`, and
`workbench.action.closeAuxiliaryBar`. It preserves source tabs and unsaved text.
No global configuration or proposed VS Code API is needed.

## M13b — isolated Demo profile

Verified stock VS Code 1.138.0 CLI: `--user-data-dir`, `--extensions-dir`,
`--profile Demo`, `--install-extension <vsix> --force`, `--list-extensions`,
`--sync off`, `--new-window`, `--skip-welcome`, `--skip-release-notes`.
`code` was absent from this shell PATH, so setup uses the official app CLI at
`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code` when needed.

Despite the launch flag creating a missing profile, combining it directly with
extension installation returned `Profile 'Demo' not found.` A real blank launch
created this record in the dedicated data directory's
`User/globalStorage/storage.json`:

```json
{"userDataProfiles":[{"location":"-18a1adae","name":"Demo"}]}
```

The profile's files lived under `User/profiles/-18a1adae/`. Seeding the same
record with private location `demo`, before opening Code, allowed the normal
CLI to install into that profile successfully. The script confines this
version-sensitive bootstrap to `~/hack/demo/.demo/user-data`; updates preserve
existing profile metadata and settings and refuse an active `SingletonLock`.
Application-scoped settings also live in this isolated directory's Default
settings file; the normal VS Code data directory is never edited.

The printed launch command sets `ISABELLE_REVAMP_PORT_FILE` only for the new
process, under `.demo/port`. Project MCP registration points at that instance
and its installed bundled launcher. A real regular-window first launch returned
Sqrt2 version 1, all thirteen named nodes proved, saved, zero errors/admissions,
and `fully_checked=true`. Its main log reports
`update#disable - updates are disabled by user preference`.

References: [VS Code CLI](https://code.visualstudio.com/docs/configure/command-line)
and [profiles](https://code.visualstudio.com/docs/configure/profiles). These
public options are preferred; the one profile-registry bootstrap is explicitly
covered by the real CLI installation check because its format is internal.

On the installed Claude Code 2.1.236, `claude mcp get isabelle` in the new Demo
folder reports `Scope: Project config (shared via .mcp.json)` and `Status: ⏸
Pending approval (run claude to approve)`. The actual existing Ask invocation
uses an explicit `--strict-mcp-config`/`--mcp-config` and tool allowlist; a real
read-only run successfully called `status` and reported Sqrt2 fully checked.
The plain interactive registration status is therefore not being presented as
an approval receipt, and setup does not rewrite global Claude configuration.
[Claude's project approval documentation](https://code.claude.com/docs/en/mcp#project-server-approvals-and-workspace-trust)
describes the separate interactive project trust mechanism.

## M14 — explicit refutation names and admitted batch fixtures

No new PIDE request or prover service is used. The existing current-version
command/finish decorations, pending ranges, diagnostics and admission ranges
establish acceptance of the complete counter-lemma range. The presentation
convention pairs exact top-level names `X` and `X_refuted`; it does not infer
mathematical negation from text. Both are independent source roots, with
unchanged one-based line labels and zero-based UTF-16 ranges.

`proof_graph(file)` adds status `refuted` and edge kind `refutation`:

```json
{"from":"sqrt4_irrational_refuted","to":"sqrt4_irrational","kind":"refutation"}
```

The edge is present while both declarations exist, including before acceptance,
so recolouring never triggers layout. Only an accepted current-version
counter-lemma turns the original red. An admitted/error/pending counter-proof
cannot do so. Removing or invalidating it retracts the state. Ordinary theorem
roots retain the fully-checked-document rule; an accepted matching counter-lemma
is the explicit exception while the original admission remains. The status bar
and graph header say `refuted · kernel ✓`; `status().fully_checked` remains false
and `errors()` can be empty. The graph therefore never calls the false theorem
proved or the file admission-free.

Experiment with Isabelle2025-2 `process_theories -D examples/card -O Sqrt4`:
exit 1, `*** Cheating requires quick_and_dirty mode!`, at the original `sorry`.
The tool's `-?` output offers `-o OPTION`; the distribution's `etc/options`
declares `quick_and_dirty` false by default. Running the combined original and
independent counter-lemma with `-o quick_and_dirty=true` exits 0 with exactly
one admission. Running `Sqrt4_solution` (only the independent counter-lemma)
with default options also exits 0. The live test repeats the strict check on
Claude's actual extracted lemma; no original admitted fact is available there.

The installed `claude --help` offers `--effort <level>` (low, medium, high,
xhigh, max). Ask now passes `--effort low` for its small incremental requests,
while retaining the existing eight-tool allowlist and Claude-only backend.
This is a per-child flag; no global Claude settings change. Its preamble
requests an independent structured counter-lemma after the original, no changes
to that theorem, no prose argument, and errors/status/graph checks before the
one-sentence report. It permits stopping at `refuted` even though the deliberately
unchanged admission prevents `fully_checked`.


## Proof Graph demo revision — names, replay and clocks

No Isabelle wire message changes. `proof_graph` now projects every explicitly
named nested `have`/`show`/`obtain` as well as the theorem and named outer
steps. It retains source-derived ids, parents, one-based `line` and zero-based
UTF-16 ranges. Unnamed commands remain in their named owner's acceptance range.
Four formerly unnamed parity commands in `examples/Sqrt2.thy` were named to
make the requested 17-node fixture; `Swarm.thy` still has seven nodes. The
protected `demo/` copies and Ask's outer-obligation admission summary were not
changed. This revises the earlier compact nested-node projection described above.

A PIDE update can accept multiple nodes at once; it provides no ordering within
that batch. The replay timeline preserves inter-update order and orders ties by
nesting depth (children first), then source line. It expands batched transitions
with at least 400 ms between greens at ×1, scaled once by the selected speed.
Default ×2 is a presentation choice, not an Isabelle processing speed. Actual
webview delivery is also paced so a delayed frame does not cause a catch-up
burst. The node/edge pulse remains 400 ms at every speed.

The host gives each file-open/switch or new Ask run a fresh clock epoch and
recording. The webview cancels an old replay when that epoch changes. The clock
stops when the existing document check says `fully_checked`, or an accepted
counter-lemma establishes the existing refutation state. The optional fold
control affects presentation only; MCP retains every graph node.
