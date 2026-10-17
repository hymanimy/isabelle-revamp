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

## 2026-10-17 — M2 passed with Leo's visual confirmation

- **Passed:** Leo confirmed that the visual check passed in the development host.
  Together with the recorded compile, grammar, and live startup checks, this
  satisfies M2's stopping condition.
- **Discovered:** user-observed visual evidence resolved the screen-tool access
  blocker; no new code changes were needed.
- **Would do differently:** use a short manual acceptance check when app access
  is unavailable, clearly attributing the result to the person who observed it.
- **Next:** M3, the goals sidebar with cursor updates, checking state, and errors.

## 2026-10-17 — M3 implemented; live automated checks passed

- **Changed:** added the **Isabelle Goals** WebviewView in the Explorer sidebar,
  **Isabelle: Show Goals**, 150 ms caret debounce, client HTML-to-text conversion,
  immediate hiding of old text on edits/moves, and checking/error states. Standard
  LanguageClient diagnostics appear in the editor. New code uses only VS Code,
  the existing LanguageClient, and standard libraries; Isabelle is unchanged.
- **Passed:** `bash scripts/check_m3.sh` compiled and ran the real stock VS Code
  host against Isabelle, exiting 0. It verified different cursor states,
  identical-state refresh, rapid cursor changes, a failed `by simp` diagnostic at
  the correct range, error precedence, and empty old output during a deliberately
  slow command. A temporary `(2 :: real) = 2` / `by simp` control showed
  `No subgoals!` and cleared diagnostics. The original `examples/Sqrt2.thy` was
  verified unchanged and still contains its M1 `sorry`; its complete proof is M4.
- **Also verified:** injected out-of-order and early state replies, changed
  document versions, decoration deltas, and a busy command beyond the waiting
  deadline. HTML conversion preserves whitespace/entities; the webview escapes
  markup and disables scripts. The test reads the same model rendered by the view.
- **Discovered:** dynamic output is untagged and deduplicated. Built-in state
  query IDs confirm the cursor and permit identical goal refreshes. Busy ranges
  require `vscode_pide_extensions=true` and arrive as deltas. `background_bad`
  includes `sorry`, and a failed method can still return an enclosing
  `No subgoals!` state. Diagnostics therefore take precedence. Exact shapes and
  reference source paths are in [PROTOCOL_NOTES.md](PROTOCOL_NOTES.md).
- **Would do differently:** probe duplicate output and error/busy semantics before
  wiring the UI; these are protocol correctness concerns, not rendering details.
  Use the VS Code app executable for integration tests so test failures propagate
  to the shell rather than relying on the early-returning `code` launcher.
- **Visual check pending:** the screen tool still returns `Computer Use was not
  approved to use Code`. An updated development window is open at `show ?thesis`,
  and its Isabelle log confirms startup. Leo has been asked to check cursor
  movement and the wrong-tactic error using **Isabelle: Show Goals**. M4 has not
  started; record M3 as fully passed after that confirmation.

## 2026-10-17 — M3 passed with Leo's visual confirmation

- **Passed:** Leo confirmed the sidebar visual check passed. Together with the
  live integration checks above, this satisfies M3's stopping condition.
- **Discovered:** unfinished proofs need an explicit `unfinished (sorry)` label;
  Leo requested this distinction for M4 onward, with real errors still reported.
- **Would do differently:** distinguish unfinished work from failed commands in
  the first sidebar design rather than relying on the absence of an error banner.
- **Next:** M4, the readable sqrt-2 proof and five-step demo, including that label.

## 2026-10-17 — M4 passed: readable proof and unfinished status

- **Changed:** completed `examples/Sqrt2.thy` with a reduced-fraction/parity proof
  importing only `Complex_Main`. Its 11 intermediate `have` commands expose
  distinct goals. Added the five-step click path in [DEMO.md](DEMO.md), updated
  the README and probe for the completed example, and added **unfinished (sorry)**
  to the sidebar as requested. No prover or distribution files were modified.
- **Passed:** `isabelle process_theories -D examples -O Sqrt2` (using the installed
  absolute executable path) exited 0. The source contains zero `sorry` and zero
  `oops`. `bash scripts/check_m4.sh` compiled and ran a real stock VS Code host,
  exiting 0: all 11 goal texts were distinct, the actual completed proof showed
  `No subgoals!`, admitting the last step showed **unfinished (sorry)**, and a
  separate failed tactic still took precedence as an error. Comments and text
  mentioning `sorry` stayed ready; restoring the proof cleared errors/admissions.
  The suite also passed M3's cursor-race, diagnostics, and slow-command checks.
  The updated stdio probe exited 0 at the theorem statement. Temporary test edits
  stayed under `.dev-host/`; the actual example was verified unchanged by them.
- **Discovered:** the server's `background_bad` range identifies the literal
  `sorry` command, so the client can distinguish it from comments and genuine
  errors without inventing a source parser. Exact observed shape is recorded in
  [PROTOCOL_NOTES.md](PROTOCOL_NOTES.md). Real-to-natural-number transfer needs
  Isabelle's coercion lemmas; reversing `of_nat_mult` and `of_nat_power` lets
  `simp` check the square equation. PAINPOINTS entries 15–16 record both issues.
- **Would do differently:** use a fixed placeholder fixture for M3 regression
  tests from the start, and check number-type transfer separately before building
  the parity argument. In the new goal test, match actual `have` commands rather
  than the word inside prose; the initial test mistakenly selected a text block.
- **Next:** M5, the local socket and MCP tools. M5 has not started.

## 2026-10-17 — M5 passed: seven-tool MCP bridge

- **Changed:** added the loopback TCP bridge in the extension and a FastMCP 4.1.0
  stdio server in `mcp/server.py`. The tool list is exactly `open`, `edit`,
  `goals_at`, `errors`, `status`, `sorry_positions`, and `processing_status`.
  Leo explicitly added the last two to M5; the stopping condition in
  `CODEX_PROMPT.md` is unchanged. Read the requested
  [AutoCorrode I/Q tool list](https://github.com/awslabs/AutoCorrode/blob/main/iq/README.md#mcp-tools)
  before writing the tools and followed the purposes of its processing/admission
  queries. No I/Q plugin or Isabelle modifications are involved.
- **Passed:** `bash scripts/check_m5.sh` compiled TypeScript and ran the installed
  stock VS Code/Isabelle host, exiting 0. A real FastMCP stdio client discovered
  exactly seven tools, opened a disposable Sqrt2 copy with `sorry`, received goal
  text and phase equal to the sidebar model, and obtained the exact admission
  range. Through `edit` it submitted the full M4 proof; `status` reported both the
  file and aggregate `fully_checked: true`, saved, zero admissions and no errors.
  The completed proof's `No subgoals!` output also matched the sidebar. These are
  live protocol checks, not simulated prover results or a trivial solved control.
- **Also passed:** wrong-tactic error messages/ranges; pending status during a
  two-second proof command; restoring the complete proof after removing `end`;
  invalid-range and symlink escape rejection; invalid-token rejection; refusal
  of a second connection; successful reconnect after the first agent disconnected.
  M3/M4 regression checks passed in the same run. Python dependency validation
  reported no broken requirements. The real `examples/Sqrt2.thy` was verified
  unchanged. Receipts are in ignored `.dev-host/m5-results.json`.
- **Discovered:** fresh goal output can precede status annotations, and error
  decorations can precede diagnostic text. Cached closed documents are not open
  tabs. Forced decoration snapshots do not advance the server's delta baseline,
  so transient running ranges can remain stuck without another snapshot. The
  client now waits for current annotations, marks incomplete error lists, uses
  actual tabs for aggregation, and refreshes snapshots only while busy. Exact
  observations and message shapes are in `PROTOCOL_NOTES.md`; PAINPOINTS entries
  17–19 record the user impact. A slow-command fixture also needed `ML_prf`
  inside a proof; plain `ML` produced `Bad context for command "ML"` and correctly
  remained an error.
- **Delivery:** `mcp/README.md` documents coordinates, result fields, limits,
  lifecycle, and one-line Codex/Claude Code registration commands, checked against
  installed CLI help and official documentation. No client registration or global
  configuration was changed. Test profiles, fixtures and discovery files stayed
  under `.dev-host/`; the runtime default remains `~/.isabelle-revamp/port`.
- **Would do differently:** probe repeated edits and forced-snapshot/delta
  interaction before designing completion reporting. Keep processing, error-list
  completeness, admissions and saved state separate from the start; no single
  goal string or empty diagnostic list can establish completion.
- **Next:** M6's limited sidebar polish. M6 has not started.

## 2026-10-17 — M6 implemented; automated acceptance passed

- **Changed:** the sidebar now uses VS Code theme colours, the editor's font,
  and explicit high-contrast borders. Its header shows the active theory's name
  and current check status, using M5's completion evidence. **unfinished (sorry)**
  remains separate from genuine proof errors; pending output stays hidden.
  Goal text and diagnostic messages decode Isabelle's default symbols to Unicode,
  including `⇧2` → `²`. The sidebar and MCP share that text and header metadata.
  The copied symbol assignments are attributed in `THIRD_PARTY_NOTICES.md`.
- **Highlighting:** added the demo's missing `text`, `where`, and `and` keywords
  and corrected identifier boundaries for apostrophes, qualified names, and
  Unicode letters. The committed test uses the installed VS Code TextMate and
  Oniguruma engines, checks all 27 keywords and 46 command lines in Sqrt2, escaped
  and Unicode symbols, nested comments/cartouches, and quoted strings. Keyword
  and string foreground colours are distinct from ordinary identifiers in
  Dark+, Light+, High Contrast, and High Contrast Light.
- **Passed:** `bash scripts/check_m6.sh` compiled and exited 0 in stock VS Code
  with live Isabelle. It includes all M3–M5 checks: distinct goals, cursor races,
  errors and admissions, real MCP proof edits, completion, and connection rules.
  It additionally verified the live `(sqrt 2)² = 2` goal, Unicode diagnostics,
  fully checked headers, and switching to another theory. The real demo remained
  unchanged. Receipts are in `.dev-host/m6-results.json`; the final compile and
  targeted Unicode checks also passed after guarding unknown symbol names
  against inherited object properties. `git diff --check` passed.
- **Discovered:** HTML output can contain literal Isabelle formatting controls,
  and diagnostic text can retain named source escapes. The initial second-theory
  test selected a completed top-level tactic without a printable proof state;
  selecting its lemma statement promptly supplied a goal and completion status.
  `process_theories` independently checked that fixture. PAINPOINTS entries
  20–23 and the M6 protocol notes record the observations and remaining limits.
- **Visual limitation:** the screen tool again returned **Computer Use was not
  approved to use Code**. No direct M6 screenshot inspection is claimed. The
  real editor/tokenizer tests above passed; the README gives the remaining
  manual light/dark/high-contrast check. No global settings were changed.
- **Would do differently:** make the tokenizer check reproducible in the
  repository from M2, test the actual demo vocabulary, and distinguish goal
  availability from theory completion when choosing cursor fixtures.
- **Next:** reload the development host and visually review the polished sidebar
  and highlighting. M6's requested implementation scope is complete; no further
  features or milestones were started.

## 2026-10-17 — M7 passed: Proof Swarm board

- **Changed:** added the **Isabelle Swarm** WebviewView and **Isabelle: Show
  Swarm** command. A structural lexer finds the requested depth-one proof steps
  in the current theorem, ignoring comments, strings, cartouches and nested
  proofs. The six-card demo proves the sum of the first n odd numbers is n².
  `Swarm.thy` keeps six `sorry` bodies; `Swarm_solution.thy` is the committed
  checked reference, hidden from Explorer/search by workspace settings.
- **Board:** grey admissions, amber processing/unknown completion, green local
  proofs and red errors reuse the existing current-version decorations and
  diagnostics. Updates are coalesced over 150 ms. Card buttons select the source
  step and update cursor goals. The M6 header/theme code is shared; the board
  shows N/M, seconds since the first document edit, and **kernel-checked ✓** only
  when the whole theory satisfies the same completion test as MCP `status()`.
  Retained DOM nodes allow 300 ms CSS status transitions; labels/status text use
  `textContent`, with keyboard-accessible buttons and a restricted script nonce.
- **Agents:** M7 supersedes the single-client limit with two authenticated
  sockets and one editor-operation queue. Actual MCP initialization names pass
  through the bridge and tag successfully edited cards for ten seconds. A
  client's stale read version prevents its edit from applying; the client must
  read and recompute its range. The seven tool signatures remain unchanged.
- **Passed:** `bash scripts/check_m7.sh` exited 0. It independently kernel-checked
  `Swarm_solution` with no admissions, compiled TypeScript, and passed all M3–M6
  regressions plus M7. Opening the skeleton at line zero produced six grey cards;
  a selected hand-edited `sorry` became green within the required two seconds,
  and a wrong tactic became red. A slow nested proof showed amber then green.
  Card selection updated cursor goals; an old-version card click was ignored.
- **MCP acceptance:** two live FastMCP stdio clients, identifying as Claude and
  Codex, filled different cards. Both tags appeared, a stale second-client edit
  was rejected, and fresh reads allowed subsequent edits. The board reached
  **6/6 proved** with **kernel-checked ✓**, matching `status()`. Tags expired
  after ten seconds. The third connection was refused, and the existing path,
  authentication, processing, diagnostic and goal-equality checks still passed.
  The clients submitted fixed proofs; no language-model session was invoked.
- **Additional checks:** lexer fixtures cover current-theorem selection, nested
  proof exclusion, multiline comments/cartouches, anonymous labels and incomplete
  steps. The actual webview script was tested with a small DOM harness for safe
  labels, preserved nodes, status classes, header updates and click messages.
  Live assertions require the board's document version to match the editor,
  so an old green snapshot cannot satisfy them. Receipts are in
  `.dev-host/m7-results.json`; the committed skeleton remained unchanged.
- **Discovered:** the stock server has no explicit finished flag; green requires
  positive command/ending annotations plus settled current-version status.
  Python's MCP initialization field is `client_info`, despite its JSON alias
  `clientInfo`. Two agents require version checks as well as serialization.
  PAINPOINTS entries 24–28 and `PROTOCOL_NOTES.md` record these details.
- **Visual limitation:** the screen tool again returned **Computer Use was not
  approved to use Code**. Real stock-editor tests and webview-script checks
  passed, but no direct M7 screenshot review is claimed.
- **Would do differently:** inspect initialization metadata and multi-client
  version safety before adding ownership badges. Test opening at the theory
  header, not only at an existing proof cursor, and require the current document
  version in every live board assertion.
- **Next:** reload the development host and run the Swarm demo with
  `docs/SWARM_PROMPT.md`. The requested M7 implementation and automated stopping
  conditions are complete; no later milestone was started.

## 2026-10-17 — M8 passed: Ask Isabelle

- **Changed:** added the Ask box above Goals and **Isabelle: Ask** to focus it.
  Enter sends, Shift+Enter inserts a line, and streamed text/tool-call summaries
  append to the session transcript. The box disables during a request. Stop
  terminates Claude and its MCP process group; a ten-minute deadline does the
  same. Existing submitted edits remain in the editor.
- **Backend:** uses installed Claude Code 2.1.236 only, with verified print/JSON
  streaming flags, stdin prompts, the requested fixed preamble, and explicit
  coordinate/current-buffer guidance. Built-in tools, skills and hooks are
  disabled for the child. Exactly the seven Isabelle MCP tools are allowed;
  an explicit configuration selects this extension's bridge after checking the
  existing registration. No model HTTP API, new prover, dependency, automatic
  registration or global configuration change was introduced.
- **View:** Goals now keeps its webview DOM and receives goal/transcript messages
  separately, so live checking preserves the draft, focus and conversation.
  A script nonce and text-only rendering keep proof/model output inert. The
  active visible theory is retained when focus moves into the Ask box. Every
  Ask proof edit goes through MCP, retaining the existing version checks,
  diagnostics, save/undo behavior and Claude Swarm tags.
- **Passed:** `bash scripts/check_m8.sh` exited 0. The final
  `M8_LIVE=1 bash scripts/check_m8.sh` also exited 0 with the final parser fix.
  It checked the reference theory, TypeScript, spawn/flags, split UTF-8/JSON,
  partial text, tool summaries, session history, concurrent-send refusal,
  Stop/escalation/descendant cleanup, timeout, malformed/error output, and both
  exact one-line help messages. Webview-script checks cover Enter/newline/IME,
  focus, disabled controls, Stop messages, draft/transcript retention and safe
  rendering. All M3–M7 live editor, highlighting and MCP regressions passed.
- **Real Claude acceptance:** with `examples/Demo.thy` open, `prove this` replaced
  the admitted arithmetic proof through MCP. Goals changed during the run,
  Claude tags appeared, and all three cards reached kernel-checked completion.
  A deliberately inserted `by (rule TrueI)` then produced a real inline error;
  `why does this fail?` named **Failed to apply initial proof method**, explained
  the mismatched `True` conclusion, and made no edit. The final run also checked
  that the streamed explanation appears only once. The test restored the three
  original `sorry` bodies afterward. Receipts and the generated complete theory
  are under `.dev-host/m8-results.json`, `m8-live-stream.json`, and `m8-checked/`.
  Independently, `isabelle process_theories -D .dev-host/m8-checked -O Demo`
  exited 0 on the generated proof, which contains zero admissions.
- **Discovered:** `stream-json` requires `--verbose`; variadic CLI arguments can
  consume a positional prompt; registration and connection health are separate.
  A complete assistant event can contain just one content block, whose array
  index differs from its stream index after a thinking block. A real captured
  stream exposed the duplicate-answer bug and now replays as one answer. The
  live harness also needed fresh editor handles after MCP navigation. Protocol
  notes and PAINPOINTS entries 29–33 record these findings and fixes.
- **Visual limitation:** the screen tool again returned **Computer Use was not
  approved to use Code**. Actual host/model and webview-script checks passed;
  no direct screenshot or physical typing acceptance is claimed.
- **Would do differently:** capture a thinking-plus-text stream at the start,
  test retained DOM/focus before connecting the backend, and reacquire editor
  handles after agent navigation. Keep deterministic checks separate from the
  opt-in signed-in Claude acceptance so ordinary verification spends no model
  requests.
- **Next:** reload the development host and follow **Ask Isabelle** in
  `docs/DEMO.md` with `examples/Demo.thy`. M8 implementation and automated/live
  backend checks are complete; no later milestone was started.

## M9 A — mathematical display (implementation and host checks passed)

- **Changed:** installed Isabelle symbol-table loading, source-preserving editor
  decorations with cursor/selection reveal, workspace toggle, single-token
  superscripts, thin-spaced sum binders in output, theme-font `.source` styling,
  and Isabelle-only completion defaults. Existing `Swarm.thy` user edits were
  preserved byte for byte and excluded from this commit.
- **Passed:** `scripts/check_m9a.sh` exited 0, including the complete M3–M5 live
  host/MCP suite. Source ranges, search-selection reveal, toggling, source-byte
  preservation and actual stock-client/server completion acceptance passed.
  The server returned and inserted ASCII `\<Sum>` at the original columns.
  Runtime receipts are `.dev-host/m9a-results.json` and `m9a-completion.json`.
- **Discovered:** string quick suggestions need a language override for Isar
  formulae; the installed table can be located with `isabelle getenv` without
  assuming a distribution path. No new dependencies or distribution edits.
- **Visual stop condition pending:** the screen tool returned **Computer Use
  was not approved to use Code**. Source/range checks are not a screenshot or
  physical Cmd-F/Tab check. A separate development window opens the unchanged
  current `examples/Swarm.thy` for user inspection. Part B/C must wait for this
  check under the requested sequential stopping rule.
- **Would do differently:** enable formula completions at language registration
  time and separate source representation from display from the first editor
  milestone.
