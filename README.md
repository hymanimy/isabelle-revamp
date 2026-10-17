# Isabelle Revamp

Isabelle/HOL in stock VS Code, using the unmodified `isabelle vscode_server`.
M1 provides a plain-text goal probe; M2 adds Isar highlighting and server startup;
M3 adds the **Isabelle Goals** sidebar and live errors. M4 provides a readable,
fully checked proof that sqrt 2 is irrational in `examples/Sqrt2.thy`, with no
`sorry`. The MCP server is the next milestone.

## Try the extension in under five minutes

Requires Isabelle2025-2 with the HOL heap, Node 20+, npm, and stock VS Code 1.104+.

1. From this repository, run `npm ci --prefix extension`.
2. Open the repository root in VS Code: `code .`.
3. Check `.vscode/settings.json`: `isabelleRevamp.executable` points to the
   verified macOS installation under `~/hack/isabelle-env/`. Change this workspace
   setting for another installation, or use `isabelle` if it is on VS Code's PATH.
4. Press **F5**, selecting **Isabelle: Extension Development Host** if asked.
   This compiles the extension and opens a development window with `Sqrt2.thy`.
5. In that window, open the Command Palette and run **Isabelle: Show Goals**.
   Click an intermediate `have` in `Sqrt2.thy` to see its goal, or follow the
   [five-step demo](docs/DEMO.md) to try unfinished, error, and complete states.
   **View → Output → Isabelle** shows `Isabelle language server ready (HOL).`

If `code` is missing on macOS, open VS Code normally and use **File → Open Folder**,
or invoke `/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`.
For a manual build, run `npm run compile --prefix extension`.

## Check the proof and sidebar (M4)

In a fresh F5 development host, run **Isabelle: Show Goals** from the Command
Palette. The view lives in the Explorer sidebar. If reusing an older host, first
compile and run **Developer: Reload Window** there.

The sidebar briefly shows `checking…` during processing. An admitted `sorry`
shows **unfinished (sorry)**; a failed tactic shows **Proof error** and an inline
diagnostic. Each of the demo's 11 `have` commands has a distinct goal.

```sh
isabelle process_theories -D examples -O Sqrt2
bash scripts/check_m4.sh
```

If Isabelle is missing from PATH, use
`"$HOME/hack/isabelle-env/Isabelle2025-2.app/bin/isabelle"` for the first command.
For another VS Code installation, pass its **application executable** as the
first argument to `scripts/check_m4.sh`.
The runner uses a separate host profile and test theory under ignored `.dev-host/`.
It includes M3's cursor/diagnostic regression checks, then checks every demo
`have`, the real completed proof, and editing between unfinished/error/complete
states. It leaves the real example unchanged.

## Run the goal probe

```sh
python3 scripts/lsp_probe.py --isabelle "$HOME/hack/isabelle-env/Isabelle2025-2.app/bin/isabelle"
```

It prints every server notification and the goal at the theorem statement:

```text
proof (prove)
goal (1 subgoal):
 1. sqrt 2 ∉ ℚ
```

The approved client workaround requests HTML and extracts text because Isabelle's
plaintext serializer fails. See [protocol notes](docs/PROTOCOL_NOTES.md),
[pain points](docs/PAINPOINTS.md), and [milestone progress](docs/PROGRESS.md).
The extension's minimal startup adaptation is credited in
[third-party notices](extension/THIRD_PARTY_NOTICES.md).
