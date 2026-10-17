# The demo folder

This folder is the thing you open on stage. It holds the theories, the
workspace settings and the Claude Code configuration (`CLAUDE.md`,
`.mcp.json.template`), nothing else — no extension source, no tests, no
scripts. Opening it is all the configuration there is: VS Code picks up
`.vscode/settings.json`, and `claude` started here picks up `.mcp.json` and
`CLAUDE.md`.

The storyboard is [docs/STORYBOARD.md](../docs/STORYBOARD.md); the beats and
screenshot checks are [docs/DEMO.md](../docs/DEMO.md).

Do not open this folder in a normal VS Code window. Prepare and launch it with
the isolated Demo profile:

```sh
bash scripts/demo-env.sh          # from the repository root
```

It installs the current VSIX into a dedicated **Demo** profile under
`demo/.demo/`, with no other extension, and prints the one command that opens
this folder. Use that exact command. Close the Demo window before re-running
setup; the script refuses to touch a live profile.

## The theories

| File | Theorem | State |
| --- | --- | --- |
| `Sqrt2.thy` | √2 is irrational | complete, 0 admissions — beats 1 and 2 |
| `Swarm.thy` | 1 + 3 + … + (2n−1) = n² | skeleton, 6 admissions — the cascade |
| `Cascade.thy` | a rational square root of a natural number is an integer | skeleton, 38 admissions — the deep graph |
| `Demo.thy` | two consecutive odd numbers sum to a multiple of four | skeleton, 3 admissions — the warm-up |
| `Sqrt4.thy` | √4 is irrational (**false**) | 1 admission — the red flash |

Reference proofs are **not** in this folder; they stay in the repository under
`examples/`. To reset an edited theory after a rehearsal, restore it from git:

```sh
git -C <repository> checkout demo/
```

Card theorem 3 on the judges' card, "there are infinitely many primes", has no
fixture anywhere in the repository. `Cascade.thy` is the engine behind card
theorem 2 (√p irrational for prime p), not that statement itself.

## Settings

The settings in `.vscode/settings.json` are the ones VS Code honours per
workspace: pretty symbols on, demo layout on activation, font size 16, no
startup editor, the Isar colour palette, hidden `.demo` and reference files,
and read-only Isabelle library paths. The read-only paths and the colour
palette are this machine's; on another machine the extension adds its own
library paths to this file on first activation.

These are **user-level** settings, so they live in the generated Demo profile
rather than here, and `bash scripts/demo-env.sh` writes them:

- `security.workspace.trust.enabled: false` — no trust prompt on stage.
- `update.mode: none`, `extensions.autoUpdate`/`autoCheckUpdates: false`,
  `extensions.ignoreRecommendations: true` — no update or extension banners.
- `workbench.tips.enabled: false`, `workbench.enableExperiments: false`,
  `workbench.welcomePage.walkthroughs.openOnInstall: false` — no welcome pages.
- `chat.disableAIFeatures: true` — the built-in Chat stays out of the frame.
- `telemetry.telemetryLevel: off`.
- `isabelleRevamp.executable` — this machine's Isabelle, discovered by the
  script, deliberately never committed.

There is no `isabelleRevamp.showAsk` setting in this extension version, and
`isabelleRevamp.demoLayout` opens the Ask panel unconditionally
(`extension/src/demoLayout.ts`). The demo does not use Ask, so the panel is
left as an unfocused background tab: Demo Layout puts the panel at the bottom,
and the pre-flight below selects the **Terminal** tab in it. Suppressing Ask
altogether would need an extension change.

## Claude Code

`claude` started **in this folder** configures itself from two committed files:

- `.mcp.json.template` — the project-scoped MCP registration, with paths
  written relative to `${HOME}`. `bash scripts/demo-env.sh` expands it into the
  gitignored `.mcp.json` with this machine's absolute paths, pinned to the
  installed extension's bundled `mcp/launch.py` and to `demo/.demo/port`. If
  the extension version changes, the script stops and prints the paths the
  template needs.
- `CLAUDE.md` — the proof-style instructions Claude Code reads on start: MCP
  tools only, `open` before every edit, one `sorry` per edit, `errors` and
  `status` after each, stop at `fully_checked`; structured Isar with named
  `have` steps; `try0` allowed, sledgehammer and nitpick never.

Check the registration from this folder:

```sh
claude mcp list        # isabelle, pointing at demo/.demo/{extensions,port}
```

Two things live **outside** this folder because Claude Code resolves them
against the git root rather than the working directory:

- `<repository>/.claude/settings.json` holds
  `enabledMcpjsonServers: ["isabelle"]`, so interactive `claude` does not stop
  on "pending approval" for the project server. `demo/.claude/settings.json`
  carries the same key for the case where this folder is copied out of the
  repository and is a project root in its own right.
- A **local**-scope registration of a server also named `isabelle` in
  `~/.claude.json` silently wins over `.mcp.json`. If `claude mcp list` shows
  anything other than the `demo/.demo/` paths above, remove it:
  `claude mcp remove isabelle -s local`.

## Pre-flight

Before walking on stage:

- [ ] **DND on** in macOS; silence phone and calendar notifications.
- [ ] Open the printed **Demo** command on this folder; no banners or popups.
- [ ] **Exactly one `.thy` tab open** — the card you are proving. `status`
      aggregates every open theory tab, so a second unfinished theory (easy
      with `Cascade.thy` and `Demo.thy` in this folder) makes Claude finish the
      card and still report itself stuck. Close the other theory tabs.
- [ ] Demo Layout has run: source above, Proof Graph and the panel below.
      Select the **Terminal** tab in the bottom panel; Ask is never used.
- [ ] **`claude` already started** in this folder in that terminal, at an empty
      prompt, with `/mcp` showing the isabelle server and its 8 tools. Start it
      before the audience arrives, not on stage.
- [ ] `Sqrt2.thy` checks, and the active card is restored to its intended
      skeleton (`git checkout demo/` if a rehearsal left edits).
- [ ] **Replay tested** on the current rehearsal timeline.
- [ ] **Backup video ready** and reachable without searching for a file.

Then the whole demo is typing `prove this` at the Claude prompt.
