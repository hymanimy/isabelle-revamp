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
  The M6 retry using the inventory's `com.microsoft.VSCode` identifier returned
  `Computer Use was not approved to use Code` again. M6 therefore records actual
  tokenizer/live-host checks separately from the still-unverified screen view.
  The M7 screen retry returned the same denial; its card rendering/message
  tests and live editor checks are recorded separately from screen inspection.
  M8's retry using that same inventory identifier was also denied. Its real
  Claude/editor acceptance and webview keyboard/message tests do not claim a
  direct screen review of the Ask box.

## 12. Goal notifications cannot identify the cursor that produced them

- **What happened.** `PIDE/dynamic_output` has no URI, document version, or cursor
  ID, and identical goal text is not resent after a cursor move. A naive view can
  show a previous goal as current or wait forever for an unchanged result.
- **Experience.** Moving the cursor appears unreliable, and the user cannot know
  whether the displayed goal belongs to the line they are editing.
- **Fix needed.** Tag goal notifications with document/cursor identity upstream.
  In this client, clear old text immediately and confirm the debounced cursor
  using the existing `PIDE/state_init` / `PIDE/state_output` ID, retiring old IDs.
  Keep `checking…` visible while current output is unconfirmed or the prover runs.

## 13. Error-looking markup and "No subgoals" are ambiguous

- **What happened.** `background_bad` highlighted the permitted `sorry`
  placeholder. Separately, a failing `by simp` produced output containing both
  `No subgoals!` and `Failed to apply initial proof method`. The first live M3
  test caught the client mistakenly treating `background_bad` as a proof error.
- **Experience.** A beginner could think an unfinished proof is broken or a
  failing proof is complete, depending on which signal the editor trusts.
- **Fix needed.** Give diagnostics precedence over goal text; use
  `text_overview_error`, not `background_bad`, as the decoration error flag.
  Hide misleading goal text on an error and show the actual diagnostic. Neither
  absence of diagnostics nor "No subgoals" proves a theory has no `sorry`.

## 14. The editor launcher can return before tests finish

- **What happened.** Launching an Extension Development Host test through `code`
  returned exit 0 before the test finished; a later assertion failed in the host.
  Running VS Code's application executable directly exposed the failure and
  returned the test's exit status.
- **Experience.** A successful terminal command appears to certify a check that
  has not actually finished, while the useful failure message is elsewhere.
- **Fix needed.** Use the foreground app executable for the integration runner.
  `scripts/check_m3.sh` does this and keeps the profile, fixture, and result files
  inside the repository's ignored `.dev-host/` directory.

## 15. An admitted step can look finished

- **What happened.** The live server returned `No subgoals!` at a `sorry`, with
  no error diagnostic and a `background_bad` range over the five-character
  command. Leo requested a distinct unfinished label after M3's visual check.
- **Experience.** A mathematician could mistake an admitted statement for a
  completed proof, or interpret error-looking highlighting as a failed tactic.
- **Fix needed.** Display **unfinished (sorry)** when the server marks that
  command, retaining the useful cursor goal. Genuine errors still take precedence.
  Use the marked source range so comments or quoted discussions of `sorry` do
  not trigger the label. Implemented in M4.

## 16. Moving an equation between real and natural numbers is not automatic

- **What happened.** The first M4 draft used the Lean tactic `exact_mod_cast`;
  Isabelle reported `Undefined method: "exact_mod_cast"`. Replacing it with
  `linarith` still failed to transfer `(real m)^2 = 2 * (real n)^2` to the natural
  number equation. `by (simp flip: of_nat_mult of_nat_power)` checks successfully.
- **Experience.** The mathematical equality is clear, but the editor requires
  the proof assistant's specific vocabulary for moving between number types.
- **Fix needed.** Keep a checked, readable example of this transfer alongside
  the proof. The demo names both `squared_real` and `squared`, so the change of
  number type is visible instead of hidden in a large tactic invocation. This
  was a client-authoring mistake, not an Isabelle kernel failure.

## 17. Goal output can arrive before its status annotations

- **What happened.** In the first M5 acceptance runs, the MCP goal text matched
  the sidebar but returned `ready` just before the sidebar became `unfinished`.
  Separately, an error decoration arrived before the corresponding diagnostic
  text, briefly producing an empty error list for a failed proof.
- **Experience.** An agent could announce success based on a correct-looking goal
  or an empty error list while the editor is still receiving the relevant status.
- **Fix needed.** Require the current version's goal confirmation and full
  decoration snapshot before returning settled MCP goals. Keep `has_errors`
  separate from diagnostic text availability and return `complete=false` while
  that text is pending. Invalidate completion immediately on theory edits.

## 18. Closed editor tabs remain in VS Code's document collection

- **What happened.** M5's first aggregate status included the already closed
  M3/M4 test files from `workspace.textDocuments`. Their retained unprocessed
  decorations kept the aggregate pending even after the actual open demo passed.
- **Experience.** The only visible theory is complete, yet the agent says another
  invisible theory is still checking. There is no obvious editor action to fix it.
- **Fix needed.** Enumerate actual open theory tabs for status aggregation and use
  the document collection only to read their buffers. An empty tab set must not
  report all theories fully checked.

## 19. A requested snapshot can leave checking stuck

- **What happened.** The M5 client restored the complete proof after deleting its
  final `end`, but cached running/unprocessed ranges never cleared. The stock
  `PIDE/decoration_request` path sends a full snapshot without updating the
  server's normal delta baseline (`VSCode_Resources.force_decorations`). A
  transient range sampled only by that request need not receive a clearing delta.
- **Experience.** A small, previously verified proof can say `checking…` forever
  until the user moves the cursor or otherwise triggers another full refresh.
- **Fix needed.** Refresh full decorations while the active theory has pending
  ranges, stopping once they clear. The client polls at 250 ms while busy;
  no Isabelle source changes are needed. Keep a restore-after-edit integration
  check, since testing only a freshly opened proof missed this interaction.

## 20. A square looked like an arrow followed by two

- **What happened.** Live HTML output for `have root_squared` contained `⇧2`.
  Removing HTML tags left `(sqrt 2)⇧2 = 2` in the sidebar. Diagnostic messages
  could also contain source escapes such as `\<notin>` and `\<rat>`.
- **Experience.** Familiar mathematics becomes a notation puzzle, and copied
  goals look different from the formulas a mathematician expects.
- **Fix needed.** Decode the distribution's default symbol assignments in the
  client and render supported single-character sub/superscripts as Unicode.
  M6 shows `(sqrt 2)² = 2` and shares the conversion with MCP and diagnostics.
  Unsupported controls/custom names remain visible; source files are unchanged.

## 21. Core-only highlighting missed commands in the actual demo

- **What happened.** The M2 keyword list omitted `text`, `where`, and `and` used
  in Sqrt2. Its word boundaries also allowed `theory'` and `Some.proof` to be
  coloured as if part of the identifier were an Isar command.
- **Experience.** An explanatory text block and a proof clause lack the expected
  visual structure, while an ordinary identifier can look like a command.
- **Fix needed.** Include the demo's commands and respect apostrophes, qualified
  names and Unicode letters at keyword boundaries. M6 checks all 46 demo command
  lines and comment/string/cartouche contexts using VS Code's real TextMate
  engine, including distinct token styles in four built-in themes.

## 22. The highlighting check depended on VS Code's runtime packaging

- **What happened.** Running the earlier scratch tokenizer check with plain Node
  failed with `Cannot find module '…/node_modules.asar/vscode-textmate'`.
  Electron can read VS Code's `.asar` archive; plain Node cannot. An initial
  theme-test helper also assumed a separately available `jsonc-parser`, which
  this installation does not expose.
- **Experience.** A developer cannot reproduce a previous highlighting check
  with the obvious Node command, even though the editor itself works.
- **Fix needed.** Keep the check in the repository and run it inside the stock
  Extension Development Host via `bash scripts/check_m6.sh`. Read the shipped
  compiled theme JSON directly; no extra parser or test framework is required.

## 23. A completed one-line tactic can have no cursor goal

- **What happened.** The M6 header fixture `lemma "True" by simp` checked with
  `process_theories`, but selecting `simp` did not yield a confirmed cursor state:
  the sidebar eventually reported unavailable. Selecting the same lemma's
  statement returned `goal (1 subgoal): 1. True` and **fully checked** promptly.
- **Experience.** A correct file can look stalled when the selected position
  has no printable proof state. That is different from a failed theorem.
- **Fix needed.** Keep the unavailable message distinct from an error and point
  the demo at a statement or an intermediate Isar command with an open goal.
  The M6 theory-switch check now selects the lemma statement. A richer
  no-goal/context display is outside this milestone's limited polish scope.

## 24. Completed commands have no explicit finished decoration

- **What happened.** M7's live probe found `text_keyword1` spans for the command
  and its proof ending, with pending/error ranges cleared after checking. The
  stock server does not send a separate `finished` flag for a proof step.
- **Experience.** A board built only from an empty error list would make an
  unchecked or unfinished step look proved.
- **Fix needed.** Require current-version annotations, marked command/proof
  tokens, structural closure, and no overlapping pending/error/admission data.
  Keep unknown completion amber. Show the whole-theory check separately from
  local green cards, which can rely on earlier admitted facts. M7 implements this.

## 25. The bridge did not yet carry client names

- **What happened.** The M5 bridge knew only its authenticated socket. The first
  M7 metadata attempt used the JSON field name as a Python attribute and failed
  with `'InitializeRequestParams' object has no attribute 'clientInfo'`.
- **Experience.** The board cannot tell the audience who edited a card, although
  the MCP client has already introduced itself.
- **Fix needed.** Read the installed SDK's `client_info.name` attribute through
  FastMCP request context and pass it through the local protocol. Bind it once
  per socket, escape it as display text, and expire the badge after ten seconds.
  The live test validates two distinct initialization names end to end.

## 26. Two agents cannot safely reuse old line coordinates

- **What happened.** M5 deliberately refused a second connection. Allowing two
  for the Swarm demo means one agent can insert lines after another has read its
  target, making the second agent's otherwise valid range stale.
- **Experience.** An agent can overwrite the wrong proof step while believing
  it is working independently. A visible name badge would not prevent corruption.
- **Fix needed.** Serialize editor operations and remember each client's last
  read/edit version. Refuse stale edits and require a fresh `open` plus recomputed
  coordinates. M7's two-client test verifies rejection before mutation, then a
  successful fresh read/edit. The third connection remains refused.

## 27. The closing method cannot see a local have by name

- **What happened.** An initial six-step reference draft ended with
  `qed (rule result)`. Isabelle reported `Undefined fact: "result"`; terminal
  methods use the enclosing goal's context. Adding a separate `show` would also
  add a seventh board card under the requested command list.
- **Experience.** The final local fact visibly proves the theorem, yet the
  apparent closing command cannot refer to it.
- **Fix needed.** Use the ordinary Isar closing line `thus ?thesis .` before
  `qed`. The reference now checks and the demo keeps six named `have` cards,
  with the nested induction proof contained inside the `all_n` card.

## 28. Git ignore rules do not hide a tracked solution from the editor

- **What happened.** The solution needs to stay committed while being hidden
  from the demo window. Git ignore rules do not remove a tracked file or control
  the VS Code Explorer.
- **Experience.** The answer can appear beside the skeleton during the demo, or
  an attempted ignore rule can give a false impression that it was hidden.
- **Fix needed.** Keep `Swarm_solution.thy` tracked and use repository-local
  `files.exclude` and `search.exclude` settings for the demo. Direct paths still
  allow the reference checker and presenter to access it.

## 29. Claude's advertised JSON stream requires a second flag

- **What happened.** The installed Claude Code 2.1.236 rejects
  `-p --output-format stream-json` with
  `Error: When using --print, --output-format=stream-json requires --verbose`.
  Putting the prompt immediately after variadic `--mcp-config` also made it a
  purported configuration filename: `MCP config file not found: .../Reply OK`.
- **Experience.** The obvious command fails before the mathematician gets a
  response, and a prompt can appear to be a missing file.
- **Fix needed.** Use the verified flags `--verbose --include-partial-messages`,
  an argument array, and stdin for the prompt. Record observed stream shapes;
  test split JSON/Unicode and duplicate complete-message events.

## 30. Refreshing a goal can erase a question being typed

- **What happened.** The M6 Goals view replaced its whole HTML on every prover
  update. An interactive textarea would lose its draft, focus and transcript.
  Moving focus into a webview can also leave `activeTextEditor` undefined.
- **Experience.** A user starts asking about a proof and the changing proof state
  interrupts the question or loses the active theory.
- **Fix needed.** Keep a persistent webview and send separate goal/Ask updates.
  Preserve the visible theory as the request context, save the draft with webview
  state, and retain the transcript in the extension session. Tests exercise
  typing, newlines, focus, re-opening and live goal updates.

## 31. MCP registration is not the same as a running proof connection

- **What happened.** `claude mcp get isabelle` returned exit 0 for the registered
  local server even when its status said `Failed to connect` because the
  extension was closed. The default discovery file can also belong to another
  development window.
- **Experience.** Re-registering an already registered tool does not make the
  proof visible, and the wrong window can appear to own the edit.
- **Fix needed.** Check registration, start the extension bridge, and pass an
  explicit configuration for this instance's discovery file to the child.
  Missing CLI/registration each has one actionable line containing the exact
  registration command from `mcp/README.md`. Do not change global client config.

## 32. A cached editor handle can expire during agent navigation

- **What happened.** The first real Ask acceptance run proved all three steps and
  reached `fully_checked`, but the harness then failed with
  `TextEditor#edit not possible on closed editors`. It had kept an editor object
  from before the agent's MCP navigation. The same stale handle prevented its
  initial cleanup attempt.
- **Experience.** A successful proof can look like a failed demo because the
  test's subsequent manual bad-tactic insertion addresses an obsolete editor.
- **Fix needed.** Reacquire the visible editor before test edits and restoration,
  while keeping the current document text/version as the source of coordinates.
  Restore the test-owned skeleton explicitly and rerun both live requests.

## 33. Claude repeats a completed text block with a different array index

- **What happened.** The live diagnostic explanation appeared twice. A fresh
  real stream probe showed thinking at stream block index 0 and text at index 1,
  but the completed `assistant` event contained only the text block at array
  index 0, with the same message ID.
- **Experience.** A correctly streamed answer suddenly repeats itself on
  completion, making a short mathematical explanation look much longer.
- **Fix needed.** Reconcile pending text blocks in order within their message
  ID, rather than equating stream indices with the complete message's array.
  Replay the captured stream and include its thinking/text sequence in the
  subprocess fixture. The live acceptance also rejects duplicate replies.

## 34. Reloading the demo window disconnects an external proof run

- **What happened.** During the live Swarm launch, the extension host exited
  normally and restarted while Claude attempted its first edit. The external
  MCP client returned `Bridge request failed: Extension connection closed. An
  edit may already have applied.`, followed by `The bridge is disconnected.
  Restart this MCP server.` The logs establish the reload, not its cause.
- **Experience.** The window is open again, but an agent connected before the
  reload cannot continue. It is unclear whether its interrupted edit landed.
- **Fix needed.** Stop the old run, reconnect to the new bridge and read the
  current buffer before any retry. Here the saved file and new bridge both
  confirmed six unchanged admissions. A fresh Ask run was already active in
  the reopened host, so it was left in control instead of starting a competitor.
  Keep the demo window open while its agent is working.

## 35. Mathematical source and displayed mathematics need different treatment

- **What happened.** Isabelle keeps portable `\<Sum>` source, while stock VS
  Code displays its full spelling; quoted formulae also inherit disabled string
  quick suggestions. Changing text to Unicode would shift MCP columns.
- **Experience.** A familiar sum looks like markup and Tab does not obviously
  offer the expected symbol inside the theorem statement.
- **Fix needed.** Load the installed symbol table, decorate original ranges,
  reveal selected symbols, and enable Isabelle-only string suggestions and Tab
  completion. Preserve ASCII edits and source coordinates. Direct screen access
  for M9 again returned `Computer Use was not approved to use Code`; retain that
  visual acceptance limitation alongside actual extension-host checks.
