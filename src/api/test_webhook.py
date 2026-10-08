import hashlib
import hmac
import json
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import webhook as webhook_api
from api.deps import get_db_async_session, get_handler, get_whatsapp
from config import get_settings
from whatsapp import InboundMessage, InboundReaction

SECRET = "s" * 16


@pytest.fixture
def ctx(monkeypatch: pytest.MonkeyPatch):
    webhook_api._seen_keys.clear()
    webhook_api._in_flight.clear()
    handler = AsyncMock()
    gather = AsyncMock()
    monkeypatch.setattr(webhook_api, "gather_groups", gather)
    app = FastAPI()
    app.include_router(webhook_api.router)
    session, whatsapp = AsyncMock(), AsyncMock()
    app.dependency_overrides[get_handler] = lambda: handler
    app.dependency_overrides[get_db_async_session] = lambda: session
    app.dependency_overrides[get_whatsapp] = lambda: whatsapp
    app.dependency_overrides[get_settings] = lambda: Mock(openwa_webhook_secret=SECRET)
    return TestClient(app), handler, gather, session, whatsapp


def _post(client, payload, *, secret=SECRET, key=None, signature=True, raw=None):
    body = raw if raw is not None else json.dumps(payload).encode()
    headers = {"content-type": "application/json"}
    if signature:
        headers["X-OpenWA-Signature"] = (
            "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        )
    if key:
        headers["X-OpenWA-Idempotency-Key"] = key
    return client.post("/webhook", content=body, headers=headers)


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


def test_message_event_calls_handler_with_neutral_type(ctx):
    client, handler, gather, *_ = ctx
    resp = _post(client, MESSAGE)
    assert resp.status_code == 200 and resp.json() == "ok"
    (event,), _ = handler.await_args
    assert isinstance(event, InboundMessage)
    assert event.sender_jid == "972501234567@s.whatsapp.net"
    gather.assert_not_awaited()


def test_reaction_event_calls_handler(ctx):
    client, handler, *_ = ctx
    payload = {
        "event": "message.reaction",
        "timestamp": "2026-10-08T10:00:00Z",
        "data": {"messageId": "m1", "reaction": "👍", "senderId": "9725@c.us"},
    }
    assert _post(client, payload).status_code == 200
    (event,), _ = handler.await_args
    assert isinstance(event, InboundReaction)


@pytest.mark.parametrize("name", ["group.join", "Group.Update"])
def test_group_events_resync_groups(ctx, name):
    client, handler, gather, session, whatsapp = ctx
    assert _post(client, {"event": name, "data": {}}).status_code == 200
    handler.assert_not_awaited()
    gather.assert_awaited_once_with(session, whatsapp)


def test_other_events_are_acknowledged_and_ignored(ctx):
    client, handler, gather, *_ = ctx
    assert _post(client, {"event": "message.sent", "data": {}}).status_code == 200
    handler.assert_not_awaited()
    gather.assert_not_awaited()


def test_bad_missing_or_wrong_signature_is_401_and_not_processed(ctx):
    client, handler, *_ = ctx
    assert _post(client, MESSAGE, signature=False).status_code == 401
    assert _post(client, MESSAGE, secret="x" * 16).status_code == 401
    handler.assert_not_awaited()


def test_unconfigured_secret_rejects_everything(ctx):
    client, handler, *_ = ctx
    client.app.dependency_overrides[get_settings] = lambda: Mock(
        openwa_webhook_secret=""
    )
    assert _post(client, MESSAGE, secret="").status_code == 401
    handler.assert_not_awaited()


def test_malformed_json_is_400(ctx):
    client, handler, *_ = ctx
    assert _post(client, None, raw=b"{not json").status_code == 400
    assert _post(client, None, raw=b"[1,2]").status_code == 400
    handler.assert_not_awaited()


def test_duplicate_delivery_is_skipped(ctx):
    client, handler, *_ = ctx
    assert _post(client, MESSAGE, key="k1").status_code == 200
    assert _post(client, MESSAGE, key="k1").status_code == 200
    assert handler.await_count == 1


def test_failed_delivery_is_not_marked_seen_so_retry_reprocesses(ctx):
    client, handler, *_ = ctx
    client = TestClient(client.app, raise_server_exceptions=False)
    handler.side_effect = [RuntimeError("boom"), None]
    assert _post(client, MESSAGE, key="k2").status_code == 500
    assert _post(client, MESSAGE, key="k2").status_code == 200
    assert handler.await_count == 2


def test_oversized_content_length_is_413_and_not_processed(ctx):
    client, handler, *_ = ctx
    big = b"x" * (webhook_api.MAX_BODY_BYTES + 1)
    resp = client.post("/webhook", content=big)
    assert resp.status_code == 413
    handler.assert_not_awaited()


async def test_oversized_body_with_lying_content_length_is_413(ctx):
    import httpx

    client, handler, *_ = ctx
    big = b"x" * (webhook_api.MAX_BODY_BYTES + 1)
    transport = httpx.ASGITransport(app=client.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        resp = await c.post("/webhook", content=big, headers={"content-length": "10"})
    assert resp.status_code == 413
    handler.assert_not_awaited()


def test_body_at_limit_is_not_rejected_for_size(ctx):
    client, *_ = ctx
    resp = client.post("/webhook", content=b"x" * webhook_api.MAX_BODY_BYTES)
    assert resp.status_code == 401  # size ok; fails signature as expected


async def test_concurrent_duplicate_delivery_is_processed_once(ctx):
    import asyncio

    import httpx

    client, handler, *_ = ctx
    started, release = asyncio.Event(), asyncio.Event()

    async def slow(_event):
        started.set()
        await release.wait()

    handler.side_effect = slow
    body = json.dumps(MESSAGE).encode()
    headers = {
        "X-OpenWA-Signature": "sha256="
        + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest(),
        "X-OpenWA-Idempotency-Key": "kc",
    }
    transport = httpx.ASGITransport(app=client.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        first = asyncio.create_task(c.post("/webhook", content=body, headers=headers))
        await started.wait()
        second = await c.post("/webhook", content=body, headers=headers)
        release.set()
        first_resp = await first
    assert second.status_code == 200 and first_resp.status_code == 200
    assert handler.await_count == 1
