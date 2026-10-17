# Progress

## 2026-10-17 — M1 LSP spike: blocked by plaintext serialization

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
