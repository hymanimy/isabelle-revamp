from dataclasses import asdict
import json
from pathlib import Path
import shutil
import time

import httpx
import pytest

from eval.harness.agent import extract_blocks, feedback, method_counts, run_task
from eval.harness.budget import Budget, BudgetStop
from eval.harness.llm import Anthropic, Fake, OpenAICompatible
from eval.harness.runner import read_rows, run
from eval.harness.schema import Task

META = {"git_sha": "a"*40, "isabelle_version": "Isabelle2025-2"}


def strings(value):
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for child in value.values() for s in strings(child)]
    if isinstance(value, list):
        return [s for child in value for s in strings(child)]
    return []


def normalized_trace(path):
    return [" ".join(s.split()) for s in strings(json.loads(path.read_text()))]


def fixture_corpus(tmp_path):
    source = [json.loads(x) for x in Path("eval/corpus/fresh.jsonl").read_text().splitlines()]
    # Include an arithmetic step that simp alone cannot solve, as well as easy steps.
    ids = ["fresh/Swarm/base", "fresh/Swarm/next_sum", "fresh/Swarm/next_square",
           "fresh/Cascade/denominator_nonzero", "fresh/Swarm/induction_step"]
    rows = [next(r for r in source if r["id"] == identity) for identity in ids]
    for i, row in enumerate(rows):
        # A distinct canary makes exact-string leak detection meaningful:
        # ubiquitous output such as "by simp" is not evidence of an input leak.
        row["held_out_proof"] += f" (* private_canary_{i}_8ae7 *)"
    path = tmp_path / "corpus.jsonl"
    path.write_text("".join(json.dumps(r)+"\n" for r in rows))
    return path, rows


def config(path, policy, attempts=1):
    return {"run_id": "test_"+policy, "corpus": [str(path)],
            "conditions": [{"model": "fake_"+policy, "provider": "fake",
                            "policy": policy, "max_attempts": attempts}],
            "workers": 2, "kernel_timeout_s": 30, "max_usd": 0, "max_hours": 1}


def test_blocks_and_feedback():
    assert extract_blocks("<aux>lemma h: \"True\" by simp</aux><proof>by simp</proof>")[0] == "by simp"
    for text in ["by simp", "<proof>x</proof><proof>y</proof>", "prose <proof>x</proof>"]:
        with pytest.raises(ValueError):
            extract_blocks(text)
    assert len(feedback("long\n"*1000)) <= 3000
    assert len(feedback("long\n"*1000).splitlines()) == 40
    assert method_counts("by simp (* by rule *)")["other"] == 0
    assert method_counts('have h: "by rule" by simp')["other"] == 0
    assert method_counts("by (rule refl)")["other"] == 1


def test_public_task_boundary(tmp_path):
    _, rows = fixture_corpus(tmp_path)
    public = asdict(Task.from_row(rows[0]))
    assert set(public) == {"id", "stratum", "imports", "statement", "orig_proof_lines"}
    assert "private_canary" not in json.dumps(public)


def test_sorry_never_calls_kernel(tmp_path, monkeypatch):
    path, rows = fixture_corpus(tmp_path)
    cfg = config(path, "sorry")
    def forbidden(*args, **kwargs):
        pytest.fail("Cheat text reached the kernel")
    monkeypatch.setattr("eval.harness.agent.check", forbidden)
    for row in rows:
        result = run_task(Task.from_row(row), cfg["conditions"][0], cfg, META, 0, tmp_path)
        assert result["failure_class"] == "cheat_rejected"
        assert result["kernel_wall_s"] == 0
    for row in rows:
        private = " ".join(row["held_out_proof"].split())
        for trace in (tmp_path / "traces").rglob("*.json"):
            assert all(private not in s for s in normalized_trace(trace))
            assert "private_canary" not in trace.read_text()


def test_leak_detector_positive_control(tmp_path):
    path, rows = fixture_corpus(tmp_path)
    original = rows[-1]["held_out_proof"]
    completion = Fake.from_corpus("held_out", [str(path)], rows[-1]["id"]).complete([], "fake")
    trace = tmp_path / "positive.json"
    trace.write_text(json.dumps(asdict(completion)))
    assert any(" ".join(original.split()) in s for s in normalized_trace(trace))


def test_provider_requests_and_full_response(monkeypatch):
    monkeypatch.setenv("OPENAI_BASE_URL", "http://localhost:8000")
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-not-real")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-only-not-real")
    messages = [{"role": "system", "content": "rules"}, {"role": "user", "content": "statement"}]
    def answer(request):
        body = json.loads(request.content)
        assert body["temperature"] == 0
        if request.url.path == "/v1/chat/completions":
            assert body["max_completion_tokens"] == 2048
            return httpx.Response(200, json={"choices": [{"message": {"content": "<proof>by simp</proof>"}}],
                "usage": {"prompt_tokens": 17, "completion_tokens": 9}, "model": "exact-snapshot-2026"})
        assert body["system"] == "rules" and body["messages"] == messages[1:]
        return httpx.Response(200, json={"content": [{"type": "text", "text": "<proof>by simp</proof>"}],
            "usage": {"input_tokens": 18, "output_tokens": 10}, "model": "claude-exact-snapshot"})
    for cls in [OpenAICompatible, Anthropic]:
        result = cls(transport=httpx.MockTransport(answer)).complete(messages, "requested-alias")
        assert result.raw_response["model"] == result.model_id
        assert result.prompt_tokens in {17, 18}
        assert not result.error
        assert "test-only-not-real" not in json.dumps(asdict(result))


def test_provider_error_is_one_call(monkeypatch):
    monkeypatch.setenv("OPENAI_BASE_URL", "http://localhost/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "not-real")
    calls = []
    def answer(request):
        calls.append(request)
        return httpx.Response(500, text="complete error body")
    result = OpenAICompatible(transport=httpx.MockTransport(answer)).complete([], "x")
    assert len(calls) == 1 and result.error
    assert result.raw_response == "complete error body" and not result.usage_known


@pytest.mark.parametrize("status", [200, 500])
def test_malformed_answer_preserves_returned_model_and_billable_usage(monkeypatch, status):
    monkeypatch.setenv("OPENAI_BASE_URL", "http://localhost/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "not-real")
    def answer(request):
        return httpx.Response(status, json={"model": "returned-snapshot",
            "usage": {"prompt_tokens": 12, "completion_tokens": 7}, "choices": []})
    result = OpenAICompatible(transport=httpx.MockTransport(answer)).complete([], "alias")
    assert result.error and result.model_id == "returned-snapshot"
    assert result.usage_known and (result.prompt_tokens, result.completion_tokens) == (12, 7)


def test_budget_reservation_and_restart(tmp_path):
    budget = Budget(tmp_path / "budget.sqlite", 1, 1)
    budget.reserve("a", .8)
    with pytest.raises(BudgetStop):
        Budget(budget.path, 1, 1).reserve("b", .3)
    budget.settle("a", .2)
    budget.reserve("b", .3)
    assert budget.total() == pytest.approx(.5)
    with pytest.raises(BudgetStop):
        budget.reserve("b", 0)
    with pytest.raises(BudgetStop):
        Budget(tmp_path / "zero.sqlite", 1, 0).reserve("c", 0)
    with pytest.raises(BudgetStop):
        budget.settle("missing", .4)


def test_retry_and_condition_trace_separation(tmp_path):
    path, rows = fixture_corpus(tmp_path)
    cfg = config(path, "garbage", 2)
    task = Task.from_row(rows[0])
    result = run_task(task, cfg["conditions"][0], cfg, META, 0, tmp_path)
    assert result["attempt_failures"] == {"parse_error": 2}
    cfg["conditions"][0]["model"] = "second"
    run_task(task, cfg["conditions"][0], cfg, META, 2, tmp_path)
    traces = sorted((tmp_path / "traces").rglob("*.json"))
    assert len(traces) == 4
    second = json.loads(traces[1].read_text())
    assert second["messages"][-2]["content"] == "not an XML proof"
    assert "Expected exactly one" in second["messages"][-1]["content"]


@pytest.mark.isabelle
@pytest.mark.skipif(not shutil.which("isabelle"), reason="Isabelle absent")
def test_end_to_end_and_resume(tmp_path):
    path, source = fixture_corpus(tmp_path)
    for policy in ["held_out", "sorry", "simp"]:
        cfg = config(path, policy)
        status = run(cfg, tmp_path)
        assert status["completed"] == 5 and status["status"] == "complete"
        rows = read_rows(tmp_path / cfg["run_id"] / "results.jsonl")
        if policy == "held_out":
            assert all(r["proved"] for r in rows)
        elif policy == "sorry":
            assert all(r["failure_class"] == "cheat_rejected" and r["kernel_wall_s"] == 0 for r in rows)
        else:
            assert 0 < sum(r["proved"] for r in rows) < 5
            assert all(r["proved"] or r["failure_class"] in {"method_failed", "unfinished_goal"} for r in rows)
        traces = list((tmp_path / "traces" / cfg["run_id"]).rglob("*.json"))
        assert len(traces) == 5
        before = {p: p.stat().st_mtime_ns for p in traces}
        assert run(cfg, tmp_path)["written"] == 0
        assert before == {p: p.stat().st_mtime_ns for p in traces}
        if policy != "held_out":
            for original in source:
                needle = " ".join(original["held_out_proof"].split())
                assert all(needle not in s for p in traces for s in normalized_trace(p))
                assert all("private_canary" not in p.read_text() for p in traces)
