"""Unit tests for the /v1/prewarm endpoint and its background worker.

These mock `synth` so no edge-tts / RVC / GPU work happens — they exercise only
the prewarm plumbing: per-phrase iteration, error swallowing, the re-entry guard,
and the not-ready (503) path. Run from the miku-server dir with the project venv:

    .venv\\Scripts\\python -m pytest test_prewarm.py -q
"""
import server
from fastapi.testclient import TestClient


def test_run_prewarm_calls_synth_for_each_nonempty(monkeypatch):
    calls = []
    monkeypatch.setattr(server, "synth", lambda t: calls.append(t))
    server._prewarm_active = True  # worker is expected to clear this in finally
    server._run_prewarm(["a", "  ", "", "b"])
    assert calls == ["a", "b"]
    assert server._prewarm_active is False


def test_run_prewarm_swallows_per_phrase_errors(monkeypatch):
    calls = []

    def flaky(t):
        calls.append(t)
        if t == "boom":
            raise RuntimeError("edge-tts hiccup")

    monkeypatch.setattr(server, "synth", flaky)
    server._prewarm_active = True
    server._run_prewarm(["ok1", "boom", "ok2"])  # must not raise
    assert calls == ["ok1", "boom", "ok2"]  # kept going past the failure
    assert server._prewarm_active is False


def test_endpoint_503_when_engine_not_ready(monkeypatch):
    monkeypatch.setattr(server, "_engine", None)
    client = TestClient(server.app)
    r = client.post("/v1/prewarm", json={"phrases": ["a"]})
    assert r.status_code == 503


def test_endpoint_empty_list_is_noop(monkeypatch):
    monkeypatch.setattr(server, "_engine", object())
    monkeypatch.setattr(server, "_prewarm_active", False)
    client = TestClient(server.app)
    r = client.post("/v1/prewarm", json={"phrases": ["", "   "]})
    assert r.status_code == 200
    assert r.json() == {"status": "empty", "warming": 0}


def test_endpoint_guards_against_concurrent_prewarm(monkeypatch):
    called = []
    monkeypatch.setattr(server, "_engine", object())
    monkeypatch.setattr(server, "synth", lambda t: called.append(t))
    monkeypatch.setattr(server, "_prewarm_active", True)  # pretend one is in flight
    client = TestClient(server.app)
    r = client.post("/v1/prewarm", json={"phrases": ["a", "b"]})
    assert r.status_code == 200
    assert r.json()["status"] == "already"
    assert called == []  # no second pass spawned


def test_endpoint_starts_background_warm(monkeypatch):
    monkeypatch.setattr(server, "_engine", object())
    monkeypatch.setattr(server, "_prewarm_active", False)

    started = {}

    class FakeThread:
        def __init__(self, target, args=(), daemon=None, name=None):
            started["target"] = target
            started["args"] = args

        def start(self):
            started["started"] = True  # don't actually run the worker

    monkeypatch.setattr(server.threading, "Thread", FakeThread)
    client = TestClient(server.app)
    r = client.post("/v1/prewarm", json={"phrases": ["a", "b", "  "]})
    assert r.status_code == 202
    assert r.json() == {"status": "warming", "warming": 2}
    assert started.get("started") is True
    assert started["args"] == (["a", "b"],)  # whitespace-only dropped
    # The guard flag was set; reset so other tests/state stay clean.
    server._prewarm_active = False
