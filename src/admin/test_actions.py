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
    app.state.whatsapp = object()
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

    async def fake(settings, session, whatsapp):
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

    async def fake(settings, session, whatsapp):
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

    async def fake(settings, session, whatsapp):
        return next(runs)

    monkeypatch.setattr(actions_module, "summarize_and_send_to_groups", fake)
    await client.post("/actions/summarize")
    await actions_module.runner.wait_idle()
    gate = asyncio.Event()

    async def slow(settings, session, whatsapp):
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
