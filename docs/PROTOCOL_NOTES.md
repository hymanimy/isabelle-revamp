# Isabelle2025-2 protocol spike

Observed on 2026-10-17, macOS arm64, using the installed, unmodified
`~/hack/isabelle-env/Isabelle2025-2.app`.

**M1 is blocked, not passed.** Initialization and caret-driven goal output work,
but the server's plaintext output path fails during JSON serialization. An HTML
control run returns the expected goal. No client conversion has been implemented.

## Reproduce

From the repository root, the strict M1 check is:

```sh
python3 scripts/lsp_probe.py --isabelle "$HOME/hack/isabelle-env/Isabelle2025-2.app/bin/isabelle" --timeout 30
```

It exits 1 after the server reports the serialization failure below and the probe
times out. With `isabelle` on PATH, omit `--isabelle`.

The diagnostic control changes only the HTML option:

```sh
python3 scripts/lsp_probe.py --isabelle "$HOME/hack/isabelle-env/Isabelle2025-2.app/bin/isabelle" --timeout 30 --html-control
```

The control exits 0 and prints `CONTROL ONLY`; that is **not** an M1 pass. Both
runs shut down the server with `shutdown` / `exit`. The probe prints all received
JSON messages, including notifications during initialization and shutdown, and
prints dynamic output's literal content separately. Server stderr is inherited.

## Launch options verified with the server

```sh
isabelle vscode_server -n -l HOL \
  -o vscode_html_output=false \
  -o editor_output_state=true
```

- `-n`: skip building the already available session image.
- `-l HOL`: use the installed HOL image.
- `vscode_html_output=false`: selects plaintext plus decorations. This path fails
  in this distribution; do not describe it as working.
- `editor_output_state=true`: needed to expose goal states. The first run omitted
  it: initialization succeeded but no dynamic output arrived within 60 seconds.
- `vscode_html_output=true`: the successful diagnostic control, returning HTML.

`vscode_pide_extensions` was left at its default (`false`). It was not needed for
the HTML `PIDE/dynamic_output` notification. Busy-state notifications and inline
diagnostics have not been verified by this spike.

## Framing and message sequence

Stdio carries UTF-8 JSON-RPC 2.0. Each message is framed as
`Content-Length: <UTF-8 byte count>\r\n\r\n<JSON bytes>`. Count bytes, not characters.
The control's returned HTML contains literal Unicode symbols.

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

5. Server output in the **HTML control** has this envelope:

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

   This text was contained in HTML, **not received as plaintext**. The observed
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

No distribution files were changed. A possible client-only workaround is to ask
for HTML and extract its text while preserving line breaks. That would change
M1's explicit requirement that the **server** return plaintext, so it needs a
scope decision before implementation. M2 has not started.
