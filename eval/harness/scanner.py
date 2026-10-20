"""Conservative lexical rejection, including forbidden words in comments.

This is a defence in addition to quick_and_dirty=false, not an Isar parser.
False positives are preferable to executing model-supplied ML or declarations.
"""
from __future__ import annotations

import re

FORBIDDEN = set("""sorry oops axiomatization quick_and_dirty skip_proof cheat
ML ML_prf ML_val setup declare consts defs overloading code_printing theory
imports begin end lemmas translations notation no_notation hide_fact hide_const
sledgehammer nitpick oracle axioms tactic raw_tactic method_setup attribute_setup
local_setup ML_file ML_command simproc_setup syntax no_syntax abbreviation
definition typedef type_synonym locale class instantiation interpretation
sublocale bundle unbundle external_file SML SML_file""".lower().split())
WORD = re.compile(r"(?<![\w'])[A-Za-z_][\w']*")


def balanced(text: str) -> bool:
    """No lexical construct may cross the harness-owned statement boundary."""
    stack: list[str] = []
    i = 0
    while i < len(text):
        top = stack[-1] if stack else ""
        if top == '"':
            if text[i:i+2] in {'\\"', '\\\\'}:
                i += 2
                continue
            if text[i] == '"':
                stack.pop()
        elif top == "(*":
            if text.startswith("(*", i):
                stack.append("(*")
                i += 2
                continue
            if text.startswith("*)", i):
                stack.pop()
                i += 2
                continue
        else:
            found = False
            for opening, closing in (("‹", "›"), (r"\<open>", r"\<close>"), ("(*", "*)")):
                if text.startswith(opening, i):
                    stack.append(opening)
                    i += len(opening)
                    found = True
                    break
                if text.startswith(closing, i):
                    if top != opening:
                        return False
                    stack.pop()
                    i += len(closing)
                    found = True
                    break
            if found:
                continue
            if text[i] == '"' and not stack:
                stack.append('"')
        i += 1
    return not stack


def scan(proof_text: str, aux_lemmas: str = "", target: str = "") -> list[str]:
    reasons = []
    for label, text in (("proof", proof_text), ("aux", aux_lemmas)):
        if len(text) > 8000:
            reasons.append(f"{label} exceeds 8000 characters")
        if not balanced(text):
            reasons.append(f"{label}: unbalanced lexical construct")
        for token in WORD.findall(text):
            if token.lower() in FORBIDDEN or token.lower().startswith(("cheat_", "skip_proof")):
                reasons.append(f"{label}: forbidden token {token}")
        # Reject control characters and symbol-encoded keyword obfuscation.
        if any(ord(ch) < 32 and ch not in "\n\r\t" for ch in text):
            reasons.append(f"{label}: control character")
    names = re.findall(r'\b(?:lemma|theorem|corollary)\s+"?([\w\']+)', aux_lemmas)
    if target and target in names:
        reasons.append("auxiliary lemma shadows target")
    return sorted(set(reasons))
