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
