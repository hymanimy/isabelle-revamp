# Sqrt 2 in five steps

First follow the repository README's setup (installed Isabelle, `npm ci --prefix
extension`, and open the repository in stock VS Code). The committed theory is
complete; the temporary edits below let you demonstrate live checking.

1. Press **F5 → Isabelle: Extension Development Host**. In the new window, open
   **Command Palette → Isabelle: Show Goals**, then click the theorem statement
   in **examples/Sqrt2.thy**. The sidebar header shows **Sqrt2**, then
   **fully checked**, with the goal `sqrt 2 ∉ ℚ` below it.
2. At the bottom of the proof, select the final `by simp` immediately before the
   outer `qed` and type `sorry`. The sidebar changes from **checking…** to
   **unfinished (sorry)**. This admits the last step; it is not a proof error or
   a complete proof, even if the current command reports `No subgoals!`.
3. Click successively inside `have scaled`, `have numerator_even`,
   `have denominator_squared`, and `have common_factor`. Watch the goals change:
   clear the denominator, prove the numerator is even, derive the denominator's
   square equation, and find the common factor. Every `have` has its own goal.
   Squares display as `²`; sidebar colours and the goal font follow VS Code.
4. Replace that final `sorry` with `by (rule TrueI)`. The tactic cannot prove
   `False`: an inline diagnostic appears and the sidebar shows **Proof error**.
5. Replace it with `by simp`, then click inside that final `by` command. The
   error clears and the sidebar shows **No subgoals!** with no unfinished label.
   Save the file; it should again match the committed proof.

To verify the saved theory independently, run
`isabelle process_theories -D examples -O Sqrt2` from the repository root.
It must exit 0, and the file must contain no `sorry` or `oops`.

The proof imports only `Complex_Main`. It assumes a rational representation in
lowest terms, squares the equation, proves both natural numbers even, and
contradicts coprimality. The reduced-fraction setup uses
`Rats_abs_nat_div_natE` from `HOL/Real.thy`; the distribution's
`HOL/Examples/Sqrt.thy` was a reference for that setup. The example does not
import its irrationality theorem, call Sledgehammer, or use Nitpick.

## Swarm

1. In the development host, open **examples/Swarm.thy**, then run
   **Isabelle: Show Swarm**. After Isabelle publishes its annotations, the board
   shows six grey cards and **0/6 proved**. The theorem is the familiar identity
   `1 + 3 + … + (2n − 1) = n²`. The skeleton intentionally contains six admissions.
2. Click **base** to inspect its goal in **Isabelle Goals**. For a quick manual
   preview, replace its `sorry` with `by simp`: the card turns green. Replacing
   that proof with `by (rule TrueI)` makes it red; restore `sorry` for the full
   agent demo. Amber means checking or awaiting current completion evidence.
3. From the repository root, start **Claude Code** with the registered Isabelle
   MCP server and paste [SWARM_PROMPT.md](SWARM_PROMPT.md). Keep the Swarm board
   visible. The agent fills one step at a time; its name appears on the edited
   card for ten seconds. That document also gives optional two-agent assignments.
4. Watch **N/6 proved** rise while the elapsed timer runs from the first edit.
   Click any card to follow its current goal. Red cards indicate a local error;
   grey cards still contain admissions. Status changes use a 300 ms transition.
5. At **6/6 proved**, wait for **kernel-checked ✓**, then save. This badge reuses
   the same whole-file completion check as MCP `status()`. A local green card
   alone can still depend on earlier admitted steps.

`examples/Swarm_solution.thy` is the committed, independently checked reference.
Workspace `files.exclude` and `search.exclude` hide it from the demo window;
Git still tracks it. To reset a repeat demo, use Undo or restore the six `sorry`
proof bodies from the committed skeleton after preserving anything you need.

`bash scripts/check_m7.sh` checks the reference proof and runs the live board/MCP
acceptance tests in a disposable host. It leaves both committed example files
unchanged. The test uses two named MCP clients, without running a language model.

## Ask Isabelle

First install/register the MCP server using [mcp/README.md](../mcp/README.md).
Claude Code must be installed, signed in, and on the PATH inherited by VS Code.
Run `claude mcp get isabelle` from this repository to check registration. Compile
and reload an older development host before the demo.

1. Open **examples/Demo.thy**, the three-step skeleton proving that two
   consecutive odd numbers sum to a multiple of four. Click its first `sorry`.
   Open **Isabelle: Show Swarm**: the three cards start grey. Close other
   unfinished theory tabs so aggregate `status()` can become fully checked.
2. Run **Isabelle: Ask** from the Command Palette. It opens Goals and focuses
   the box at the top. Type **prove this** and press **Enter**. **Shift+Enter**
   inserts a newline. Keep Goals and Swarm expanded in the Explorer sidebar.
3. Watch streamed text and one-line tool calls. Claude reads and edits through
   the same seven MCP tools; edited cards show **Claude** for ten seconds and
   turn green as Isabelle checks them. Wait for **3/3 proved · kernel-checked ✓**
   and the completion reply. The proof is saved through MCP. **Stop** terminates
   the request and its MCP child; edits already submitted remain in the editor.
4. Replace the justification below `have expand` with **by (rule TrueI)**. Wait
   for a red card and an inline diagnostic, then ask **why does this fail?**.
   The answer should name **Failed to apply initial proof method** and explain
   that `TrueI` proves `True`, while this goal is an arithmetic equality. The
   explanation leaves the file unchanged and appends to the transcript.
5. Undo the bad tactic, or ask Claude to fix it; wait for whole-theory completion
   again. New messages append within this extension session. Reloading the
   window clears the transcript. A run disables the box until it finishes or is
   stopped; after ten minutes it stops automatically and says so.

If the CLI or registration is missing, the panel gives one line with the exact
`claude mcp add` command. Run it from the repository root after installing Claude
Code/the MCP Python dependencies. It does not register anything automatically.
Ask uses Claude Code's configured account/model, with no direct HTTP model API.
Tool-call coordinates in the transcript are zero-based, like MCP.

`bash scripts/check_m8.sh` checks spawn/streaming/Stop/timeout/help, the actual
webview script, and all M3–M7 regressions without a model request. To exercise the
two real Claude requests above using the installed signed-in CLI, run
`M8_LIVE=1 bash scripts/check_m8.sh`. This temporarily edits `examples/Demo.thy`
and restores its captured skeleton afterward; use it when the example has no
unsaved work. Receipts and the generated checked proof go under `.dev-host/`.

## Pretty symbols

`Isabelle: Toggle Pretty Symbols` switches display-only Unicode on/off (default
on). Move the caret into a symbol or select it with Find to see its ASCII source.
Search for `Sum` still finds `\<Sum>`. Type `\Sum` inside a formula and accept the
server suggestion with Tab; the inserted source is `\<Sum>`. Powers such as
`^2` and `^n` are displayed as superscripts without changing column numbers.

## M10 jEdit display parity — screenshot checks

### 6. Read-only libraries

Open `examples/Sqrt2.thy`, Ctrl/Cmd-click the type `real` in its theorem, and
open the returned definition in `HOL/Real.thy`. The tab is read-only: attempting
to type shows VS Code's read-only notice. Capture the library path and lock
indicator. Return to the example, which remains editable. The workspace
recommendation uses expanded installation/user-library paths; activation adds
missing paths from `isabelle getenv` without changing global settings or
replacing existing read-only overrides.

### 4. jEdit-style colours

In a scratch `.thy` importing Main, use `lemma "(\<lambda>x::nat. x) n = n"`
and a proof with `fix k :: nat` and `have "k = k" by simp`. After checking,
`n` is free (blue), `x` bound (green), and `k` a fixed/skolem variable (orange).
Keywords are blue and quoted inner syntax uses the theme's ordinary foreground.
Capture the editor in Default Dark Modern, then Default Light Modern. Other
custom themes receive standard TextMate/semantic scope fallbacks rather than
hardcoded colours. `Developer: Inspect Editor Tokens and Scopes` shows the
PIDE-backed semantic classification.

### 1. Unicode display and ASCII input

Open `Swarm.thy` and toggle **Isabelle: Toggle Pretty Symbols**. `\<Sum>` becomes
∑; moving the caret into it or selecting `Sum` with Find reveals ASCII. In a
scratch formula type `\noteq`, `~=`, `==>`, and `!!`; accept suggestions with Tab
and capture the glyphs ≠, ≠, ⟹, ⋀. Toggle display off to inspect their ASCII
spellings. Save and inspect the file: it still contains `\<...>` names.
`isabelleRevamp.unicodeOnSave` is **false by default**; only explicitly enabling
it permits symbol spellings to be saved as Unicode. Leave it off for the demo.

### 2. Superscript and subscript controls

In a scratch theory's `text` command, type
`m\<^sup>2 x\<^sub>1 y\<^bsup>n+1\<^esup>`.
Away from the caret these display as a raised 2, lowered 1, and raised `n+1`.
Capture the display, then move into a control spelling to show its ASCII source.
Toggle Pretty Symbols off to see every control; saving with the default setting
keeps all original ASCII spellings. Script blocks and non-Latin symbol arguments
use CSS positioning rather than a limited Unicode superscript alphabet.

### 3. Coloured goal state

Open `Sqrt2.thy` at the `root_squared` step (the goal `(sqrt 2)² = 2`) and capture
Goals: the `goal` keyword is coloured and the power is raised, with no ⇧ marker.
Use the free/bound/fixed-variable scratch proof from item 4 to capture matching
variable colours in the panel. Switch light/dark themes to check readability.
The Ask draft and transcript stay in place while the goal updates. MCP
`goals_at` continues to return readable plain text, without HTML.

### 7. Cartouches

Select the whole quoted proposition, including quotes, in a scratch
`lemma "(n::nat) = n" by simp`. Run **Isabelle: Convert quotes to cartouches**.
The editor displays `‹(n::nat) = n›` and the proof still checks; the saved source
contains `\<open>...\<close>`. Capture this with Pretty Symbols on, then off.
`<<` and `>>` offer the installed cartouche abbreviations; Tab accepts their
ASCII spellings. Typing a literal ‹ auto-closes ›, and a default save encodes
both. The command rejects multiple quoted strings or unbalanced cartouches;
no examples are converted automatically.

### 8. Goal definition links and hover

At `Sqrt2.thy`'s `root_squared` goal, hover over the underlined `sqrt` in Goals.
Capture the tooltip from the editor's hover provider. Ctrl-click (Cmd-click on
macOS) opens the definition in `HOL/NthRoot.thy`, with the name selected and the
library tab read-only. Capture that tab and its definition line. Plain clicking
allows text selection; it does not navigate. Return to the proof to continue.
Links belong to the currently displayed goal; old links are discarded while
checking. Only workspace and installed/user-library file targets are allowed.

## Install from VSIX (M11)

1. Build with `npm ci --prefix extension` then `npm run package --prefix extension`.
   The result is `dist/isabelle-revamp-0.1.0.vsix` (about 184 KiB).
2. Close Extension Development Host windows. In regular VS Code, use
   **Extensions → … → Install from VSIX…** and choose that file. The entry is
   **Isabelle Revamp**, publisher **hymanimy**, with a sigma/check icon.
   CLI equivalent: `code --install-extension dist/isabelle-revamp-0.1.0.vsix`.
3. Open the theory folder and `examples/Sqrt2.thy` in a fresh regular window.
   Goals opens on the first theory. Click `have root_squared` (line 17): the
   coloured goal is `(sqrt 2)² = 2`, while ASCII source and columns are preserved.
   If Isabelle is missing, **Locate…** selects `bin/isabelle`; **Download** opens
   the official installation page. No checkout or Python is needed for checking.
4. Run **Isabelle: Show Swarm** and **Isabelle Revamp: Setup check**. Screenshot
   the highlighted proof, Goals, proved cards, and the four ✓/✗ setup lines.
   Setup checks the actual `isabelle version` and `isabelle build -n -l HOL`,
   Claude on PATH, and the workspace's `isabelle` MCP registration.
5. Run **Isabelle: Ask**. With Python 3.11+ and signed-in Claude Code installed,
   copy the absolute registration command if requested. It points to the
   installed extension's `mcp/launch.py`. On first invocation it installs its
   private FastMCP environment. Use a copy of `Demo.thy` and ask “prove this”;
   observe streamed tool calls, Claude card tags and fully checked status.

Verified on VS Code 1.138.0 / Isabelle2025-2: `scripts/check_m11.sh`, the full
M3–M8/M10 regression chain, and a real Claude request against the installed
bundle all passed. Installed path on this machine:
`/Users/leo/.vscode/extensions/hymanimy.isabelle-revamp-0.1.0`.
The installed-copy API check uses `extension/test/installed.cjs`; the separate
regular window has no development/test flags and returned Sqrt2's live goal,
zero errors and `fully_checked=true` through the packaged MCP server. Receipts
are under ignored `.dev-host/m11-*`. Direct screen inspection remains unverified:
the screen tool returned “Computer Use was not approved to use Code”.

Uninstall was verified with `code --uninstall-extension hymanimy.isabelle-revamp`
after closing its window: the default and isolated discovery files were absent.
The final VSIX was then reinstalled and Sqrt2 reopened in regular VS Code.
A live window owns a port file; closing its extension removes that file without
removing another window's discovery. `dist/` and generated packaging copies
are ignored by git.

## Proof Graph (M12)

The M12 named-step amendment supersedes the earlier 52-tile recursive display.
The underlying Cascade proof still has all its commands; it now displays five
named obligations. Named steps inside a nested proof belong to its outer tile.

1. Open `examples/Swarm.thy`; run **Isabelle: Demo Layout**. Source stays in one
   editor column. **Isabelle** at the bottom contains Ask and Proof Graph side
   by side, while the sidebar is hidden. Capture seven grey dashed nodes,
   each labelled with its name and `L<number>`. The one-line graph header and
   right status bar agree. Sqrt2 has thirteen nodes; its final show is explicitly
   named `contradiction`. For a tall graph, use **Open in editor column**, then
   **Fit**. Drag pans; scroll zooms. Layout always fits the available bounds.
2. Hover `base` for its statement and live goal text (the source cursor stays put), click it and capture the cursor on its source
   line, the one-second line highlight, the focus ring and the grey gutter dot.
   Move the cursor into another named step: its tile acquires the focus ring.
   Replace the `base` admission with `by simp`; capture its green dot/tile and
   pulse, then its delayed fold. Use `by (rule TrueI)` instead: it stays red.
   Restore the admission after the demonstration. Source coordinates remain
   zero-based UTF-16 in MCP ranges; tile/MCP `line` labels are one-based.
3. In `Cascade.thy`, filling only an inner admission does **not** turn its owning
   named obligation green. All inner commands must be accepted first. Four
   named steps plus the root remain the same nodes when nested proof formatting
   or inner names change. The unnamed final show belongs to the root.
4. **Isabelle: Ask** focuses the bottom input. Enter sends, Shift+Enter adds a
   newline, Stop interrupts, and the streaming transcript stays below the input.
   Ask uses the same MCP bridge and named graph, one ready obligation per edit.
   **Isabelle: Demo Layout** is repeatable; `isabelleRevamp.demoShowGoals=true`
   also exposes Goals. The compact Swarm sidebar remains available separately.
5. After all commands check, capture the single large proved root, the kernel
   mark, and frozen elapsed time. **Replay ×8** repeats recorded states without
   changing source or calling Isabelle. Reduced motion disables CSS animation.

`bash scripts/check_m12.sh` checks the reference theory, named parser, M3–M8/M10
regressions, live colours/navigation/folding/replay and the 200-node SVG timing
benchmark. `bash scripts/check_m13.sh` checks the bottom Ask/layout/status bar.
`M12_ONLY=1` / `M13_ONLY=1` run focused checks. Receipts live in ignored
`.dev-host/`. Direct screen inspection remains unavailable because the screen
tool refused Code access; the steps above are screenshot-able checks, not a
claim that screenshots were taken.

The earlier M12 commit's live Claude run stalled before editing; it is not a
successful AI rehearsal. Card runs will record live success/failure separately.

## Pre-flight (M13b)

Prepare the isolated stage environment from the repository:

```sh
bash scripts/demo-env.sh
```

It builds and installs the current VSIX into **Demo**, under
`~/hack/demo/.demo/`, with no other user-installed extensions. It prints the
exact launch command, including the isolated user-data/extension directories
and MCP port file. Use that command rather than opening the folder in a normal
VS Code window. The generated settings disable workspace-trust prompts, editor
and extension updates, tips, welcome pages and built-in Chat; font size is 16,
pretty symbols are enabled, and Demo Layout runs on activation. Your normal
VS Code profile is not reconfigured. The bundled MCP environment is prepared
before launching, and `.mcp.json` is project-scoped to the demo folder.

Close the Demo window before re-running setup. Existing edited theory files
are preserved; an unmodified previously copied fixture can update. To use an
already built package, pass `--vsix dist/isabelle-revamp-0.1.0.vsix`.
The script copies non-reference theories from `examples/card/` as they become
available. Until M15 creates that set, it uses the existing Sqrt2 reference for
the first-launch environment check; that is not a live card-proof rehearsal.

Before walking on stage:

- [ ] **DND on** in macOS; silence phone and calendar notifications.
- [ ] Open the printed **Demo** command on `~/hack/demo`; no banners or popups.
- [ ] **Chat closed**; source visible, Ask and Proof Graph at the bottom.
- [ ] Sqrt2 checks, and the active card is restored to its intended skeleton.
- [ ] Claude is signed in; Ask can reach the demo's MCP bridge.
- [ ] **Replay tested** on the current rehearsal timeline.
- [ ] **Backup video ready** and reachable without searching for a file.

`bash scripts/check_m13b.sh` checks isolated profile creation, settings updates,
repeat setup, preservation of edited proofs, refusal to update a running Demo
window, and a real CLI install into an ignored test folder. It does not claim
that DND or a backup video has been prepared, or replace the visual pre-flight.

## The red flash — kernel-checked refutation (M14)

1. Open `examples/card/Sqrt4.thy`, then **Isabelle: Demo Layout**. The named
   `sqrt4_irrational` tile is grey/dashed, with its original `sorry` visible.
2. In Ask, enter **prove that the square root of 4 is irrational**.
3. Claude must insert an independent, structured `sqrt4_irrational_refuted`
   lemma immediately after the original theorem. The original statement and
   `sorry` remain unchanged. No English refusal counts as acceptance.
4. Screenshot the green counter-lemma, its arrow into the red original tile
   labelled **refuted**, and status bar **refuted · kernel ✓**. Hover/click
   still refer to each declaration's source line. Neither root disappears.
5. `status()` intentionally remains unfinished, with one admission and no
   errors: the counterexample is accepted; the original claim is not proved.
   Replacing a valid counter-proof with `sorry` retracts the red refutation.
   A wrong tactic such as `by (rule TrueI)` has the ordinary red error state.

Run the repeatable control with `bash scripts/check_m14.sh`; include an actual
Claude rehearsal with `M14_LIVE=1 bash scripts/check_m14.sh`. The live test uses
an isolated copy and writes timings, full displayed transcript and resulting
source to `docs/card-runs/Sqrt4-<n>.md`. It fails if the rendered refutation takes
more than 30 seconds or any edit touches the original theorem.

Batch checking the deliberately admitted demo requires an explicit option:

```sh
isabelle process_theories -o quick_and_dirty=true -D <demo-copy-directory> -O Sqrt4
isabelle process_theories -D examples/card -O Sqrt4_solution
```

The first command permits the one original `sorry`; it does not prove that
claim. The second checks only the independent counter-proof with admissions
disabled. The live test also extracts Claude's actual counter-lemma into a
fresh theory and checks it with the default options, without the original
admitted theorem in scope.

Verified rehearsal: [Sqrt4 run 3](card-runs/Sqrt4-3.md) rendered the kernel-backed
refutation in **15.476 s**; the final sentence arrived at **30.858 s**. Earlier
failed attempts are retained beside it. These are actual VS Code webview/MCP
receipts, not a claimed manual screenshot check.
