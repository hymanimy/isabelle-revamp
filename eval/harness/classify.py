"""Stable, ordered error categories; the original error remains in the trace."""
from __future__ import annotations

import re
from .kernel import KernelResult

FAILURES = ("parse_error", "unknown_fact", "method_failed", "unfinished_goal",
            "type_error", "timeout", "cheat_rejected", "provider_error", "other")
PATTERNS = [
    ("parse_error", r"Outer syntax error|Inner syntax error|Bad name"),
    ("unknown_fact", r"Undefined fact|Unknown fact|Undefined type name|Undeclared"),
    ("type_error", r"Type unification failed|Type error"),
    ("method_failed", r"Failed to finish proof|Failed to apply initial proof method|empty result sequence"),
    ("unfinished_goal", r"Failed to refine|unfinished|goal"),
]


def classify(result: KernelResult, *, cheat: bool = False) -> str:
    if result.timed_out:
        return "timeout"
    if cheat:
        return "cheat_rejected"
    text = "\n".join(error.message for error in result.errors)
    for category, pattern in PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return category
    return "other"
