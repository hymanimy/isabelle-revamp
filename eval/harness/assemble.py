"""The harness alone owns theory headers and canonical statements."""
from __future__ import annotations

import hashlib
import re


def theory_name(lemma_id: str, run_id: str, attempt: int | str) -> str:
    return "E_" + hashlib.sha1((lemma_id + run_id + str(attempt)).encode()).hexdigest()[:10]


def target_name(statement: str) -> str:
    match = re.match(r"(?:lemma|theorem|corollary)\s+([\w']+)\s*:", statement)
    if not match:
        raise ValueError("Expected one named canonical declaration")
    return match[1]


def assemble(statement: str, imports: list[str], proof_text: str,
             aux_lemmas: str = "", *, lemma_id: str = "", run_id: str = "",
             attempt: int | str = 1) -> str:
    target_name(statement)
    if not imports or any(i not in {"Main", "Complex_Main"} for i in imports):
        raise ValueError("Only Main / Complex_Main imports are allowed")
    name = theory_name(lemma_id or statement, run_id, attempt)
    return (f"theory {name}\nimports {' '.join(imports)}\nbegin\n"
            f"{aux_lemmas}\n{statement}\n{proof_text}\nend\n")
