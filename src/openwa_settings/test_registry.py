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
