import hashlib
import hmac
import json
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import webhook as webhook_api
from api.deps import get_db_async_session
from config import get_settings

SECRET = "s" * 16

MESSAGE = {
    "event": "message.received",
    "timestamp": "2026-10-08T10:00:00Z",
    "data": {
        "id": "m1",
        "from": "972501234567@c.us",
        "chatId": "972501234567@c.us",
        "body": "hi",
        "type": "chat",
        "timestamp": 1790000000,
    },
}


class StubRegistry:
    def __init__(self, ids: list[str], secret: str | None = SECRET) -> None:
        self.webhook_secret = secret
        self.gateways = {pk: AsyncMock(name=f"gw-{pk}") for pk in ids}

    def ids(self) -> list[str]:
        return list(self.gateways)

    def get(self, pk: str):
        return self.gateways[pk]


@pytest.fixture
def ctx(monkeypatch: pytest.MonkeyPatch):
    webhook_api._seen_keys.clear()
    webhook_api._in_flight.clear()
    handlers: dict[str, AsyncMock] = {}

    def build(_request, _db, session_pk, _settings):
        return handlers.setdefault(session_pk, AsyncMock(name=f"h-{session_pk}"))

    monkeypatch.setattr(webhook_api, "build_handler", build)
    gather = AsyncMock()
    monkeypatch.setattr(webhook_api, "gather_groups", gather)
    app = FastAPI()
    app.include_router(webhook_api.router)
    app.state.registry = StubRegistry(["a", "b"])
    db = AsyncMock()
    app.dependency_overrides[get_db_async_session] = lambda: db
    app.dependency_overrides[get_settings] = lambda: Mock()
    return TestClient(app), handlers, gather, db


def _post(client, path, payload=MESSAGE, *, secret=SECRET, key=None):
    body = json.dumps(payload).encode()
    headers = {
        "content-type": "application/json",
        "X-OpenWA-Signature": "sha256="
        + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest(),
    }
    if key:
        headers["X-OpenWA-Idempotency-Key"] = key
    return client.post(path, content=body, headers=headers)


def _calls(handlers, pk: str) -> int:
    return handlers[pk].await_count if pk in handlers else 0


def test_valid_signature_dispatches_handler_for_that_session(ctx):
    client, handlers, *_ = ctx
    resp = _post(client, "/webhook/a")
    assert resp.status_code == 200 and resp.json() == "ok"
    assert _calls(handlers, "a") == 1
    assert _calls(handlers, "b") == 0


def test_group_event_resyncs_that_sessions_gateway(ctx):
    client, handlers, gather, db = ctx
    assert (
        _post(client, "/webhook/b", {"event": "group.join", "data": {}}).status_code
        == 200
    )
    gather.assert_awaited_once_with(db, client.app.state.registry.get("b"), "b")
    assert _calls(handlers, "b") == 0


def test_bad_signature_is_401(ctx):
    client, handlers, *_ = ctx
    assert _post(client, "/webhook/a", secret="x" * 16).status_code == 401
    assert handlers == {}


def test_unknown_session_with_valid_signature_is_ignored(ctx):
    client, handlers, gather, _ = ctx
    resp = _post(client, "/webhook/zzz")
    assert resp.status_code == 200 and resp.json() == {"status": "ignored"}
    assert handlers == {}
    gather.assert_not_awaited()


def test_unknown_session_with_bad_signature_is_401(ctx):
    client, handlers, *_ = ctx
    assert _post(client, "/webhook/zzz", secret="x" * 16).status_code == 401


@pytest.mark.parametrize("path", ["/webhook/a", "/webhook/zzz"])
def test_no_webhook_secret_configured_is_401(ctx, path):
    client, handlers, *_ = ctx
    client.app.state.registry.webhook_secret = None
    assert _post(client, path).status_code == 401
    assert handlers == {}


def test_idempotency_key_is_scoped_per_session(ctx):
    client, handlers, *_ = ctx
    assert _post(client, "/webhook/a", key="k").status_code == 200
    assert _post(client, "/webhook/b", key="k").status_code == 200
    assert _calls(handlers, "a") == 1
    assert _calls(handlers, "b") == 1
    assert _post(client, "/webhook/a", key="k").status_code == 200
    assert _calls(handlers, "a") == 1
    assert _calls(handlers, "b") == 1


def test_legacy_route_with_two_active_sessions_is_404(ctx):
    client, handlers, *_ = ctx
    assert _post(client, "/webhook").status_code == 404
    assert handlers == {}


def test_legacy_route_with_no_active_session_is_404(ctx):
    client, handlers, *_ = ctx
    client.app.state.registry = StubRegistry([])
    assert _post(client, "/webhook").status_code == 404


def test_legacy_route_with_one_active_session_dispatches_to_it(ctx):
    client, handlers, *_ = ctx
    client.app.state.registry = StubRegistry(["only"])
    resp = _post(client, "/webhook")
    assert resp.status_code == 200 and resp.json() == "ok"
    assert _calls(handlers, "only") == 1


def test_legacy_route_still_requires_signature(ctx):
    client, handlers, *_ = ctx
    client.app.state.registry = StubRegistry(["only"])
    assert _post(client, "/webhook", secret="x" * 16).status_code == 401
    assert handlers == {}
