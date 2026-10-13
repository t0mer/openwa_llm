import asyncio
import base64
import os
from typing import cast
from unittest.mock import AsyncMock

from models import OpenWAConnection, OpenWASession
from openwa_settings.crypto import SecretBox
from openwa_settings.registry import GatewayRegistry
from whatsapp import OpenWAGateway


class FakeGateway:
    def __init__(self, base_url: str, api_key: str, session_id: str) -> None:
        self.cfg = (base_url, api_key, session_id)
        self.aclose = AsyncMock()


class FakeFactory:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []
        self.built: list[FakeGateway] = []

    def __call__(self, base_url: str, api_key: str, session_id: str) -> OpenWAGateway:
        self.calls.append((base_url, api_key, session_id))
        gw = FakeGateway(base_url, api_key, session_id)
        self.built.append(gw)
        return cast(OpenWAGateway, gw)


def _box() -> SecretBox:
    return SecretBox(base64.b64encode(os.urandom(32)).decode())


async def _seed(db_sessionmaker, box: SecretBox, *, base_url="http://owa:2785"):
    async with db_sessionmaker() as db:
        db.add(
            OpenWAConnection(
                id=1,
                base_url=base_url,
                api_key_enc=box.encrypt("api-key"),
                webhook_secret_enc=box.encrypt("hook-secret"),
                webhook_url="http://bot/webhook",
            )
        )
        db.add(OpenWASession(id="a", label="A", openwa_session_id="wa-a"))
        db.add(OpenWASession(id="b", label="B", openwa_session_id="wa-b"))
        await db.commit()


async def _reload(db_sessionmaker, registry: GatewayRegistry):
    async with db_sessionmaker() as db:
        return await registry.reload(db)


async def test_builds_a_gateway_per_enabled_session(db_sessionmaker):
    box, factory = _box(), FakeFactory()
    await _seed(db_sessionmaker, box)
    registry = GatewayRegistry(box, factory)
    result = await _reload(db_sessionmaker, registry)
    assert sorted(registry.ids()) == ["a", "b"]
    assert result == {"a": None, "b": None}
    assert sorted(factory.calls) == [
        ("http://owa:2785", "api-key", "wa-a"),
        ("http://owa:2785", "api-key", "wa-b"),
    ]
    assert registry.webhook_secret == "hook-secret"
    assert cast(FakeGateway, registry.get("a")).cfg[2] == "wa-a"
    assert registry.errors() == {}


async def test_reload_without_changes_keeps_gateways(db_sessionmaker):
    box, factory = _box(), FakeFactory()
    await _seed(db_sessionmaker, box)
    registry = GatewayRegistry(box, factory)
    await _reload(db_sessionmaker, registry)
    await _reload(db_sessionmaker, registry)
    assert len(factory.calls) == 2
    for gw in factory.built:
        gw.aclose.assert_not_awaited()


async def test_changed_base_url_rebuilds_and_closes_old(db_sessionmaker):
    box, factory = _box(), FakeFactory()
    await _seed(db_sessionmaker, box)
    registry = GatewayRegistry(box, factory)
    await _reload(db_sessionmaker, registry)
    old = {pk: registry.get(pk) for pk in registry.ids()}
    async with db_sessionmaker() as db:
        conn = await db.get(OpenWAConnection, 1)
        assert conn is not None
        conn.base_url = "http://elsewhere"
        db.add(conn)
        await db.commit()
    await _reload(db_sessionmaker, registry)
    assert len(factory.calls) == 4
    for pk, gw in old.items():
        cast(FakeGateway, gw).aclose.assert_awaited_once()
        assert cast(FakeGateway, registry.get(pk)).cfg[0] == "http://elsewhere"


async def test_disabled_and_removed_sessions_are_closed(db_sessionmaker):
    box, factory = _box(), FakeFactory()
    await _seed(db_sessionmaker, box)
    registry = GatewayRegistry(box, factory)
    await _reload(db_sessionmaker, registry)
    gw_a, gw_b = registry.get("a"), registry.get("b")
    async with db_sessionmaker() as db:
        a = await db.get(OpenWASession, "a")
        b = await db.get(OpenWASession, "b")
        assert a is not None and b is not None
        a.enabled = False
        db.add(a)
        await db.delete(b)
        await db.commit()
    await _reload(db_sessionmaker, registry)
    assert registry.ids() == []
    cast(FakeGateway, gw_a).aclose.assert_awaited_once()
    cast(FakeGateway, gw_b).aclose.assert_awaited_once()


async def test_no_connection_means_no_gateways(db_sessionmaker):
    factory = FakeFactory()
    registry = GatewayRegistry(_box(), factory)
    assert await _reload(db_sessionmaker, registry) == {}
    assert registry.ids() == []
    assert registry.webhook_secret is None
    assert factory.calls == []


async def test_undecryptable_secrets_are_reported_not_raised(db_sessionmaker):
    factory = FakeFactory()
    await _seed(db_sessionmaker, _box())  # encrypted with a different key
    registry = GatewayRegistry(_box(), factory)
    result = await _reload(db_sessionmaker, registry)
    assert registry.ids() == []
    assert set(registry.errors()) == {"a", "b"}
    assert all(result[pk] for pk in ("a", "b"))
    assert "api-key" not in str(result)
    assert registry.webhook_secret is None
    assert factory.calls == []


async def test_aclose_closes_every_gateway(db_sessionmaker):
    box, factory = _box(), FakeFactory()
    await _seed(db_sessionmaker, box)
    registry = GatewayRegistry(box, factory)
    await _reload(db_sessionmaker, registry)
    await registry.aclose()
    assert registry.ids() == []
    for gw in factory.built:
        gw.aclose.assert_awaited_once()


async def _change_base_url(db_sessionmaker, base_url: str) -> None:
    async with db_sessionmaker() as db:
        conn = await db.get(OpenWAConnection, 1)
        assert conn is not None
        conn.base_url = base_url
        db.add(conn)
        await db.commit()


async def test_reload_swaps_before_closing_old_gateways(db_sessionmaker):
    box, factory = _box(), FakeFactory()
    await _seed(db_sessionmaker, box)
    registry = GatewayRegistry(box, factory)
    await _reload(db_sessionmaker, registry)
    old_a = cast(FakeGateway, registry.get("a"))
    closing, release = asyncio.Event(), asyncio.Event()

    async def slow_close() -> None:
        closing.set()
        await release.wait()

    old_a.aclose = AsyncMock(side_effect=slow_close)
    await _change_base_url(db_sessionmaker, "http://elsewhere")
    task = asyncio.create_task(_reload(db_sessionmaker, registry))
    await asyncio.wait_for(closing.wait(), 5)
    # While the old gateway is still closing, lookups already see the new one.
    current = cast(FakeGateway, registry.get("a"))
    assert current is not old_a
    assert current.cfg[0] == "http://elsewhere"
    assert sorted(registry.ids()) == ["a", "b"]
    release.set()
    await task
    old_a.aclose.assert_awaited_once()


async def test_reload_survives_a_failing_aclose(db_sessionmaker, caplog):
    box, factory = _box(), FakeFactory()
    await _seed(db_sessionmaker, box)
    registry = GatewayRegistry(box, factory)
    await _reload(db_sessionmaker, registry)
    old_a = cast(FakeGateway, registry.get("a"))
    old_b = cast(FakeGateway, registry.get("b"))
    old_a.aclose = AsyncMock(side_effect=RuntimeError("socket gone"))
    await _change_base_url(db_sessionmaker, "http://elsewhere")
    result = await _reload(db_sessionmaker, registry)
    assert result == {"a": None, "b": None}
    old_b.aclose.assert_awaited_once()
    for pk in ("a", "b"):
        assert cast(FakeGateway, registry.get(pk)).cfg[0] == "http://elsewhere"
    assert "api-key" not in caplog.text and "hook-secret" not in caplog.text


async def test_factory_failure_is_isolated_per_session(db_sessionmaker):
    box, factory = _box(), FakeFactory()
    await _seed(db_sessionmaker, box)

    def flaky(base_url: str, api_key: str, session_id: str) -> OpenWAGateway:
        if session_id == "wa-b":
            raise ValueError(f"bad config for key {api_key}")
        return factory(base_url, api_key, session_id)

    registry = GatewayRegistry(box, flaky)
    result = await _reload(db_sessionmaker, registry)
    assert registry.ids() == ["a"]
    assert result["a"] is None
    assert result["b"] and "api-key" not in result["b"]
    assert set(registry.errors()) == {"b"}
    assert "api-key" not in registry.errors()["b"]


async def test_overlapping_reloads_apply_in_start_order(db_sessionmaker, monkeypatch):
    """A slow, older reload must not overwrite a newer one's snapshot.

    Request 1 disables A and reads ["b"] slowly; request 2 then disables B and
    reads [] quickly. The DB's final state has no enabled session, so the
    registry must end empty, not with the stale ["b"].
    """
    import openwa_settings.registry as registry_mod

    box, factory = _box(), FakeFactory()
    await _seed(db_sessionmaker, box)
    registry = GatewayRegistry(box, factory)
    await _reload(db_sessionmaker, registry)
    first_reading, release_first = asyncio.Event(), asyncio.Event()
    views = [
        [OpenWASession(id="b", label="B", openwa_session_id="wa-b")],
        [],
    ]
    calls = 0

    async def fake_list_sessions(db, *, enabled_only=False):
        nonlocal calls
        view = views[calls]
        calls += 1
        if calls == 1:
            first_reading.set()
            await release_first.wait()
        return view

    monkeypatch.setattr(registry_mod, "list_sessions", fake_list_sessions)
    first = asyncio.create_task(_reload(db_sessionmaker, registry))
    await asyncio.wait_for(first_reading.wait(), 5)
    second = asyncio.create_task(_reload(db_sessionmaker, registry))
    # Let the second reload run as far as it can (to completion if unserialized).
    await asyncio.wait({second}, timeout=1)
    release_first.set()
    await asyncio.wait_for(asyncio.gather(first, second), 5)
    assert registry.ids() == []


async def test_aclose_waits_for_a_running_reload(db_sessionmaker, monkeypatch):
    import openwa_settings.registry as registry_mod

    box, factory = _box(), FakeFactory()
    await _seed(db_sessionmaker, box)
    registry = GatewayRegistry(box, factory)
    reading, release = asyncio.Event(), asyncio.Event()
    real_list_sessions = registry_mod.list_sessions

    async def slow_list_sessions(db, *, enabled_only=False):
        reading.set()
        await release.wait()
        return await real_list_sessions(db, enabled_only=enabled_only)

    monkeypatch.setattr(registry_mod, "list_sessions", slow_list_sessions)
    reload_task = asyncio.create_task(_reload(db_sessionmaker, registry))
    await asyncio.wait_for(reading.wait(), 5)
    close_task = asyncio.create_task(registry.aclose())
    await asyncio.wait({close_task}, timeout=1)
    release.set()
    await asyncio.wait_for(asyncio.gather(reload_task, close_task), 5)
    # aclose ran after the reload, so nothing it built is left open.
    assert registry.ids() == []
    for gw in factory.built:
        gw.aclose.assert_awaited_once()
