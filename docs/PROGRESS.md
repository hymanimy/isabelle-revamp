# Progress

## 2026-10-17 — M1 initial attempt: blocked by plaintext serialization

- **Passed:** repository and branch verified (`hymanimy/isabelle-revamp`, `leo`,
  initially clean). Added a standard-library Python stdio probe and a `Complex_Main`
  theory with one `sorry`. Live initialize / initialized / didOpen / caret_update
  works. The HTML control returns the expected `sqrt 2 ∉ ℚ` goal through
  `PIDE/dynamic_output`, and clean shutdown returns `"OK"` with server exit 0.
- **Did not pass:** plaintext goal output. With `vscode_html_output=false` and
  `editor_output_state=true`, the server reports `Bad JSON value` in its dynamic
  output consumer. The strict probe exits 1 on timeout. M1 remains incomplete;
  M2–M6 have not started. The theorem still contains the intentional M1 `sorry`.
- **Discovered:** goal output needs `editor_output_state=true`; the plaintext
  decoration serializer appears to pass a function into JSON. Exact messages,
  reproduction commands, control output, and source references are in
  [PROTOCOL_NOTES.md](PROTOCOL_NOTES.md). No Isabelle files were modified.
- **Tooling:** Node v26.8.2 and Python 3.13.15 are available. Stock VS Code 1.138.0
  arm64 is installed, but `code` and `isabelle` are absent from this tool shell's
  PATH. Explicit executable paths work. Isabelle required approved execution
  outside the sandbox because its runtime directory and `sysctl` were blocked.
- **Would do differently:** make the proof-state option explicit from the first
  run and compare HTML/plaintext early, so a server serialization failure is not
  confused with document-loading delay.
- **Next decision:** allow a client HTML-to-text adapter while keeping Isabelle
  unchanged, or retain the strict server-plaintext requirement and remain blocked.
  The HTML control is diagnostic evidence, not a replacement acceptance check.

## 2026-10-17 — M1 passed with approved client conversion

- **Passed:** the live probe requested `vscode_html_output=true`, received
  `PIDE/dynamic_output`, and printed `proof (prove)`, `goal (1 subgoal):`, and
  `1. sqrt 2 ∉ ℚ` as plain text. Shutdown returned `"OK"`; the probe exited 0.
- **Discovered:** the HTML contains nested inline markup but already preserves
  proof whitespace. A small standard-library `HTMLParser` adapter is sufficient;
  Isabelle remains unchanged. Leo explicitly approved this replacement for the
  original server-plaintext requirement. `--server-plaintext` retains the bug
  reproduction, and PAINPOINTS entry 9 records the exact option and error.
- **Would do differently:** separate the wire format from the displayed text in
  the initial acceptance criterion. Keep the raw protocol transcript alongside
  converted output so the distinction stays observable.
- **Next:** M2, the stock VS Code extension skeleton and its live host check.

## 2026-10-17 — M2 implemented; visual acceptance pending

- **Changed:** added the TypeScript extension, the `isabelle` language for `.thy`,
  a TextMate grammar covering all 24 requested keywords and common escaped/Unicode
  symbols, and a stdio LanguageClient using M1's verified options. Added workspace
  executable configuration, an F5 launch task, a lockfile, and a short root README.
  Minimal startup is adapted from the official extension and cited in
  `extension/THIRD_PARTY_NOTICES.md`. No goals sidebar or MCP work has started.
- **Passed:** `npm run compile --prefix extension`; installed dependencies report
  no vulnerabilities. Stock VS Code's bundled TextMate/Oniguruma engine tokenized
  `Sqrt2.thy` and passed checks for every requested keyword, escaped symbols inside
  quoted terms, Unicode symbols, and nested comments/cartouches. The live stock
  VS Code 1.138.0 Extension Development Host activated the extension on
  `onLanguage:isabelle`. Its actual Isabelle Output log contains:

  ```text
  2026-10-17 09:20:17.886 [info] Starting /Users/leo/hack/isabelle-env/Isabelle2025-2.app/bin/isabelle vscode_server -n -l HOL -o vscode_html_output=true -o editor_output_state=true
  2026-10-17 09:20:23.776 [info] Welcome to Isabelle/HOL (Isabelle2025-2)
  2026-10-17 09:20:23.916 [info] Isabelle language server ready (HOL).
  ```

  No Isabelle-channel or extension activation errors were recorded. Test-host
  state and logs live under ignored `.dev-host/`, not global VS Code settings.
- **Discovered:** current `vscode-languageclient` 10.1.2 expects a
  `LogOutputChannel`; TypeScript 7 needs explicit `node`/`vscode` type inclusion.
  Both were fixed before the live run. The installed distribution's original
  extension uses an older client API and a custom encoding; this skeleton uses
  current `await client.start()` and ordinary UTF-8 in stock VS Code.
- **Still pending:** direct visual confirmation of colored syntax and the Output
  panel. Computer Use twice returned `Computer Use was not approved to use Code`.
  The host is open with `Sqrt2.thy`; logs and token tests do not substitute for the
  requested visual check. M2 is not yet marked passed, and M3 has not started.
- **Would do differently:** check app-access availability before scheduling visual
  acceptance; compile against the selected client version before launching a host.
- **Next:** enable Code access for the visual check, or have Leo confirm that the
  open development window shows colored Isar and the ready line in **Output →
  Isabelle**. Then record M2 as passed and commit that milestone result.

## 2026-10-17 — M2 visual retry: access still blocked

- **Checked:** branch remains `leo`; retried the screen tool as requested. App
  inventory confirms Code is running, but selecting it immediately returns
  `Computer Use was not approved to use Code`. No visual acceptance evidence was
  obtained, and no extension code changed.
- **Discovered:** the tool explicitly forbids observing the Codex and Terminal
  apps for safety reasons, so the agent cannot watch their approval dialogs.
- **Would do differently:** distinguish an immediate access denial from a pending
  approval; repeating the call does not establish that a prompt reached the user.
- **Next:** ask Leo whether a Code approval prompt appeared on his side. M2's
  visual check remains pending; M3 has not started.
