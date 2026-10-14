import asyncio
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest_asyncio
from fastapi import FastAPI

from admin import actions as actions_module
from admin.actions import ActionRunner
from admin.auth import require_admin
from config import get_settings
from summarize_and_send_to_groups import GroupSummaryResult
from test_utils.openwa_session import StubRegistry
from whatsapp import GatewayError


async def test_runner_runs_job_and_reports_success():
    runner = ActionRunner()
    gate = asyncio.Event()

    async def job():
        await gate.wait()

    job_id = runner.start("summarize", job)
    assert job_id
    assert runner.status()["summarize"].state == "running"
    assert runner.start("summarize", job) is None  # already running
    assert runner.start("load_kb", job)  # independent action
    gate.set()
    await runner.wait_idle()
    status = runner.status()["summarize"]
    assert status.state == "succeeded" and status.error is None
    assert status.started_at and status.finished_at
    assert runner.start("summarize", job)  # can run again
    await runner.wait_idle()


async def test_runner_never_records_gateway_response_text():
    runner = ActionRunner()

    async def boom():
        raise GatewayError("-> 500: upstream-body", status_code=500)

    runner.start("summarize", boom)
    await runner.wait_idle()
    status = runner.status()["summarize"]
    assert status.state == "failed"
    assert status.error == "OpenWA returned HTTP 500"


async def test_runner_records_failure_with_truncated_error():
    runner = ActionRunner()

    async def boom():
        raise RuntimeError("x" * 1000)

    runner.start("summarize", boom)
    await runner.wait_idle()
    status = runner.status()["summarize"]
    assert status.state == "failed"
    assert status.error and len(status.error) <= 300
    assert runner.start("summarize", boom)  # failure does not leave it stuck
    await runner.wait_idle()


async def test_runner_shutdown_cancels_running_jobs():
    runner = ActionRunner()
    started = asyncio.Event()

    async def forever():
        started.set()
        await asyncio.sleep(3600)

    runner.start("summarize", forever)
    await started.wait()
    await runner.shutdown()
    assert runner.status()["summarize"].state == "failed"


GATEWAY = object()


@pytest_asyncio.fixture
async def client(monkeypatch):
    fresh = ActionRunner()
    monkeypatch.setattr(actions_module, "runner", fresh)
    app = FastAPI()
    app.include_router(actions_module.router, prefix="/actions")
    app.dependency_overrides[require_admin] = lambda: None
    app.dependency_overrides[get_settings] = lambda: object()
    session = MagicMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    session.commit = AsyncMock()
    app.state.async_session = lambda: session
    app.state.registry = StubRegistry({"s1": GATEWAY})
    app.state.embedding_client = object()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    await fresh.shutdown()


async def test_get_actions_idle(client):
    body = (await client.get("/actions")).json()
    assert body["summarize"]["state"] == "idle" and body["load_kb"]["state"] == "idle"


async def test_start_summarize_returns_202_then_409_while_running(client, monkeypatch):
    gate = {}

    async def fake(settings, session, whatsapp, session_id):
        gate["called"] = True
        await asyncio.sleep(0.3)
        return []

    monkeypatch.setattr(actions_module, "summarize_and_send_to_groups", fake)
    first = await client.post("/actions/summarize")
    assert first.status_code == 202 and first.json()["job_id"]
    second = await client.post("/actions/summarize")
    assert second.status_code == 409
    assert (await client.get("/actions")).json()["summarize"]["state"] == "running"
    await actions_module.runner.wait_idle()
    assert gate["called"]
    assert (await client.get("/actions")).json()["summarize"]["state"] == "succeeded"


async def test_start_load_kb_uses_topics_loader(client, monkeypatch):
    loader = MagicMock()
    loader.load_topics_for_all_groups = AsyncMock()
    monkeypatch.setattr(actions_module, "topicsLoader", lambda: loader)
    assert (await client.post("/actions/load-kb")).status_code == 202
    await actions_module.runner.wait_idle()
    loader.load_topics_for_all_groups.assert_awaited_once()


def _res(jid, name, status, reason=None, count=20):
    return GroupSummaryResult(
        status=status,
        reason=reason,
        message_count=count,
        group_jid=jid,
        group_name=name,
    )


async def _run_summarize(client, monkeypatch, results_per_run):
    runs = iter(results_per_run)

    async def fake(settings, session, whatsapp, session_id):
        return next(runs)

    monkeypatch.setattr(actions_module, "summarize_and_send_to_groups", fake)
    assert (await client.post("/actions/summarize")).status_code == 202
    await actions_module.runner.wait_idle()
    return (await client.get("/actions")).json()


async def test_summarize_results_shape(client, monkeypatch):
    body = await _run_summarize(
        client,
        monkeypatch,
        [
            [
                _res("a@g.us", "A", "sent"),
                _res("b@g.us", "B", "skipped", "not_enough_messages", 3),
                _res("c@g.us", "C", "failed", "send_error"),
            ]
        ],
    )
    s = body["summarize"]
    assert s["state"] == "succeeded"
    assert s["summary"] == {"managed_groups": 3, "message": None}
    assert s["results"][1] == {
        "group_name": "B",
        "group_jid": "b@g.us",
        "status": "skipped",
        "reason": "not_enough_messages",
        "message_count": 3,
        "required": 15,
    }
    assert [r["status"] for r in s["results"]] == ["sent", "skipped", "failed"]
    assert body["load_kb"]["results"] == []
    assert body["load_kb"]["summary"] is None


async def test_summarize_none_managed(client, monkeypatch):
    body = await _run_summarize(client, monkeypatch, [[]])
    s = body["summarize"]
    assert s["results"] == []
    assert s["summary"]["managed_groups"] == 0
    assert "no managed groups" in s["summary"]["message"].lower()


async def test_summarize_results_reset_on_rerun(client, monkeypatch):
    runs = iter([[_res("a@g.us", "A", "sent")], [_res("b@g.us", "B", "sent")]])

    async def fake(settings, session, whatsapp, session_id):
        return next(runs)

    monkeypatch.setattr(actions_module, "summarize_and_send_to_groups", fake)
    await client.post("/actions/summarize")
    await actions_module.runner.wait_idle()
    gate = asyncio.Event()

    async def slow(settings, session, whatsapp, session_id):
        await gate.wait()
        return next(runs)

    monkeypatch.setattr(actions_module, "summarize_and_send_to_groups", slow)
    await client.post("/actions/summarize")
    running = (await client.get("/actions")).json()["summarize"]
    assert running["state"] == "running" and running["results"] == []
    gate.set()
    await actions_module.runner.wait_idle()
    final = (await client.get("/actions")).json()["summarize"]
    assert [r["group_jid"] for r in final["results"]] == ["b@g.us"]


async def test_summarize_results_bounded_to_200(client, monkeypatch):
    many = [_res(f"{i}@g.us", str(i), "sent") for i in range(250)]
    s = (await _run_summarize(client, monkeypatch, [many]))["summarize"]
    assert len(s["results"]) == 200
    assert s["summary"]["managed_groups"] == 250


GATEWAY_2 = object()


def _two_sessions(client) -> None:
    client._transport.app.state.registry = StubRegistry(
        {"s1": GATEWAY, "s2": GATEWAY_2}
    )


async def test_summarize_runs_every_active_session_with_its_gateway(
    client, monkeypatch
):
    _two_sessions(client)
    seen = []

    async def fake(settings, session, whatsapp, session_id):
        seen.append((session_id, whatsapp))
        return [_res(f"{session_id}@g.us", session_id, "sent")]

    monkeypatch.setattr(actions_module, "summarize_and_send_to_groups", fake)
    assert (await client.post("/actions/summarize")).status_code == 202
    await actions_module.runner.wait_idle()
    s = (await client.get("/actions")).json()["summarize"]
    assert seen == [("s1", GATEWAY), ("s2", GATEWAY_2)]
    assert s["state"] == "succeeded"
    assert [r["group_jid"] for r in s["results"]] == ["s1@g.us", "s2@g.us"]
    assert s["summary"] == {"managed_groups": 2, "message": None}


async def test_summarize_failure_in_one_session_does_not_stop_the_others(
    client, monkeypatch
):
    _two_sessions(client)

    async def fake(settings, session, whatsapp, session_id):
        if session_id == "s1":
            raise RuntimeError("boom")
        return [_res("b@g.us", "B", "sent")]

    monkeypatch.setattr(actions_module, "summarize_and_send_to_groups", fake)
    await client.post("/actions/summarize")
    await actions_module.runner.wait_idle()
    s = (await client.get("/actions")).json()["summarize"]
    assert s["state"] == "succeeded"
    assert [r["group_jid"] for r in s["results"]] == ["b@g.us"]
    assert "s1" in s["summary"]["message"] and "boom" in s["summary"]["message"]


async def test_summarize_fails_when_every_session_fails(client, monkeypatch):
    _two_sessions(client)
    monkeypatch.setattr(
        actions_module,
        "summarize_and_send_to_groups",
        AsyncMock(side_effect=RuntimeError("down")),
    )
    await client.post("/actions/summarize")
    await actions_module.runner.wait_idle()
    s = (await client.get("/actions")).json()["summarize"]
    assert s["state"] == "failed"
    assert "s1" in s["error"] and "s2" in s["error"]


async def test_load_kb_runs_every_session_and_reports_failures(client, monkeypatch):
    _two_sessions(client)
    loader = MagicMock()
    loader.load_topics_for_all_groups = AsyncMock(
        side_effect=[RuntimeError("kb down"), None]
    )
    monkeypatch.setattr(actions_module, "topicsLoader", lambda: loader)
    await client.post("/actions/load-kb")
    await actions_module.runner.wait_idle()
    calls = loader.load_topics_for_all_groups.await_args_list
    assert [(c.args[2], c.args[3]) for c in calls] == [
        (GATEWAY, "s1"),
        (GATEWAY_2, "s2"),
    ]
    s = (await client.get("/actions")).json()["load_kb"]
    assert s["state"] == "failed" and "s1" in s["error"] and "kb down" in s["error"]


async def test_actions_fail_clearly_without_an_active_session(client, monkeypatch):
    client._transport.app.state.registry = StubRegistry({})
    loader = MagicMock()
    loader.load_topics_for_all_groups = AsyncMock()
    monkeypatch.setattr(actions_module, "topicsLoader", lambda: loader)
    await client.post("/actions/summarize")
    await client.post("/actions/load-kb")
    await actions_module.runner.wait_idle()
    body = (await client.get("/actions")).json()
    for name in ("summarize", "load_kb"):
        assert body[name]["state"] == "failed"
        assert "no active OpenWA session" in body[name]["error"]
    loader.load_topics_for_all_groups.assert_not_awaited()


async def test_session_failure_never_includes_gateway_response_text(
    client, monkeypatch
):
    _two_sessions(client)
    monkeypatch.setattr(
        actions_module,
        "summarize_and_send_to_groups",
        AsyncMock(side_effect=GatewayError("-> 400: upstream-body", status_code=400)),
    )
    await client.post("/actions/summarize")
    await actions_module.runner.wait_idle()
    s = (await client.get("/actions")).json()["summarize"]
    assert s["state"] == "failed"
    assert "upstream-body" not in s["error"]
    assert "s1: OpenWA returned HTTP 400" in s["error"]
