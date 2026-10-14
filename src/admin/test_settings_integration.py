from typing import cast
from unittest.mock import AsyncMock

import httpx
import pytest

from admin import settings as settings_api
from admin.auth import CSRF_HEADER, CSRF_VALUE
from admin.conftest import FakeGateway
from models import Group, OpenWAConnection, OpenWASession
from whatsapp import GatewayError
from whatsapp.types import GroupInfo, SessionStatus
from whatsapp.webhook_registration import WEBHOOK_EVENTS

BASE = "/api/v1/admin/settings"
API_KEY = "api-key-0123456789abcdef"
HOOK_SECRET = "hook-secret-0123456789"
CONNECTION = {
    "base_url": "http://owa:2785",
    "api_key": API_KEY,
    "webhook_secret": HOOK_SECRET,
    "webhook_url": "http://bot/webhook",
}


async def _put_connection(client, **overrides) -> httpx.Response:
    return await client.put(f"{BASE}/connection", json={**CONNECTION, **overrides})


async def _connection_row(db_sessionmaker) -> OpenWAConnection:
    async with db_sessionmaker() as db:
        row = await db.get(OpenWAConnection, 1)
    assert row is not None
    return row


async def _create_session(client, label="Main", openwa_session_id="wa-main") -> str:
    resp = await client.post(
        f"{BASE}/sessions",
        json={"label": label, "openwa_session_id": openwa_session_id},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _no_secrets(text: str, *row: OpenWAConnection) -> None:
    assert API_KEY not in text and HOOK_SECRET not in text
    for r in row:
        assert r.api_key_enc not in text and r.webhook_secret_enc not in text


# --- connection ---------------------------------------------------------------


async def test_fresh_db_connection_is_empty(admin_client):
    resp = await admin_client.get(f"{BASE}/connection")
    assert resp.status_code == 200
    assert resp.json() == {
        "base_url": "",
        "webhook_url": "",
        "api_key_set": False,
        "webhook_secret_set": False,
    }


async def test_put_stores_ciphertext_and_never_returns_secrets(
    admin_client, db_sessionmaker, openwa_state
):
    resp = await _put_connection(admin_client)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "base_url": "http://owa:2785",
        "webhook_url": "http://bot/webhook",
        "api_key_set": True,
        "webhook_secret_set": True,
    }
    row = await _connection_row(db_sessionmaker)
    assert row.api_key_enc != API_KEY and row.webhook_secret_enc != HOOK_SECRET
    assert openwa_state.secret_box.decrypt(row.api_key_enc) == API_KEY
    assert openwa_state.secret_box.decrypt(row.webhook_secret_enc) == HOOK_SECRET
    _no_secrets(resp.text, row)
    got = await admin_client.get(f"{BASE}/connection")
    _no_secrets(got.text, row)
    assert got.json() == resp.json()
    assert openwa_state.registry.webhook_secret == HOOK_SECRET


async def test_put_with_blank_secrets_keeps_stored_ones(admin_client, db_sessionmaker):
    assert (await _put_connection(admin_client)).status_code == 200
    before = await _connection_row(db_sessionmaker)
    resp = await _put_connection(
        admin_client, api_key=None, webhook_secret="", webhook_url="http://bot2/hook"
    )
    assert resp.status_code == 200, resp.text
    after = await _connection_row(db_sessionmaker)
    assert after.api_key_enc == before.api_key_enc
    assert after.webhook_secret_enc == before.webhook_secret_enc
    assert after.webhook_url == "http://bot2/hook"
    assert resp.json()["api_key_set"] and resp.json()["webhook_secret_set"]


@pytest.mark.parametrize(
    "missing", [{"api_key": None}, {"webhook_secret": ""}, {"api_key": "   "}]
)
async def test_first_put_without_secrets_is_422(admin_client, db_sessionmaker, missing):
    resp = await _put_connection(admin_client, **missing)
    assert resp.status_code == 422
    async with db_sessionmaker() as db:
        assert await db.get(OpenWAConnection, 1) is None


async def test_short_webhook_secret_is_422_and_not_echoed(admin_client):
    resp = await _put_connection(admin_client, webhook_secret="  short-secret  ")
    assert resp.status_code == 422
    assert "short-secret" not in resp.text


@pytest.mark.parametrize(
    "field,value",
    [
        ("base_url", "owa:2785"),
        ("base_url", "ftp://owa"),
        ("base_url", "http://"),
        ("base_url", ""),
        ("webhook_url", "bot/webhook"),
    ],
)
async def test_invalid_urls_are_422(admin_client, field, value):
    resp = await _put_connection(admin_client, **{field: value})
    assert resp.status_code == 422


async def test_put_trims_whitespace(admin_client, db_sessionmaker, openwa_state):
    resp = await _put_connection(
        admin_client,
        base_url="  http://owa:2785  ",
        api_key=f"  {API_KEY} ",
        webhook_secret=f"\t{HOOK_SECRET}\n",
        webhook_url=" http://bot/webhook ",
    )
    assert resp.status_code == 200, resp.text
    row = await _connection_row(db_sessionmaker)
    assert row.base_url == "http://owa:2785"
    assert row.webhook_url == "http://bot/webhook"
    assert openwa_state.secret_box.decrypt(row.api_key_enc) == API_KEY
    assert openwa_state.secret_box.decrypt(row.webhook_secret_enc) == HOOK_SECRET


async def test_connection_change_restarts_every_active_session(
    admin_client, openwa_state
):
    await _put_connection(admin_client)
    a = await _create_session(admin_client, "A", "wa-a")
    b = await _create_session(admin_client, "B", "wa-b")
    openwa_state.started.clear()
    resp = await _put_connection(admin_client, webhook_url="http://bot2/webhook")
    assert resp.status_code == 200
    assert sorted(openwa_state.started) == sorted([a, b])


async def test_connection_test_reports_gateway_error(
    admin_client, monkeypatch, openwa_state
):
    await _put_connection(admin_client)
    await _create_session(admin_client)
    built: list[FakeGateway] = []

    def factory(base_url, api_key, session_id, **_kw):
        gw = FakeGateway(base_url, api_key, session_id)
        gw.get_status = AsyncMock(side_effect=GatewayError("boom"))
        built.append(gw)
        return gw

    monkeypatch.setattr(settings_api, "OpenWAGateway", factory)
    resp = await admin_client.post(
        f"{BASE}/connection/test", json={"base_url": " http://owa:2785 ", "api_key": ""}
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": False, "detail": "cannot reach OpenWA (GatewayError)"}
    (gw,) = built
    assert gw.cfg == (
        "http://owa:2785",
        API_KEY,
        "wa-main",
    )  # stored key, first session
    gw.aclose.assert_awaited_once()
    assert API_KEY not in resp.text


async def test_connection_test_success_with_explicit_values(admin_client, monkeypatch):
    built: list[FakeGateway] = []

    def factory(base_url, api_key, session_id, **_kw):
        gw = FakeGateway(base_url, api_key, session_id)
        gw.get_status = AsyncMock(return_value=SessionStatus(status="WORKING"))
        built.append(gw)
        return gw

    monkeypatch.setattr(settings_api, "OpenWAGateway", factory)
    resp = await admin_client.post(
        f"{BASE}/connection/test",
        json={
            "base_url": "http://owa:2785",
            "api_key": "explicit-key",
            "openwa_session_id": " wa-x ",
        },
    )
    assert resp.json() == {"ok": True, "detail": "connected"}
    assert built[0].cfg == ("http://owa:2785", "explicit-key", "wa-x")
    built[0].aclose.assert_awaited_once()


async def test_connection_test_without_config_is_not_ok(admin_client, monkeypatch):
    monkeypatch.setattr(
        settings_api, "OpenWAGateway", lambda *a, **k: pytest.fail("must not build")
    )
    resp = await admin_client.post(f"{BASE}/connection/test", json={})
    assert resp.status_code == 200
    assert resp.json()["ok"] is False


async def test_connection_test_redacts_the_api_key(admin_client, monkeypatch):
    def factory(base_url, api_key, session_id, **_kw):
        gw = FakeGateway(base_url, api_key, session_id)
        gw.get_status = AsyncMock(side_effect=GatewayError(f"echo {api_key}"))
        return gw

    monkeypatch.setattr(settings_api, "OpenWAGateway", factory)
    resp = await admin_client.post(
        f"{BASE}/connection/test",
        json={"base_url": "http://owa", "api_key": API_KEY, "openwa_session_id": "s"},
    )
    assert resp.json()["ok"] is False
    assert API_KEY not in resp.text


# --- sessions -----------------------------------------------------------------


async def test_create_session_and_duplicate_is_409(admin_client, openwa_state):
    await _put_connection(admin_client)
    resp = await admin_client.post(
        f"{BASE}/sessions", json={"label": "  Main  ", "openwa_session_id": " wa-1 "}
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["label"] == "Main" and body["openwa_session_id"] == "wa-1"
    assert body["enabled"] is True and body["group_count"] == 0
    assert body["id"] in openwa_state.registry.ids()
    assert openwa_state.started == [body["id"]]
    dup = await admin_client.post(
        f"{BASE}/sessions", json={"label": "Other", "openwa_session_id": "wa-1"}
    )
    assert dup.status_code == 409


@pytest.mark.parametrize(
    "body",
    [
        {"label": "", "openwa_session_id": "wa"},
        {"label": "x", "openwa_session_id": "   "},
        {"label": "x" * 101, "openwa_session_id": "wa"},
    ],
)
async def test_create_session_validation(admin_client, body):
    assert (await admin_client.post(f"{BASE}/sessions", json=body)).status_code == 422


async def test_session_without_connection_is_inactive(admin_client, openwa_state):
    pk = await _create_session(admin_client)
    assert openwa_state.registry.ids() == []
    assert openwa_state.started == []
    (row,) = (await admin_client.get(f"{BASE}/sessions")).json()
    assert row["id"] == pk and row["enabled"] is True


async def test_delete_session_with_groups_is_409(admin_client, db_sessionmaker):
    owner = await _create_session(admin_client, "A", "wa-a")
    empty = await _create_session(admin_client, "B", "wa-b")
    async with db_sessionmaker() as db:
        db.add(Group(session_id=owner, group_jid="1@g.us"))
        await db.commit()
    resp = await admin_client.delete(f"{BASE}/sessions/{owner}")
    assert resp.status_code == 409
    assert "disable it instead" in resp.json()["detail"]
    assert (await admin_client.delete(f"{BASE}/sessions/{empty}")).status_code == 204
    async with db_sessionmaker() as db:
        assert await db.get(OpenWASession, empty) is None
        assert await db.get(OpenWASession, owner) is not None
    assert (await admin_client.delete(f"{BASE}/sessions/{empty}")).status_code == 404


async def test_patch_enable_disable_updates_registry(admin_client, openwa_state):
    await _put_connection(admin_client)
    pk = await _create_session(admin_client)
    gw = cast(FakeGateway, openwa_state.registry.get(pk))
    openwa_state.started.clear()
    resp = await admin_client.patch(f"{BASE}/sessions/{pk}", json={"enabled": False})
    assert resp.status_code == 200
    assert resp.json()["enabled"] is False
    assert pk not in openwa_state.registry.ids()
    gw.aclose.assert_awaited_once()
    assert openwa_state.started == []
    resp = await admin_client.patch(f"{BASE}/sessions/{pk}", json={"enabled": True})
    assert resp.json()["enabled"] is True
    assert pk in openwa_state.registry.ids()
    assert openwa_state.started == [pk]


async def test_patch_label_only_does_not_restart(admin_client, openwa_state):
    await _put_connection(admin_client)
    pk = await _create_session(admin_client)
    openwa_state.started.clear()
    resp = await admin_client.patch(f"{BASE}/sessions/{pk}", json={"label": " New "})
    assert resp.json()["label"] == "New"
    assert openwa_state.started == []


async def test_patch_openwa_session_id_rebuilds_and_restarts(
    admin_client, openwa_state
):
    await _put_connection(admin_client)
    pk = await _create_session(admin_client)
    _other = await _create_session(admin_client, "Other", "wa-other")
    openwa_state.started.clear()
    resp = await admin_client.patch(
        f"{BASE}/sessions/{pk}", json={"openwa_session_id": " wa-new "}
    )
    assert resp.json()["openwa_session_id"] == "wa-new"
    assert cast(FakeGateway, openwa_state.registry.get(pk)).cfg[2] == "wa-new"
    assert openwa_state.started == [pk]
    dup = await admin_client.patch(
        f"{BASE}/sessions/{pk}", json={"openwa_session_id": "wa-other"}
    )
    assert dup.status_code == 409


@pytest.mark.parametrize("body", [{"enabled": None}, {"label": None}, {"label": ""}])
async def test_patch_rejects_nulls_and_blanks(admin_client, body):
    pk = await _create_session(admin_client)
    resp = await admin_client.patch(f"{BASE}/sessions/{pk}", json=body)
    assert resp.status_code == 422


async def test_patch_unknown_session_is_404(admin_client):
    resp = await admin_client.patch(f"{BASE}/sessions/nope", json={"label": "x"})
    assert resp.status_code == 404


async def test_list_sessions_with_status_error_and_group_count(
    admin_client, db_sessionmaker, openwa_state
):
    openwa_state.factory.fail_for.add("wa-broken")
    await _put_connection(admin_client)
    a = await _create_session(admin_client, "A", "wa-a")
    b = await _create_session(admin_client, "B", "wa-b")
    broken = await _create_session(admin_client, "D", "wa-broken")
    off = await _create_session(admin_client, "C", "wa-c")
    await admin_client.patch(f"{BASE}/sessions/{off}", json={"enabled": False})
    async with db_sessionmaker() as db:
        db.add(Group(session_id=a, group_jid="1@g.us"))
        db.add(Group(session_id=a, group_jid="2@g.us"))
        await db.commit()
    gw_b = cast(FakeGateway, openwa_state.registry.get(b))
    gw_b.get_status = AsyncMock(side_effect=GatewayError("down"))
    resp = await admin_client.get(f"{BASE}/sessions")
    assert resp.status_code == 200
    rows = {r["id"]: r for r in resp.json()}
    assert [r["label"] for r in resp.json()] == ["A", "B", "C", "D"]
    assert rows[a]["status"] == "WORKING" and rows[a]["error"] is None
    assert rows[a]["group_count"] == 2
    assert rows[b]["status"] is None  # live check failed, cached value kept
    assert rows[b]["error"] is None
    assert rows[broken]["error"] and API_KEY not in rows[broken]["error"]
    assert API_KEY not in resp.text
    assert rows[off]["status"] is None and rows[off]["group_count"] == 0
    async with db_sessionmaker() as db:
        row = await db.get(OpenWASession, a)
        assert row is not None and row.status == "WORKING"
        assert row.status_checked_at is not None


async def test_register_webhook_action(admin_client, openwa_state):
    await _put_connection(admin_client)
    pk = await _create_session(admin_client)
    gw = cast(FakeGateway, openwa_state.registry.get(pk))
    resp = await admin_client.post(f"{BASE}/sessions/{pk}/webhook")
    assert resp.status_code == 200
    assert resp.json() == {"registered": True}
    gw.ensure_webhook.assert_awaited_once_with(
        f"http://bot/webhook/{pk}", HOOK_SECRET, WEBHOOK_EVENTS
    )
    gw.ensure_webhook = AsyncMock(side_effect=GatewayError(f"bad {HOOK_SECRET}"))
    resp = await admin_client.post(f"{BASE}/sessions/{pk}/webhook")
    assert resp.status_code == 502
    detail = resp.json()["detail"]
    assert detail.startswith("webhook registration failed")
    assert HOOK_SECRET not in resp.text


async def test_register_webhook_needs_an_active_session_and_url(
    admin_client, openwa_state
):
    assert (await admin_client.post(f"{BASE}/sessions/nope/webhook")).status_code == 404
    pk = await _create_session(admin_client)
    resp = await admin_client.post(f"{BASE}/sessions/{pk}/webhook")
    assert resp.status_code == 409  # no connection -> not active
    await _put_connection(admin_client, webhook_url="")
    resp = await admin_client.post(f"{BASE}/sessions/{pk}/webhook")
    assert resp.status_code == 409
    assert "webhook url" in resp.json()["detail"]


async def test_sync_session_imports_groups(admin_client, openwa_state):
    await _put_connection(admin_client)
    pk = await _create_session(admin_client)
    gw = cast(FakeGateway, openwa_state.registry.get(pk))
    gw.list_groups.return_value = [
        GroupInfo(jid="1@g.us", name="One"),
        GroupInfo(jid="2@g.us", name="Two"),
    ]
    resp = await admin_client.post(f"{BASE}/sessions/{pk}/sync")
    assert resp.status_code == 200
    assert resp.json() == {"groups": 2}
    rows = (await admin_client.get(f"{BASE}/sessions")).json()
    assert rows[0]["group_count"] == 2


async def test_sync_session_errors(admin_client, openwa_state):
    assert (await admin_client.post(f"{BASE}/sessions/nope/sync")).status_code == 404
    pk = await _create_session(admin_client)
    assert (await admin_client.post(f"{BASE}/sessions/{pk}/sync")).status_code == 409
    await _put_connection(admin_client)
    gw = cast(FakeGateway, openwa_state.registry.get(pk))
    gw.list_groups = AsyncMock(
        side_effect=GatewayError(f"-> 400: {UPSTREAM_TEXT}", status_code=400)
    )
    resp = await admin_client.post(f"{BASE}/sessions/{pk}/sync")
    assert resp.status_code == 502
    assert resp.json() == {"detail": "group sync failed: OpenWA returned HTTP 400"}
    assert UPSTREAM_TEXT not in resp.text


async def test_register_webhook_also_syncs_groups(admin_client, openwa_state):
    await _put_connection(admin_client)
    pk = await _create_session(admin_client)
    gw = cast(FakeGateway, openwa_state.registry.get(pk))
    gw.list_groups.return_value = [GroupInfo(jid="3@g.us", name="Three")]
    assert (await admin_client.post(f"{BASE}/sessions/{pk}/webhook")).status_code == 200
    gw.list_groups.assert_awaited()
    rows = (await admin_client.get(f"{BASE}/sessions")).json()
    assert rows[0]["group_count"] == 1
    # a failing sync never fails the webhook registration
    gw.list_groups = AsyncMock(side_effect=GatewayError("down"))
    assert (await admin_client.post(f"{BASE}/sessions/{pk}/webhook")).status_code == 200


ROUTES = [
    ("GET", "/connection"),
    ("PUT", "/connection"),
    ("POST", "/connection/test"),
    ("GET", "/sessions"),
    ("POST", "/sessions"),
    ("PATCH", "/sessions/x"),
    ("DELETE", "/sessions/x"),
    ("POST", "/sessions/x/webhook"),
    ("POST", "/sessions/x/sync"),
]


@pytest.mark.parametrize(("method", "path"), ROUTES)
async def test_unauthenticated_is_401(admin_app, method, path):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=admin_app),
        base_url="http://test",
        headers={CSRF_HEADER: CSRF_VALUE},
    ) as c:
        assert (await c.request(method, BASE + path)).status_code == 401


async def test_validation_errors_never_echo_secrets(admin_client):
    body = {k: v for k, v in CONNECTION.items() if k != "base_url"}
    resp = await admin_client.put(f"{BASE}/connection", json=body)
    assert resp.status_code == 422
    _no_secrets(resp.text)
    resp = await admin_client.put(
        f"{BASE}/connection", json={**CONNECTION, "base_url": "nope", "extra": 1}
    )
    assert resp.status_code == 422
    _no_secrets(resp.text)


# --- hardening: connection test, upstream text, link-local, secret reuse -------

UPSTREAM_TEXT = "upstream-body-must-not-leak"


async def test_connection_test_with_non_ascii_key_is_not_ok(admin_client):
    resp = await admin_client.post(
        f"{BASE}/connection/test",
        json={
            "base_url": "http://owa:2785",
            "api_key": "ключ",
            "openwa_session_id": "s",
        },
    )
    assert resp.status_code == 200
    assert resp.json() == {
        "ok": False,
        "detail": "cannot reach OpenWA (UnicodeEncodeError)",
    }
    assert "ключ" not in resp.text


async def test_connection_test_with_unusable_url_is_not_ok(admin_client):
    resp = await admin_client.post(
        f"{BASE}/connection/test",
        json={"base_url": "http://owa:abc", "api_key": "k", "openwa_session_id": "s"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": False, "detail": "cannot reach OpenWA (InvalidURL)"}


async def test_connection_test_with_malformed_ipv6_url_is_422(admin_client):
    resp = await admin_client.post(
        f"{BASE}/connection/test",
        json={"base_url": "http://[::1", "api_key": "k", "openwa_session_id": "s"},
    )
    assert resp.status_code == 422


@pytest.mark.parametrize(
    ("error", "detail"),
    [
        (
            GatewayError(f"OpenWA GET /x -> 401: {UPSTREAM_TEXT}", status_code=401),
            "OpenWA returned HTTP 401",
        ),
        (
            GatewayError(f"failed: {UPSTREAM_TEXT}"),
            "cannot reach OpenWA (GatewayError)",
        ),
        (RuntimeError(UPSTREAM_TEXT), "cannot reach OpenWA (RuntimeError)"),
    ],
)
async def test_connection_test_never_returns_upstream_text(
    admin_client, monkeypatch, error, detail
):
    built: list[FakeGateway] = []

    def factory(base_url, api_key, session_id, **_kw):
        gw = FakeGateway(base_url, api_key, session_id)
        gw.get_status = AsyncMock(side_effect=error)
        built.append(gw)
        return gw

    monkeypatch.setattr(settings_api, "OpenWAGateway", factory)
    resp = await admin_client.post(
        f"{BASE}/connection/test",
        json={"base_url": "http://owa", "api_key": API_KEY, "openwa_session_id": "s"},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": False, "detail": detail}
    assert UPSTREAM_TEXT not in resp.text and API_KEY not in resp.text
    built[0].aclose.assert_awaited_once()


async def test_register_webhook_failure_never_returns_upstream_text(
    admin_client, openwa_state
):
    await _put_connection(admin_client)
    pk = await _create_session(admin_client)
    gw = cast(FakeGateway, openwa_state.registry.get(pk))
    gw.ensure_webhook = AsyncMock(
        side_effect=GatewayError(f"-> 400: {UPSTREAM_TEXT}", status_code=400)
    )
    resp = await admin_client.post(f"{BASE}/sessions/{pk}/webhook")
    assert resp.status_code == 502
    assert resp.json() == {
        "detail": "webhook registration failed: OpenWA returned HTTP 400"
    }
    gw.ensure_webhook = AsyncMock(side_effect=GatewayError(UPSTREAM_TEXT))
    resp = await admin_client.post(f"{BASE}/sessions/{pk}/webhook")
    assert resp.json() == {
        "detail": "webhook registration failed: cannot reach OpenWA (GatewayError)"
    }


LINK_LOCAL = [
    "http://169.254.169.254",
    "http://169.254.0.1:2785/api",
    "http://[fe80::1]",
    "http://[fe80::1%25eth0]:80",
    "http://[::ffff:169.254.169.254]",
    "http://2852039166",  # 169.254.169.254 as a single number
]


@pytest.mark.parametrize("base_url", LINK_LOCAL)
async def test_link_local_base_url_is_rejected(admin_client, monkeypatch, base_url):
    monkeypatch.setattr(
        settings_api, "OpenWAGateway", lambda *a, **k: pytest.fail("must not build")
    )
    resp = await _put_connection(admin_client, base_url=base_url)
    assert resp.status_code == 422
    msgs = [e["msg"] for e in resp.json()["detail"]]
    assert any("link-local" in m for m in msgs)
    assert all(base_url not in m for m in msgs)
    resp = await admin_client.post(
        f"{BASE}/connection/test",
        json={"base_url": base_url, "api_key": "k", "openwa_session_id": "s"},
    )
    assert resp.status_code == 422


@pytest.mark.parametrize(
    "base_url",
    [
        "http://owa:2785",
        "http://10.0.0.5",
        "http://[::1]:2785",
        "http://169.254.example",
    ],
)
async def test_ordinary_hosts_are_accepted(admin_client, base_url):
    assert (await _put_connection(admin_client, base_url=base_url)).status_code == 200


@pytest.mark.parametrize(
    ("missing", "detail"),
    [
        ({"api_key": None}, "api_key must be re-entered when base_url changes"),
        (
            {"webhook_secret": ""},
            "webhook_secret must be re-entered when base_url changes",
        ),
        (
            {"api_key": " ", "webhook_secret": None},
            "api_key and webhook_secret must be re-entered when base_url changes",
        ),
    ],
)
async def test_put_with_changed_base_url_requires_new_secrets(
    admin_client, db_sessionmaker, missing, detail
):
    assert (await _put_connection(admin_client)).status_code == 200
    before = await _connection_row(db_sessionmaker)
    resp = await _put_connection(
        admin_client, base_url="https://evil.example", **missing
    )
    assert resp.status_code == 422
    assert resp.json() == {"detail": detail}
    after = await _connection_row(db_sessionmaker)
    assert after.base_url == "http://owa:2785"
    assert after.api_key_enc == before.api_key_enc


async def test_put_with_changed_base_url_and_new_secrets_is_saved(
    admin_client, db_sessionmaker, openwa_state
):
    assert (await _put_connection(admin_client)).status_code == 200
    resp = await _put_connection(
        admin_client,
        base_url="https://owa.example",
        api_key="new-key",
        webhook_secret="new-hook-secret-0123",
    )
    assert resp.status_code == 200, resp.text
    row = await _connection_row(db_sessionmaker)
    assert row.base_url == "https://owa.example"
    assert openwa_state.secret_box.decrypt(row.api_key_enc) == "new-key"


async def test_put_with_same_base_url_modulo_slash_keeps_secrets(
    admin_client, db_sessionmaker
):
    assert (await _put_connection(admin_client)).status_code == 200
    before = await _connection_row(db_sessionmaker)
    resp = await _put_connection(
        admin_client, base_url=" http://owa:2785/ ", api_key=None, webhook_secret=None
    )
    assert resp.status_code == 200, resp.text
    after = await _connection_row(db_sessionmaker)
    assert after.api_key_enc == before.api_key_enc
    assert after.webhook_secret_enc == before.webhook_secret_enc


async def test_connection_test_with_changed_base_url_requires_api_key(
    admin_client, monkeypatch
):
    await _put_connection(admin_client)
    await _create_session(admin_client)
    monkeypatch.setattr(
        settings_api, "OpenWAGateway", lambda *a, **k: pytest.fail("must not build")
    )
    for api_key in (None, "", "  "):
        resp = await admin_client.post(
            f"{BASE}/connection/test",
            json={"base_url": "http://elsewhere", "api_key": api_key},
        )
        assert resp.status_code == 422
        assert resp.json() == {
            "detail": "api_key must be re-entered when base_url changes"
        }


async def test_connection_test_with_same_base_url_uses_stored_key(
    admin_client, monkeypatch
):
    await _put_connection(admin_client)
    await _create_session(admin_client)
    built: list[FakeGateway] = []

    def factory(base_url, api_key, session_id, **_kw):
        gw = FakeGateway(base_url, api_key, session_id)
        built.append(gw)
        return gw

    monkeypatch.setattr(settings_api, "OpenWAGateway", factory)
    for base_url in (None, "http://owa:2785/"):
        resp = await admin_client.post(
            f"{BASE}/connection/test", json={"base_url": base_url, "api_key": ""}
        )
        assert resp.json() == {"ok": True, "detail": "connected"}
    assert [gw.cfg[1] for gw in built] == [API_KEY, API_KEY]
