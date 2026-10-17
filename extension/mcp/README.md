# Generated directory — do not edit

`server.py`, `launch.py` and `requirements.txt` in this folder are **build-time
copies**. [`build.cjs`](../build.cjs) copies them from the repository's
[`mcp/`](../../mcp/) before packaging, and `.vscodeignore` lets exactly those
three into the VSIX so an installed extension carries its own MCP server with
no checkout.

`mcp/` is the single source. Edit it there. Everything in this folder except
this README is gitignored, and a copy you edit here is overwritten by the next
`npm run build --prefix extension` or `npm run package --prefix extension`.

Registration commands for both the repository and the installed paths are in
[`mcp/README.md`](../../mcp/README.md).
