import json
from pathlib import Path
import shutil

import pytest

from eval.harness.assemble import assemble, theory_name
from eval.harness.classify import classify
from eval.harness.kernel import KernelResult, check, parse_errors, proved
from eval.harness.scanner import FORBIDDEN, scan


@pytest.mark.parametrize("word", sorted(FORBIDDEN))
def test_forbidden(word):
    assert scan(f"by simp (* {word} *)")


@pytest.mark.parametrize("proof", [
    "by simp", "by try0", "by (simp add: append_assoc)",
    'proof -\n have weekend: "True" by simp\n show ?thesis using weekend .\nqed',
])
def test_allowed(proof):
    assert not scan(proof)


def test_scanner_boundaries():
    assert scan("by simp", "lemma target: \"True\" by simp", "target")
    assert not scan("by simp", "lemma helpful: \"True\" by simp", "target")
    assert scan("x" * 8001)
    assert scan("by (tactic ‹Skip_Proof.cheat_tac @{context} 1›)")
    assert scan("*) lemma fake: \"True\" by simp", "(*")
    assert scan("by simp", 'lemma "target": "True" by simp', "target")
    assert scan("by simp", 'lemma "Namespace.target": "True" by simp', "target")
    assert scan("by simp", 'lemma ‹target›: "True" by simp', "target")
    assert scan("by simp", 'lemma (in group) target: "True" by simp', "target")
    assert scan('by simp (*')
    assert not scan('by simp (* outer (* nested *) comment *)')
    assert scan("by simp\nend")
    assert not scan('by simp (* end of the proof *)')
    assert not scan('proof -\n have h: "end = end" by simp\n show ?thesis by simp\nqed')


def test_assembly():
    statement = 'lemma exact:\n  fixes x :: nat\n  shows "x = x"  '
    text = assemble(statement, ["Main"], "by simp", lemma_id="a", run_id="b", attempt=3)
    assert f"\n{statement}\n" in text
    assert theory_name("a", "b", 3) in text
    assert theory_name("a", "b", 3) != theory_name("a", "b", 4)
    clean = KernelResult(0, "", "", [], 0, False)
    assert proved(clean, text, statement, "by simp")
    assert not proved(clean, text, statement + " altered", "by simp")
    assert not proved(clean, text, statement, "sorry")
    assert not proved(KernelResult(0, "", "", parse_errors("*** failure"), 0, False),
                      text, statement, "by simp")


@pytest.mark.parametrize("fixture,expected", [
    ("syntax_error", "parse_error"), ("unknown_fact", "unknown_fact"),
    ("method_failed", "method_failed"),
])
def test_real_error_fixtures(fixture, expected):
    data = json.loads((Path(__file__).parent / "fixtures" / f"{fixture}.json").read_text())
    errors = parse_errors(data["stdout"], data["stderr"])
    assert any(e.line in {4, 5} for e in errors)
    assert all(e.col is None for e in errors)
    assert classify(KernelResult(data["exit_code"], data["stdout"], data["stderr"],
                                 errors, data["wall_s"], False)) == expected


@pytest.mark.isabelle
@pytest.mark.skipif(not shutil.which("isabelle"), reason="Isabelle absent")
@pytest.mark.parametrize("filename,expected", [("Swarm_solution", True), ("Swarm", False)])
def test_real_swarm(tmp_path, filename, expected):
    text = Path(f"examples/{filename}.thy").read_text()
    statement = next(line for line in text.splitlines() if line.startswith("theorem "))
    body = text.split("begin", 1)[1].rsplit("end", 1)[0]
    result = check(text, tmp_path / filename, 60)
    assert proved(result, text, statement, body) == expected


@pytest.mark.isabelle
@pytest.mark.skipif(not shutil.which("isabelle"), reason="Isabelle absent")
def test_timeout(tmp_path):
    result = check(assemble('lemma timeout_probe: "True"', ["Main"], "by simp"), tmp_path, .1)
    assert result.timed_out and not proved(result, "", "True", "by simp")
