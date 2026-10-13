# pyright: reportArgumentType=false
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import FastAPI

from api import load_new_kbtopics_api as kb_api
from api import summarize_and_send_to_group_api as api
from api.deps import get_settings, get_text_embebedding
from test_utils.openwa_session import StubRegistry

GW_A, GW_B = object(), object()


def make_app(gateways: dict) -> tuple[FastAPI, list]:
    app = FastAPI()
    app.include_router(api.router)
    app.include_router(kb_api.router)
    app.dependency_overrides[get_settings] = lambda: object()
    app.dependency_overrides[get_text_embebedding] = lambda: object()
    commits: list = []

    def db_factory():
        db = MagicMock()
        db.__aenter__ = AsyncMock(return_value=db)
        db.__aexit__ = AsyncMock(return_value=False)
        db.commit = AsyncMock(side_effect=lambda: commits.append(db))
        return db

    app.state.async_session = db_factory
    app.state.registry = StubRegistry(gateways)
    return app, commits


async def post(app: FastAPI, path: str, **params) -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        return await c.post(path, params=params)


@pytest.fixture
def summarize(monkeypatch):
    mock = AsyncMock(return_value=[])
    monkeypatch.setattr(api, "summarize_and_send_to_groups", mock)
    return mock


@pytest.fixture
def loader(monkeypatch):
    mock = MagicMock()
    mock.load_topics_for_all_groups = AsyncMock()
    monkeypatch.setattr(kb_api, "topicsLoader", lambda: mock)
    return mock.load_topics_for_all_groups


def calls(mock, gw_index: int) -> list[tuple]:
    return [(c.args[gw_index], c.args[3]) for c in mock.await_args_list]


async def test_summarize_without_session_runs_every_active_session(summarize):
    app, commits = make_app({"a": GW_A, "b": GW_B})
    r = await post(app, "/summarize_and_send_to_groups")
    assert r.status_code == 200
    assert r.json() == {
        "status": "success",
        "message": "send summaries to groups sync completed successfully",
        "sessions": {"a": "ok", "b": "ok"},
    }
    assert calls(summarize, 2) == [(GW_A, "a"), (GW_B, "b")]
    assert len(commits) == 2  # one DB session per OpenWA session


async def test_summarize_one_failing_session_does_not_stop_the_other(summarize):
    summarize.side_effect = [RuntimeError("secret boom"), []]
    app, _ = make_app({"a": GW_A, "b": GW_B})
    r = await post(app, "/summarize_and_send_to_groups")
    assert r.status_code == 200
    assert r.json()["sessions"] == {"a": "failed", "b": "ok"}
    assert "secret" not in r.text
    assert calls(summarize, 2) == [(GW_A, "a"), (GW_B, "b")]


async def test_summarize_fails_only_when_every_session_fails(summarize):
    summarize.side_effect = RuntimeError("down")
    app, _ = make_app({"a": GW_A, "b": GW_B})
    r = await post(app, "/summarize_and_send_to_groups")
    assert r.status_code == 500
    assert r.json()["detail"]["sessions"] == {"a": "failed", "b": "failed"}


async def test_summarize_without_active_sessions_is_a_noop(summarize):
    app, _ = make_app({})
    r = await post(app, "/summarize_and_send_to_groups")
    assert r.status_code == 200 and r.json()["sessions"] == {}
    summarize.assert_not_awaited()


async def test_summarize_explicit_session_runs_only_that_one(summarize):
    app, _ = make_app({"a": GW_A, "b": GW_B})
    r = await post(app, "/summarize_and_send_to_groups", session_id="b")
    assert r.status_code == 200 and r.json()["sessions"] == {"b": "ok"}
    assert calls(summarize, 2) == [(GW_B, "b")]
    r = await post(app, "/summarize_and_send_to_groups", session_id="nope")
    assert r.status_code == 404


async def test_load_kb_without_session_runs_every_active_session(loader):
    loader.side_effect = [RuntimeError("kb down"), None]
    app, _ = make_app({"a": GW_A, "b": GW_B})
    r = await post(app, "/load_new_kbtopics")
    assert r.status_code == 200
    assert r.json()["sessions"] == {"a": "failed", "b": "ok"}
    assert calls(loader, 2) == [(GW_A, "a"), (GW_B, "b")]


async def test_load_kb_explicit_session_and_noop(loader):
    app, _ = make_app({"a": GW_A, "b": GW_B})
    r = await post(app, "/load_new_kbtopics", session_id="a")
    assert r.json()["sessions"] == {"a": "ok"}
    assert calls(loader, 2) == [(GW_A, "a")]
    app, _ = make_app({})
    r = await post(app, "/load_new_kbtopics")
    assert r.status_code == 200 and r.json()["sessions"] == {}
