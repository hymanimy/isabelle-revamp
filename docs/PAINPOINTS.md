# Pain points: getting Isabelle working from zero

Logged live during setup on 17 Oct 2026, macOS (Apple Silicon). The point of this
hackathon is that a mathematician or physicist should not have to hit any of these.
Each entry: what happened, what a non-engineer would have experienced, what the fix
should be.

## 1. The official download link is dead for CLI users

- **What happened.** `curl -LO https://isabelle.in.tum.de/dist/Isabelle2025-2_macos.tar.gz`
  followed a redirect to `dist.isabelle.cit.tum.de` on port 80, which never answered.
  curl saved a 372-byte redirect page under the tarball's name, then hung 75 s and gave
  `(28) Couldn't connect to server`.
- **Experience.** The headline download button on the project homepage does not work.
  The error names a server you've never heard of. The failure isn't obvious: a file
  with the right name exists, it's just 372 bytes of HTML.
- **Fix needed.** One download URL that works, over HTTPS, with a checksum published
  next to it. A mirror list is not a fix; a user shouldn't have to know mirrors exist.
- **Workaround used.** Cambridge mirror:
  `curl -L -C - -o Isabelle2025-2_macos.tar.gz https://www.cl.cam.ac.uk/research/hvg/Isabelle/dist/Isabelle2025-2_macos.tar.gz`

## 2. A failed step cascades into noise

- **What happened.** Three commands were pasted together. When the download failed, `tar`
  and `xattr` ran anyway and printed seven more errors, including `xattr: No such file:
  Gatekeeper` because it tried to treat a trailing comment as filenames.
- **Experience.** One real problem, eight error lines. Impossible to tell which one matters.
- **Fix needed.** Not Isabelle's fault, but a real install script should stop at the
  first failure and say one sentence about it. Our extension's setup command should do
  exactly that.

## 3. The distribution is 1.65 GB, but that's the right trade

- **What happened.** Download at ~3 MB/s: 8 min 14 s. `isabelle build -b HOL` then took
  2 seconds, because the macOS bundle ships the HOL heap prebuilt.
- **Experience.** Nine minutes with nothing to look at, then everything works. Correction
  to the first version of this entry: there is no 20-minute build; the size is partly
  because the heaps are included. That is the same choice Lean's Mathlib cache makes.
- **Fix needed.** Say so on the download page ("includes prebuilt HOL, ready to use"),
  and show progress during unpack. Nothing structural.

## 4. There is no obvious way to check a file from the command line

- **What happened.** Every tutorial says `isabelle process -T Smoke`. In 2025-2 that
  prints `Unknown Isabelle tool: "process"`. The replacement is `process_theories`.
  Finding the right invocation took five attempts:
  `-d .` (wants a ROOT file), bare `Smoke` (looks in a temp dir), `./Smoke.thy`
  (malformed import), `-?` (zsh eats it), then `process_theories -D . -O Smoke`.
- **Experience.** A tool with 25 subcommands, none named "check", and the one you
  need has a flag whose lowercase twin means something else. A mathematician stops here.
- **Fix needed.** `isabelle check FILE.thy` that does the obvious thing. Our extension's
  "check this file" command and the MCP `submit_proof` tool are that, in effect.

## 5. You have to know a backend exists at all

- **What happened.** Leo's own question mid-install: "why do I need Isabelle installed?"
- **Experience.** The user wanted an editor that checks proofs; the fact that a 1.65 GB
  interpreter is a separate thing is an implementation detail they shouldn't meet.
- **Fix needed.** A "Set up Isabelle" button in the extension on first open, the way the
  Lean extension installs `elan`. Or, as discussed, a hosted check endpoint so a first
  try needs no install at all.

## 6. Installed commands are missing from the editor's tool shell

- **What happened.** `node --version` returned v26.8.2 and `python3 --version`
  returned 3.13.15, but `code` and `isabelle` both returned `command not found`.
  Both apps are installed. VS Code's bundled CLI returned 1.138.0, arm64; invoking
  Isabelle's bundled executable worked too.
- **Experience.** Setup worked in one terminal, then appears broken in another.
  The user cannot tell whether to reinstall or change a setting.
- **Fix needed.** Accept an explicit Isabelle executable path and report the path
  actually used. Explain how to locate VS Code's CLI without requiring a reinstall.
- **Workaround used.** Explicit executable paths; no global PATH configuration
  changes. The probe accepts `--isabelle`.

## 7. Sandboxing blocks startup before any proof is checked

- **What happened.** Isabelle first failed to create `~/.isabelle` in the sandbox.
  After approved runtime access, the sandboxed probe's initialize request failed
  with `sysctl: sysctl fmt -1 1024 1: Operation not permitted`. Running the probe
  outside the sandbox with approval allowed initialization to complete.
- **Experience.** An operating-system error appears where a proof state should be.
  It gives no indication that the theory itself has not been checked yet.
- **Fix needed.** Distinguish server startup failures from proof errors and show
  the exact failing operation. Keep permission prompts tied to observed failures.

## 8. A running server can still show no proof state

- **What happened.** The server initialized and accepted the document and caret,
  but sent no dynamic output for 60 seconds. The resources' `editor_output_state`
  option defaults to false. Adding `-o editor_output_state=true` enabled the goal
  output path (and exposed the separate serialization failure below).
- **Experience.** A welcome message says the prover is ready, but the goals pane
  would stay blank with no explanation.
- **Fix needed.** Set the proof-state option explicitly in our client, and use a
  known unfinished goal as the startup acceptance check.

## 9. Plaintext goals fail inside the bundled server

- **What happened.** With `-o vscode_html_output=false -o editor_output_state=true`,
  server stderr reports this exact error (the generated lambda address varies):

  ```text
  *** Session consumer failure: "isabelle.vscode.Dynamic_Output"
  *** Bad JSON value: isabelle.vscode.LSP$$$Lambda/0x000000700140cbb0@7b51fb28
  ```

  The installed source's dynamic
  output serializer passes an unapplied decoration method into JSON. With only
  the HTML option changed to true, the same probe receives the expected sqrt 2
  goal. Exact protocol evidence is in [PROTOCOL_NOTES.md](PROTOCOL_NOTES.md).
- **Experience.** A documented format switch silently breaks the goals pane;
  the useful error is outside the normal JSON notification stream.
- **Fix needed.** The upstream serializer needs to emit decoration data rather
  than a function.
- **Workaround used.** With Leo's approval, request `-o vscode_html_output=true`
  and convert the HTML to plain text in our client. Python's standard-library
  `HTMLParser` removes markup, decodes entities, and preserves the preformatted
  line breaks. No Isabelle files were modified.

## 10. Current client tooling differs from the bundled example

- **What happened.** The first M2 compilation with current dependencies reported
  that `OutputChannel` lacks the properties of `LogOutputChannel`, and that
  `node:os` could not be found despite installed Node type declarations. The
  distribution's extension uses an older LanguageClient API.
- **Experience.** Copying the official startup pattern and installing its modern
  dependency sounds sufficient, but produces unrelated-looking type errors before
  a theory can be opened.
- **Fix needed.** Ship a lockfile and a tested compile task. Use
  `createOutputChannel('Isabelle', { log: true })` and explicitly include `node`
  and `vscode` types in this project's compiler configuration. Both fixes are in M2.

## 11. Visual acceptance needs separate app access

- **What happened.** M2 compiled and started Isabelle in a real stock VS Code
  Extension Development Host, but the UI tool returned the exact message
  `Computer Use was not approved to use Code` when asked to inspect the window.
  Retrying at Leo's explicit request returned the same immediate denial. Attempts
  to watch the approval dialog also returned `Computer Use is not allowed to use
  the app 'com.openai.codex' for safety reasons.` and the same message for
  `'com.apple.Terminal'`. The tool did not expose a pending approval to the agent.
- **Experience.** The editor is running and its logs say the server is ready,
  yet the agent cannot verify what the mathematician actually sees.
- **Fix needed.** Enable Code access for Computer Use, or complete the visual
  check manually: `Sqrt2.thy` has colored Isar keywords and **Output → Isabelle**
  shows `Isabelle language server ready (HOL).` This is a test-environment
  permission issue, not a theorem error or an Isabelle installation failure.
