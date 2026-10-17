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

## M10.6 — read-only library navigation

- **Passed:** `scripts/check_m10.sh` exited 0, including the M3–M8 automated/live
  editor and MCP regressions and Ask subprocess checks. A real definition query
  for `real` opened `HOL/Real.thy`; VS Code rejected typing and disk bytes stayed
  identical. Demo screenshot steps are in `docs/DEMO.md`.
- **Discovered:** `ISABELLE_HOME_USER` names a version directory; protecting its
  parent covers all user libraries. Trusted extension edits bypass the typing
  lock, so the test uses actual editor typing and the MCP retains its separate
  workspace boundary. No global configuration or distribution changes.
- **Would do differently:** apply library protection as part of initial language
  registration, before the first definition navigation. A preliminary regression
  run exited during MCP startup without a surfaced exception; the harness now
  records failures explicitly, and the complete rerun passed.

## M10.4 — grammar and semantic colours

- **Passed:** `scripts/check_m10.sh` exited 0 with the full M3–M8 chain and
  library-lock check. Live PIDE annotations classified lambda-bound `x`, free
  `n`, fixed/skolem `k`, and schematic `?thesis` at their ASCII source ranges.
  Receipt: `.dev-host/m10-colours.json`. The existing four-theme TextMate checks
  pass. Screenshot instructions cover the built-in light/dark palettes.
- **Discovered:** the needed semantic distinctions were already in the cached
  `PIDE/decoration` stream. They can be exposed as standard-scope semantic tokens
  without requests, prover changes, or identifier heuristics.
- **Would do differently:** distinguish formula syntax from prose styling early;
  keep custom-theme fallbacks rather than imposing one fixed light palette.

## M10.1 — Unicode transport with ASCII persistence

- **Passed:** `scripts/check_m10.sh` exited 0 including M3–M8 regressions, M10
  library/colour checks, real accepted completions for `\noteq`, `~=`, `==>`,
  `!!`, server session abbreviations, default ASCII save and explicit Unicode
  save opt-in/restoration. The source and MCP coordinate regression checks pass.
- **Discovered:** the Unicode-edits option returns Unicode replacement text;
  `PIDE/abbrevs_response` supplements, rather than includes, the base symbol
  table. The official symbol catalogue relies on a VSCodium-specific resource.
  The client ports its catalogue model, loads installed data, and converts
  accepted edits to ASCII. Protocol receipts and exact shapes are recorded.
- **Would do differently:** test both persisted encodings and base/session
  abbreviations before connecting completion to an editor. Screenshot steps
  are documented; no direct screen capture is claimed.

## M10.2 — script decorations

- **Passed:** `scripts/check_m10.sh` exited 0 with M3–M8 and previous M10 checks.
  New host checks cover ASCII/decoded controls, Unicode symbol arguments,
  superscript/subscript blocks, bold, incomplete controls, supplementary-plane
  character offsets, cursor reveal, and unchanged buffer/disk bytes.
- **Discovered:** the official code assumes decoded one-character controls.
  Reusing its CSS requires token-aware source ranges for ASCII compatibility;
  generic symbol replacements must omit actively hidden controls.
- **Would do differently:** keep symbol tokens and UTF-16 ranges explicit from
  the beginning instead of treating formatting markers as ordinary glyphs.
  Screenshot instructions are in the item 2 demo section.

## M10.3 — coloured goal HTML and plain MCP output

- **Passed:** `scripts/check_m10.sh` exited 0 with M3–M8 and previous M10 checks.
  Allowlist tests reject active elements/attributes, preserve semantic classes,
  escape entity text, and render script controls even across markup boundaries.
  A live `root_squared` goal retained `keyword1` and displayed its exponent
  through the superscript span while MCP's plain text stayed unchanged.
- **Discovered:** server HTML contains literal control markers, and rich output
  must wait for current processing status as well as the tagged state reply.
  The first new test sampled before that gate; the corrected test waits for
  full checking, and the full rerun passed. A targeted M1 probe captured the
  square HTML, then hit its unrelated sqrt-irrationality-specific stop matcher;
  it shut down normally after its timeout. Live host acceptance passed.
- **Would do differently:** retain rich and plain representations together from
  the beginning, sharing script-token interpretation but keeping the webview's
  rendering boundary strict. Demo screenshot steps cover colours and powers.

## M10.7 — cartouche input and explicit conversion

- **Passed:** the M3–M8 regression chain passed in the full run. New acceptance
  initially caught an off-by-one selection in the harness, then the table's
  guillemet/cartouche completion ambiguity. Both were fixed; final
  `M10_ONLY=1 scripts/check_m10.sh` exited 0 with all numbered M10 checks.
  The converted proposition kernel-checks, `<<`/`>>` acceptance inserts ASCII
  cartouches, literal ‹ auto-closes ›, and default saving encodes both glyphs.
- **Discovered:** familiar short forms can have multiple authoritative symbol
  expansions. Cartouche entries need explicit completion priority. Ordinary
  string escapes follow `Pure/General/symbol_pos.ML`; delimiter balance needs
  checking before changing the selected syntax.
- **Would do differently:** verify the actually accepted completion, not just
  its presence in the menu. No example file was converted. Screenshot steps
  document selected conversion, input, auto-closing and source inspection.

## M10.8 — goal definition links and hover

- **Passed:** `scripts/check_m10.sh` exited 0, including M3–M8 and all mandatory
  M10 checks. A live sqrt link opens its installed definition read-only; the
  panel tooltip matches the editor's hover provider. Tests reject stale clicks,
  unsafe link targets and forged webview link classes.
- **Discovered:** the server supplies a file and line, but no column or hover
  payload. The client resolves a unique label on that line and asks the existing
  editor hover provider. Only validated local targets survive as opaque links.
- **Would do differently:** preserve entity metadata alongside goal HTML from
  the beginning. Screenshot-able navigation and hover checks are in DEMO.md;
  direct screen capture is not claimed. Optional Sledgehammer and M9 cascade
  work remain queued while M11 packaging takes priority.

## M11 — installable extension

- **Passed:** `scripts/check_m11.sh` packages a 188,477-byte VSIX containing one
  JavaScript bundle, symbol/grammar/media data, licenses and the bundled MCP
  launcher/server/requirements. `npx vsce ls` has no source, tests or runtime
  node_modules. Discovery priority, missing-Isabelle single notification,
  auto-open Goals, setup fixes, Ask streaming/Stop/help tests pass. The full
  M3–M8 and mandatory M10 regression chain exited 0.
- **Installed verification:** installed `hymanimy.isabelle-revamp@0.1.0` into
  real VS Code 1.138.0. The API harness loaded the installed bundle from
  `~/.vscode/extensions/`, confirmed Sqrt2 Goals/Swarm/colouring and all four
  setup checks, and ran real Claude through the bundled MCP environment. It
  filled a disposable Demo proof, tagged Swarm and reached fully checked.
  Then all development hosts were closed. A separate regular window, with no
  test/development flags, returned the live Sqrt2 square goal, no errors and
  `fully_checked=true`. CLI uninstall succeeded with all owned port files
  absent; the final artifact was reinstalled, its shipped runtime bytes checked,
  and Sqrt2 reopened and rechecked. Actual example sources remain unchanged.
- **Discovered:** package exports block resolving dependency package.json via
  require; bundled licenses need explicit filesystem paths. Test flags alone
  do not create an installed-extension API harness. VS Code adds install metadata
  to the manifest. Claude's server needs its own Python environment rather than
  a developer checkout; the optional launcher creates one only when invoked.
- **Would do differently:** test the shipping artifact and a regular window
  early. Direct visual inspection is still unverified because the screen tool
  returned “Computer Use was not approved to use Code”; DEMO.md gives the exact
  screenshot checks. No screenshot or visual approval is claimed. M9 cascade/
  flowchart and optional M10 Sledgehammer remain queued.

## M12 — full editor proof graph

- **Implemented:** offline bundled Dagre/SVG editor tab, recursive scoped Isar
  dependencies, nested containers, honest PIDE states, source navigation,
  zoom/pan/Fit/full screen, CSS pulses, delayed folding and timestamped 8× replay.
  The compact Swarm remains. `proof_graph` is the eighth MCP tool and Ask now
  requests one dependency-ready leaf per edit, without delegation.
- **Fixture:** Main-only rational-square-root witness theorem, 52 nodes and 38
  admitted leaves across three nested levels. The reference kernel-checks;
  replacing each admission with its reference method reconstructs that exact
  proof. Swarm.thy is unchanged.
- **Passed:** the full existing M3–M8 and mandatory M10 checks, including real
  FastMCP comparisons of the graph model, read-only libraries, Unicode/ASCII
  coordinates, diagnostics and two-client editing. Live webview checks confirm
  grey leaves, a hand proof rendered green in under two seconds, pulsing edges,
  red nodes that stay visible, reference completion, folding to the root and
  replay without source changes. The 200-node timing check is measured in the
  actual webview, with raw receipts under `.dev-host/`.
- **Live AI limitation:** a real Claude request read the file and graph, then
  said “Let me get advice before committing to an approach.” It made no edits
  for several minutes and was manually stopped (exit 143). This is explicitly
  not a successful AI acceptance run. The revised direct-leaf preamble still
  needs live acceptance in the forthcoming card runs. Per Leo's instruction to
  commit the current M12 work and continue, this limitation is carried forward.
- **Discovered:** long theories need `vscode_caret_perspective=0`; theory headers
  do not return tagged proof states; hidden tabs suspend animation frames and
  throttle timers; reference methods must share the skeleton's `using` context.
- **Would do differently:** start with the long fixture and a backgrounded tab,
  retain source focus independently of webview focus, and measure the renderer
  early. Direct screen inspection remains unavailable after the screen tool
  again refused Code access; no screenshot or visual approval is claimed.
- **Remaining performance acceptance:** the final focused `check_m12.sh` run
  passed reference filling, root folding and replay, then failed its strict
  zero-missed-frame assertion: 194 frames, 16.7 ms baseline, 33.4 ms maximum,
  one missed interval, 200 pulses and zero status-only Dagre layouts. An earlier
  focused benchmark had zero misses; later full runs varied between one and
  two. The strict check is retained and is not represented as passing. Layout
  caching and unchanged-node/edge paint suppression are implemented; the cause
  of the remaining timing outlier has not been established. This acceptance
  item is carried forward with the real-Claude limitation under the explicit
  instruction to commit current M12 work before continuing.

## M12 amendment and M13 — named, anchored graph beside bottom Ask

- **Changed:** deterministic theorem/lemma plus explicitly named outer
  have/show/obtain nodes; nested and unnamed commands contribute to the owning
  tile's status. Swarm has seven nodes and Sqrt2 thirteen (the final conclusion
  is now named `contradiction`, and the theory kernel-checks). Cascade's original
  nested proof now projects to four named obligations plus its root.
- **Layout:** bottom-panel Ask and Proof Graph share one container; the graph
  has 96×30 tiles, one-line header, offline Dagre ranksep 24/nodesep 12, and
  auto-fit. Open in editor column remains explicit. Demo Layout hides the
  sidebar, preserves source tabs/text, enables symbol display, and optionally
  shows Goals. The right status bar mirrors counts/time/kernel status; time
  freezes when the document finishes checking.
- **Anchors:** tiles and MCP expose the same one-based line labels and named
  ids; ranges remain zero-based UTF-16. Click highlights the line for one second,
  cursor movement focuses/reveals its tile, and gutter dots share its status.
  Hover fetches an actual pinned goal without changing the source cursor or
  the live Goals text. Preview output never certifies checking status.
- **Passed:** M3–M8 and mandatory M10 regressions, live FastMCP graph/line
  comparisons, Sqrt2 CLI kernel check, named-node/900×220 fit checks, bottom Ask
  visibility beside Graph, repeated Demo Layout, status/frozen clock, cursor
  reveal of a folded node, and actual-webview reference completion/replay.
  The hover/cursor/source preservation check passed against Isabelle2025-2.
  The amended 200-node test measured zero missed frames with no status-only
  Dagre layouts; receipts are under `.dev-host/`.
- **Discovered:** an obtain's typed witness (`k :: nat`) is not its fact name;
  its `where numerator:` binding is. An unnamed final show can keep the root
  open after every named child is green. VS Code preserves the old group
  orientation after joining editors, so Demo Layout sets one group explicitly.
- **Would do differently:** define named-outline semantics before animation,
  and test the small bottom viewport first. The prior live Claude limitation
  remains for forthcoming card runs. Screen access remains refused; these are
  live API/webview receipts, not claimed screenshots. M13b will isolate the
  demonstration profile before the remaining false-claim/card rehearsals.

## M13b — isolated Demo environment (visual acceptance pending)

- **Implemented:** `scripts/demo-env.sh` builds/installs the VSIX into a dedicated
  Demo profile under `~/hack/demo/.demo`, applies the requested settings and
  startup Demo Layout, prepares the packaged MCP runtime, and prints an exact
  launch command with its own user-data, extension and bridge-discovery paths.
  Only Isabelle Revamp is installed. Existing edited demo theories are retained.
  Project MCP registration stays in the demo folder; normal global settings
  are not rewritten.
- **Passed:** setup/unit checks and a real isolated CLI install; the regular
  installed Demo window opened Sqrt2 on its first buffer version with thirteen
  proved nodes, no errors/admissions, saved state and `fully_checked=true`.
  Its main log confirms editor updates are disabled. A real Claude CLI request
  using the same Ask controller, packaged MCP and active Demo bridge called
  `status` and reported completion without editing. This was a read-only smoke
  check, not one of the M15 live card-proof runs. Receipts are in `.dev-host/`.
- **Discovered:** install mode does not create a missing named profile even
  though window-launch mode does. Profile settings include application-scoped
  values, so both settings files inside the isolated data directory are seeded.
  The local `code` PATH shortcut was missing; the official app CLI works.
  `claude mcp get` reports project registration as pending interactive approval,
  but the existing explicit strict MCP configuration used by Ask successfully
  connected and called status; no global Claude approval settings were changed.
- **Would do differently:** isolate the stage profile before the first rehearsal
  and prepare MCP dependencies before the first English request. The requested
  Pre-flight checklist now covers DND, Chat, Replay and the backup video.
- **Outstanding:** the screen tool again refused Code access with “Computer Use
  was not approved to use Code”. Leo has been asked to confirm the open Demo
  window's bottom layout and absence of banners/popups. That visual condition
  is not claimed as passed. The four card fixtures do not exist yet; setup
  copies the current Sqrt2 reference until M15 supplies `examples/card/`, then
  copies that set. M14/M15 live rehearsals remain queued.

## M14 — kernel-checked red flash

- **Passed:** real Ask prompt “prove that the square root of 4 is irrational”
  rendered the green `sqrt4_irrational_refuted` and red/refuted original in
  **15.476 s**, with the exact status bar `refuted · kernel ✓`. The final
  sentence completed at **30.858 s**. The only applied edit inserted the
  structured counter-lemma after the original theorem; its bytes and sole
  `sorry` were unchanged. The appended nodes carried the Claude tag. All four
  required tool checks ran. The real MCP graph matched the rendered model.
- **Kernel audit:** the combined file exited 0 with explicit
  `-o quick_and_dirty=true` for the original admission; Claude's actual lemma
  was extracted into a fresh theory without that original fact and exited 0
  with admissions disabled. The committed independent reference also passed.
  Whole-file `fully_checked` correctly stayed false. A wrong-tactic control
  rendered red in **399 ms**; admitting/removing the counter-proof retracted
  the refuted state, and the red root never folded.
- **Discovered:** batch mode rejects `sorry` by default, file-wide completion
  cannot represent an independently accepted counter-lemma, and an appended
  lemma has no pre-edit node to tag. An initial real request took 57 s to edit
  and left a numeric simplification processing; a second rendered in 14.4 s
  but exposed missing tags/checks. All three transcripts, timings and failures
  are retained under `docs/card-runs/Sqrt4-{1,2,3}.md`. The installed Claude
  2.1.236 supports per-child `--effort low`; no global settings were changed.
- **Would do differently:** run the live false-claim rehearsal early and check
  its counter-proof in isolation from the admitted theorem. Keep refusal,
  diagnostics, refutation and whole-file completion distinct in the demo.
- **Regression checks:** `scripts/check_m14.sh` passed its M3–M8 and mandatory
  M10 chain plus the new refutation controls; the real-Claude pass used
  `M14_ONLY=1 M14_LIVE=1`. The broad check used
  `ISABELLE_TEST_SWARM_SKELETON=.dev-host/m7-skeleton.thy`, a copy of the committed
  skeleton, while preserving Leo's separately edited `examples/Swarm.thy`.
  Exact-name/retraction unit checks, streaming/Stop/help checks, Python syntax
  and TypeScript compilation passed. Pending M13b files remain separate.
  The VSIX packaging audit also passed: 227,293 bytes, bundled runtime and
  offline graph, no runtime node_modules. The artifact remains gitignored.

# Claude review

Review of the 17 Oct work on branch `leo`: three jobs, one commit each.

**Whole-chain regression, after all three jobs:** `bash scripts/check_m14.sh`
ran the full M3–M8 / M10 / M12–M14 chain — **79 checks passed, none failed**,
extension host exit 0 — and it no longer needs the
`ISABELLE_TEST_SWARM_SKELETON` workaround, because `examples/Swarm.thy` is a
skeleton again. `scripts/check_m13b.sh` and `scripts/check_demo_env.py` pass.
The live Ask controller in VS Code wrote a real receipt to
`~/.isabelle-revamp/ask-log/`, correctly reporting
`open (sorry) steps: sqrt4_irrational (line 5)` for the root-level admission.

**The reported scenario, live, after the fix:** `M8_LIVE=1 bash
scripts/check_m8.sh` — **70 checks passed, none failed**, host exit 0 — runs
two real Claude requests against `examples/Demo.thy`'s three admissions, which
is the multi-`sorry` cascade of demo beat 3 rather than M14's single
root-level admission. Both the cascade and a follow-up request on the same file
passed, and the two production receipts show the fix end to end:

- first request: `open (sorry) steps: expand (line 11), factor (line 13),
  result (line 15)` and **no** history block;
- second request: `open (sorry) steps: none` — the first run had closed all
  three — with a history block containing only `- prove this` and **no
  assistant text**.

The same run also proved all six restored `Swarm.thy` cards through MCP to a
kernel-checked board. One stop condition is unchanged and is a stage risk
rather than a bug: Ask stops on `status()`, which aggregates **every open
theory tab**, so a second unfinished theory left open makes Claude finish the
card and still report itself stuck. `demo/README.md`'s pre-flight now carries
that as its own checklist item.

**Handover, before the demo:**

1. Close the old `~/hack/demo` Demo window. Its installed bundle is from 13:45,
   **before** the Ask fix; `~/hack/demo` is superseded by `demo/` in the repo.
2. `demo/.demo/` already holds the final VSIX (installed 14:53). Launch with
   the command `bash scripts/demo-env.sh` prints, or re-run that script first.
3. The three commits are **not pushed** — `leo` is 3 ahead of `origin/leo`.

## Job 1 — the Ask flow stopped at open + status

- **Found, primary cause:** `examples/Swarm.thy` had nothing left to prove.
  Commit 96aa75d ("Demo prep") replaced its six `sorry` admissions with real
  justifications, so the committed demo skeleton became a finished proof —
  `git show 215e7fa:examples/Swarm.thy` has six admissions, `96aa75d` has none.
  On a theory with no open step, `open` + `status` + "nothing required here" is
  the **correct** answer, not a bug. `examples/Sqrt2.thy` is complete too, so
  both halves of the reported sequence ran against finished theories. Codex had
  noticed the edited file and worked around it in the M14 check with
  `ISABELLE_TEST_SWARM_SKELETON`, reading it as Leo's deliberate edit
  (PROGRESS, M14 regression checks) rather than as a lost fixture.
- **Found, secondary cause — the suspected one, confirmed in code:**
  `ask.ts:191–202` built each new prompt from every prior `user` **and
  `assistant`** entry, and that transcript was global rather than per file. The
  model's own "Fully checked." could therefore be replayed as context for a
  different theory. Real, and fixed. But it is not what produced this symptom,
  because the fixture genuinely had nothing to prove, so the two causes are
  reported separately rather than merged into one story.
- **Found, third cause:** the preamble never said how much was open, so the
  agent had no independent signal with which to contradict a stale transcript.
  PIDE `sorryPositions` cannot supply one either: it stays empty until Isabelle
  has annotated the buffer, which is exactly when a fresh file looks finished.
- **Changed:**
  - restored `examples/Swarm.thy` byte-for-byte from committed `215e7fa`
    (six admissions, verified by `diff`). Codex's completed variant remains
    recoverable from `96aa75d`; `Swarm_solution.thy` is still the reference.
  - `openSteps(source)` in `ask.ts` reads admissions from the buffer text
    through the existing `isarTokens`/`proofStructure` lexer, with no Isabelle
    dependency, so an unchecked theory never reports itself finished. Comments
    and strings are already opaque to that lexer, so `sorry_lemma` and prose do
    not count. A theorem with no named steps is itself the open obligation,
    which is the `Sqrt4` red-flash shape.
  - the preamble now opens with `<file> has N open (sorry) step(s): <names and
    lines>; 'prove this' means close them all, one per edit`; for N = 0 it says
    so and tells the agent to say so and stop. Lists cap at twelve names plus
    "and K more".
  - per-file history of **prior requests only**; the model's own output never
    returns to it. Switching theory starts a fresh history and puts a notice in
    the transcript naming the new file.
  - a **Clear** button. The webview renderer only ever appended lines, so it
    also had to learn to remove rendered lines the state no longer holds.
  - every run writes `~/.isabelle-revamp/ask-log/<timestamp>.md` with the
    theory, cursor line, open steps, request, prompt, system prompt, transcript
    and outcome. The write is wrapped so a logging failure cannot interrupt a
    run, and a same-millisecond collision gets a numeric suffix.
- **Kept deliberately:** the refutation paragraph is untouched, and
  "close them all" carries an explicit carve-out — "unless a statement is
  false — then follow the refutation rule below" — so the M14 red flash still
  has permission not to prove `sqrt4_irrational`.
- **Verified:** `node extension/test/ask.cjs` covers the four fixture shapes
  (`Demo` 3 steps, `Swarm` 6, `Sqrt4` root-level 1, `Sqrt2` none), and asserts
  that the assistant text is absent from a follow-up prompt, that a second
  theory inherits no history, that returning to the first theory sees only its
  own requests, that Clear forgets both, and that four runs leave four
  receipts. `extension/test/askView.cjs` covers Clear being inert mid-run and
  the rendering actually emptying. `refutations.cjs` now pins the open-step
  line and the carve-out so the red flash cannot regress silently.
- **Verified live:** `M14_ONLY=1 M14_LIVE=1 bash scripts/check_m14.sh` passed
  against the new preamble with real Claude Code, real MCP and real
  Isabelle2025-2: the counter-lemma was accepted in **14,829 ms** (previous best
  15,476 ms), the original theorem and its sole `sorry` were untouched, and the
  extracted counter-proof exited 0 with admissions disabled. Receipt:
  [Sqrt4 run 4](card-runs/Sqrt4-4.md). The restored `Swarm.thy` skeleton also
  means the M7/M12 checks no longer need the
  `ISABELLE_TEST_SWARM_SKELETON` workaround.
- **VSIX:** the 14:07 `dist/isabelle-revamp-0.1.0.vsix` did match the sources it
  was built from (newest source 13:45), so Codex's package was not stale. It is
  stale now that `ask.ts` has changed, and was rebuilt with `npm run package`.

## Job 2 — demo folder split from the development root

- **Found:** the repository root was both workspaces, and `scripts/demo_env.py`
  pointed at `~/hack/demo`, an untracked folder outside the repository, while
  explicitly refusing any destination inside it. Two things also stood in the
  way of committing a demo folder: `demo_env.py` rewrote the destination's
  `.vscode/settings.json` on every run, and `libraryFiles.ts:17` writes
  `files.readonlyInclude` into **workspace** settings at activation — either
  would show the prepared demo folder as a modification.
- **Found, pre-existing break:** `scripts/check_demo_env.py` asserted that
  `copy_theories` produces `Sqrt2.thy`, but since M14 added
  `examples/card/Sqrt4.thy` the fallback branch no longer runs and the copy is
  `Sqrt4.thy`. `bash scripts/check_m13b.sh` therefore failed before this
  review. Fixed here rather than left for the demo.
- **Interpretation, flagged:** "the four card theories" cannot be taken
  literally — only `examples/card/Sqrt4.thy` exists under `examples/card/`, and
  the judges' card theorem 3, "there are infinitely many primes", has **no
  fixture anywhere in the repository**. The only satisfiable reading of "the
  four card theories + Sqrt4, copied from examples/card and examples/" is the
  four non-reference theories in `examples/` plus `Sqrt4` from
  `examples/card/`. `demo/README.md` carries that mapping and names the gap;
  no new fixture was invented. Card theorem 2 (√p irrational for prime p) is
  served by `Cascade.thy`, which is its engine, not its statement.
- **Changed:**
  - `demo/` holds `Sqrt2.thy` (complete, beats 1–2), `Swarm.thy` (6
    admissions), `Cascade.thy` (38), `Demo.thy` (3) and `Sqrt4.thy` (the red
    flash), a `.vscode/settings.json`, and a `README.md`. No reference proofs,
    no extension source, no tests, no scripts.
  - `demo/.vscode/settings.json` holds only what VS Code honours per workspace
    — pretty symbols, demo layout on activation, font size 16, no startup
    editor, the Isar palette, the hidden `.demo`/reference globs — and is
    pre-seeded with the `files.readonlyInclude` paths so the extension finds
    nothing missing and never writes to it. Workspace trust, update and
    extension suppression, telemetry, Chat and this machine's
    `isabelleRevamp.executable` are user-level: they stay in the generated
    Demo profile, and `demo/README.md` documents each one and why.
  - `scripts/demo_env.py` defaults to `demo/`; `resolve_destination` allows
    exactly `demo/`, a `.dev-host/` scratch directory, or anywhere outside the
    repository, and still refuses the root. `write_json` leaves an unchanged
    file alone, and `copy_theories` refuses to copy over `demo/` because its
    theories are in git — `git checkout demo/` is the reset. A scratch
    `--directory` keeps the old copy-and-preserve behaviour.
  - the launch command now opens `Sqrt2.thy` when it exists and otherwise the
    first theory present, instead of naming a file a scratch folder may lack.
  - `.gitignore` adds `demo/.demo/` and `demo/.mcp.json`; `README.md` opens
    with a ten-line Demo/Dev split; `docs/DEMO.md`'s pre-flight points at
    `demo/` and separates user-level from workspace settings.
- **Verified:** `bash scripts/check_m13b.sh` passes, including a real CLI
  install into the ignored scratch folder. `scripts/check_demo_env.py` now also
  checks that `demo/` is self-contained (five theories and a README, no
  `_solution` files, no `extension/`), that `resolve_destination` accepts
  `demo/` and rejects the root, `examples/`, `extension/` and `mcp/`, that the
  committed settings survive a preparation run byte-for-byte, and that
  trust/update/executable keys are absent from them. `bash scripts/demo-env.sh
  --vsix dist/isabelle-revamp-0.1.0.vsix` was then run for real against
  `demo/`: it installed only `hymanimy.isabelle-revamp-0.1.0` into
  `demo/.demo/extensions/`, printed the single launch command, and left
  `git status` showing nothing under `demo/` except the files committed here
  (`git check-ignore` confirms `demo/.demo/` and `demo/.mcp.json`).
- **Not done:** `~/hack/demo` still exists with a live Demo window from the
  earlier environment. It is now superseded; close that window and relaunch
  from the printed `demo/` command before the demo.

## Job 3 — the duplicated MCP server

- **Found:** there was never a second source. `extension/mcp/` was already a
  build-time copy — `build.cjs:7–8` copies `server.py`, `requirements.txt` and
  `launch.py` from `mcp/` before bundling, `.gitignore:7` excluded the
  directory, and `git ls-files extension/mcp` returned nothing. All three files
  were byte-identical to `mcp/`. So the requested restructuring was already in
  place; what was missing was anything that *said* so, and the gitignore
  exception needed to make a README possible.
- **Found, a trap in the requested change:** git cannot re-include a file
  underneath an excluded **directory**, so adding `!extension/mcp/README.md`
  below `extension/mcp/` would have silently done nothing. The exclusion is now
  `extension/mcp/*` with the negation after it.
- **Changed:** `extension/mcp/README.md` (the only tracked file there) says the
  directory is generated, names `build.cjs` as its producer and `mcp/` as the
  source, and warns that an edit here is overwritten by the next build.
  `mcp/README.md` gained the matching four lines at the top. `.gitignore`
  switched to the contents form with the negation.
- **Verified:**
  - `git add --dry-run extension/mcp/` offers only `README.md`, and
    `git add --dry-run extension/mcp/server.py` is refused as ignored.
  - deleting all three copies and running `npm run build --prefix extension`
    restores them byte-identical to `mcp/`, leaving `README.md` untouched. The
    repackaged VSIX carries exactly `extension/mcp/{launch.py,
    requirements.txt, server.py}` and does not ship the development README.
  - **both registration commands in `mcp/README.md` were run as a real MCP
    client against the live extension bridge.** The repository form
    (`mcp/.venv/bin/python mcp/server.py`) and the installed-VSIX form
    (`python3 <installed>/mcp/launch.py`, using the freshly installed
    `demo/.demo/extensions/hymanimy.isabelle-revamp-0.1.0`) each advertised the
    same eight tools and reached the extension through `status()`. The
    installed copies were confirmed byte-identical to `mcp/`. No client
    configuration was registered or changed: the probe starts the documented
    command directly rather than running `claude mcp add` against Leo's config.


## Proof Graph demo fixes — visible names, replay and fresh clocks

- **Scope:** checked `leo` and the five local commits through `2445780`, then
  read **Claude review** before editing. The working tree started clean. The
  Ask implementation, `demo/` source/configuration and `mcp/` are unchanged.
- **Changed:** named steps stay visible, including named nested obligations;
  “Fold proved” is off by default and folded boxes list every contained name
  and line. Root tiles retain theorem names; completion belongs in the header.
  Dagre orders subtree groups, which wrap to fit readable full labels. Every
  layout and completed replay Fits. Replay defaults to ×2 with ×1/×2/×4/×8,
  preserves recorded acceptance order, and paces green transitions at least
  400 ms apart at ×1. File open/switch and Ask start create a fresh clock and
  recording; kernel acceptance freezes the clock.
- **Fixture decision:** the supplied `examples/Sqrt2.thy` had 13 named graph
  steps and four unnamed inner parity commands. Those four commands now have
  explicit names, bringing the graph to the requested 17 without changing the
  mathematics or line numbers. Ask's existing outer-obligation summary remains
  unchanged. The protected `demo/Sqrt2.thy` remains its original 13-node copy.
- **Passed:** strict `process_theories -D examples -O Sqrt2`; parser/replay/Ask
  units; `scripts/check_graph_demo.sh` in actual VS Code. The 900×400 webview
  has all 17 names/line labels visible at an effective 11.42 px font, no clipped
  labels, no default folds, and a frozen completed clock. Optional folding
  lists all 16 child names. Measured green spacing was ≥401 ms at ×1, ≥202 ms
  at ×2, ≥102 ms at ×4, and ≥53 ms at ×8. Swarm shows seven open nodes.
  File reopen and Ask start reset the clock; a refused concurrent Ask does not.
  The lifecycle test uses a fake CLI, not a paid/model proof run.
- **Graph/layout regression:** focused M12 and M13 checks passed. Real Isabelle
  accepts/rejects hand replacements, names/lines/navigation remain linked,
  optional named folding and recorded replay complete, and Demo Layout/status
  bar remain working. The 200-node SVG benchmark measured 194 frames, baseline
  16.7 ms, maximum gap 18.6 ms, zero dropped frames and zero status-only layouts.
- **Discovered:** processing-complete can precede admission annotations; the
  first Swarm test sampled too early. It now waits for the seven annotated
  open nodes and the existing 150 ms publication debounce. Batched acceptance
  has no finer server ordering, so replay uses child-first/source-line ties.
- **Would do differently:** preserve readable names as the default from the
  beginning, measure actual rendered text/available space, and make animation
  pacing and clock ownership explicit rather than inferring them from edits.
- **Other regressions:** both broad attempts passed M3–M8, including real MCP
  columns/goals/graph consistency and six-card Swarm completion, but stopped at
  M10's suggestion-widget acceptance. Focused M10 passed after strengthening
  its editor-focus/accepted-edit wait and using a fresh goal-link revision after
  hover. A subsequent broad retry still hit the widget check; this is retained
  as an intermittent test limitation, not represented as a full-chain pass.
  Focused M14 passed kernel rejection/refutation, MCP parity, red-node retention
  and retraction. No new real-Claude rehearsal was run for these display fixes.
- **Fresh-window broad run:** the same M14 integration entry point then passed
  the complete M3–M8/M10/M14 chain in a new isolated VS Code user-data directory
  (`.dev-host/graph-regression-fresh-user`), exit 0. This includes accepted
  symbol completions and current/stale goal-link navigation. The earlier
  reusable-profile failures remain in the log; a fresh profile passing does
  not establish their cause. M12/M13 were checked separately as above.
- **Final targeted rerun:** `scripts/check_graph_demo.sh` passed again after the
  last renderer adjustments. Folded names belong only to their nearest visible
  owner, line changes refresh the listing, and same-row arrows fit inside the
  graph margin. The final Sqrt2/Swarm, replay-speed/order/Fit and timer checks
  all passed, exit 0. Screen-tool access to Code was refused; the visual
  evidence is the actual webview's rendered measurements, not screenshots.
- **Package/install:** `scripts/check_m11.sh` passed; the VSIX is 231,048 bytes,
  contains only the required host/webview bundles and assets, and has no runtime
  node_modules. SHA-256:
  `447121b08cd1f59d45c963660c4bd5dd8263a411310b7c673175514a0843107e`.
  Installed with the real CLI into `demo/.demo/extensions/`, private user-data
  and profile **Demo**. The profile lists only `hymanimy.isabelle-revamp@0.1.0`;
  host JS, graph JS/CSS and all bundled MCP files match the VSIX byte-for-byte.
  Opened the existing metadata launch command without a development host.
  Its read-only bridge check reports 13/13 proved for the protected demo copy,
  `fully_checked=true`, zero errors, new clock epoch 1 and frozen 3,726 ms.
  Source bytes and every protected tracked file remain unchanged. The VSIX and
  runtime/receipts remain ignored; nothing was pushed.

## Final demo layout — implemented and installed; screenshots pending

- **Changed:** Demo Layout now makes a 62:38 source/right split, Goals above
  Graph in a 40:60 split, with full-width Terminal at the bottom near 28%.
  It hides both sidebars/activity bar, disables Ask registration through the
  default-true `isabelleRevamp.showAsk` setting, and preserves source tabs and
  unsaved contents. Goals reuses the live HTML model and shows graph counts;
  MCP state/coordinates are unchanged. Demo Graph retains all named nodes,
  disables folding, defaults Replay to ×2, and Fits after layouts/replay.
- **Passed:** the fresh-host M3–M8/M10/M13 chain logged **83 PASS lines**, exit
  0. It checked the actual three editor columns, their proportions, repeat
  layout, live Goals, no horizontal overflow, Ask provider removal/re-enable,
  status and existing prover/MCP/Unicode paths. `check_graph_demo.sh` passed
  Sqrt2's 17 names, Swarm's seven nodes, four replay speeds and file/Ask clocks.
  Sqrt2 labels fit the stage-derived 547×317 and 729×395 graph panels at about
  10 px and 12 px respectively, with no truncation. These are renderer
  measurements, not outer-window screenshots.
- **Performance:** initial M12 functional checks passed but its benchmark
  recorded three dropped frames. A focused series had one initial stall,
  followed by two zero-drop runs. SVG labels now survive status-only updates
  instead of being rebuilt. The subsequent complete M12 run passed, including
  200 nodes, 194 measured frames, zero drops, 17.8 ms maximum gap and zero
  status-only layouts. The timing observations do not prove a sole cause for
  the earlier stalls. Both failed and successful runs remain in `.dev-host/`.
- **Packaged:** `check_m11.sh` passed after updating its activation mock for
  the configuration listener; it also checks no Ask registration on a first
  activation with `showAsk=false`. VSIX size **233,200 bytes**; SHA-256
  `4b6b0faaf6cda1a6fa3826af74a56e6b83aaaf375bbeae5701f286db2da4dac4`.
  The CLI successfully reinstalled it into `demo/.demo/`, profile Demo.
  Installed host/webview bundles and CSS match the archive, and the manifest
  matches after excluding VS Code's installer-added `__metadata` field.
  Only this extension is listed in that isolated profile. Its ignored profile
  settings seed `showAsk=false` and a hidden activity bar.
- **Discovered / do differently:** public editor-layout queries return pixel
  sizes, and tab groups are not column-sorted. Joining groups can dispose
  preview webviews; capture handles before disposal and recreate only our
  panels. Terminal-specific resizing works without OS focus. Check compact
  column sizes early: default webview padding wasted 40 pixels. Keep the
  optional Ask implementation untouched and gate its provider in activation.
- **Remaining visual check:** after Leo enabled Code access, the screen tool
  still returned `Computer Use was not approved to use Code`, including after
  resetting its session. No screenshots were fabricated or captured via a
  bypass. `docs/demo-layout-1440x900.png` and `docs/demo-layout-1920x1080.png`
  remain outstanding. The CLI's fresh-window request reused the already-open
  Demo workspace (no new bridge appeared); a Demo **Developer: Reload Window**
  is requested to load the newly installed bundle before visual acceptance.
- **Scope:** no changes to `ask.ts`, `askView.ts`, tracked `demo/`, `mcp/` or
  any `CLAUDE.md`. Unrelated demo/Claude registration edits appeared during
  this work; they are preserved and excluded from the layout commit. The
  only `scripts/demo_env.py` change in this commit is the two layout settings.
  Nothing is pushed.

## M15 — the demo folder configures Claude Code itself

- **Committed:** `demo/.mcp.json.template` (project-scoped MCP registration with
  `${HOME}`-relative paths), `demo/CLAUDE.md` (the proof-style instructions),
  `.claude/settings.json` at the repository root
  (`enabledMcpjsonServers: ["isabelle"]`), and the same key in
  `demo/.claude/settings.json` for a copy of the folder used as its own project
  root. `scripts/demo_env.py` now expands the template rather than hard-coding
  the server entry, and refuses to write a `demo/.mcp.json` whose template
  paths disagree with the launcher and port file the run resolved.
- **Verified:** `scripts/check_m13b.sh` exit 0, including a real CLI install
  into `.dev-host/demo-install-check` whose generated `.mcp.json` is repinned to
  that scratch directory. Regenerating the committed `demo/.mcp.json` from the
  template is byte-identical to the existing file. From `demo/`, real Claude
  Code 2.1.236 lists the eight `mcp__isabelle__*` tools, and `prove this:
  Swarm.thy` proved all six admissions through the MCP bridge against the live
  Demo window: `fully_checked`, 0 errors, 0 sorries. The proof came back in the
  documented style — named `have` steps with one-line `by` justifications, and
  a single subproof for the induction, which is the one case `CLAUDE.md` allows.
  `demo/Swarm.thy` was restored to its skeleton afterwards.
- **Discovered:** a **local**-scope `isabelle` server in `~/.claude.json`,
  keyed to the repository, silently overrode `demo/.mcp.json`; it was removed
  with `claude mcp remove isabelle -s local` and the override is now documented
  as a pre-flight check. Claude Code resolves `.claude/settings.json` against
  the git root, not the working directory, so the approval key cannot live in
  `demo/` alone. Print mode (`claude -p`) loads project servers without the
  interactive approval gate, so a `-p` probe does not by itself prove the
  interactive session is unprompted; the committed approval key is what covers
  that, and only an interactive launch can confirm it.
- **Review correction:** commit `212c509` already adds `isabelleRevamp.showAsk`,
  suppresses Ask provider registration when false, and makes Demo Layout open
  Terminal without opening Ask. The earlier note does not match current source.

## Demo Ask default — explicit workspace setting

- Added `isabelleRevamp.showAsk=false` to `demo/.vscode/settings.json`, so
  opening the demo disables Ask before Demo Layout runs. Its isolated profile
  and setup script already set false; normal extension defaults stay true.
- Verified the existing demo setup check, the saved JSON, and that Demo Layout
  contains no Ask-opening command. No extension source change was needed.
- Do differently: keep demo-specific defaults in the committed workspace as
  well as the generated profile, and check current source before reporting
  a feature absent.
