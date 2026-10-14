import base64
import os
from types import SimpleNamespace
from typing import cast

from sqlmodel import select

from config import Settings
from models import OpenWAConnection, OpenWASession
from openwa_settings.crypto import SecretBox
from openwa_settings.store import (
    list_sessions,
    load_connection,
    seed_from_env,
    webhook_url_for,
)


def _box() -> SecretBox:
    return SecretBox(base64.b64encode(os.urandom(32)).decode())


def _env(**over) -> Settings:
    base = dict(
        whatsapp_host="http://owa:2785",
        openwa_api_key="api-key-123",
        openwa_session_id="legacy-sess",
        openwa_webhook_secret="webhook-secret-123456",
        openwa_webhook_url="http://bot/webhook",
    )
    base.update(over)
    return cast(Settings, SimpleNamespace(**base))


async def test_seed_creates_connection_and_session(db_sessionmaker):
    box = _box()
    async with db_sessionmaker() as db:
        assert (await list_sessions(db)) == []
        assert await seed_from_env(db, _env(), box) is True
        await db.commit()
    async with db_sessionmaker() as db:
        conn = await load_connection(db)
        assert conn is not None
        assert box.decrypt(conn.api_key_enc) == "api-key-123"
        assert box.decrypt(conn.webhook_secret_enc) == "webhook-secret-123456"
        sessions = await list_sessions(db, enabled_only=True)
        assert [s.openwa_session_id for s in sessions] == ["legacy-sess"]


async def test_seed_is_one_time(db_sessionmaker):
    box = _box()
    async with db_sessionmaker() as db:
        assert await seed_from_env(db, _env(), box) is True
        await db.commit()
    async with db_sessionmaker() as db:
        conn = await load_connection(db)
        assert conn is not None
        conn.base_url = "http://edited"
        db.add(conn)
        await db.commit()
    async with db_sessionmaker() as db:
        assert await seed_from_env(db, _env(), box) is False
        conn = await load_connection(db)
        assert conn is not None and conn.base_url == "http://edited"


async def test_seed_skips_when_env_blank(db_sessionmaker):
    async with db_sessionmaker() as db:
        env = _env(whatsapp_host="", openwa_api_key="", openwa_webhook_secret="")
        assert await seed_from_env(db, env, _box()) is False
        await db.commit()
    async with db_sessionmaker() as db:
        assert await load_connection(db) is None
        assert (await db.exec(select(OpenWAConnection))).all() == []
        assert (await db.exec(select(OpenWASession))).all() == []


async def test_seed_reuses_existing_session(db_sessionmaker):
    async with db_sessionmaker() as db:
        db.add(
            OpenWASession(
                id="pk1", label="x", openwa_session_id="legacy-sess", enabled=False
            )
        )
        await db.commit()
    async with db_sessionmaker() as db:
        assert await seed_from_env(db, _env(), _box()) is True
        await db.commit()
    async with db_sessionmaker() as db:
        rows = await list_sessions(db)
        assert len(rows) == 1
        assert rows[0].id == "pk1" and rows[0].enabled is True


def test_webhook_url_for():
    conn = OpenWAConnection(
        base_url="b",
        api_key_enc="a",
        webhook_secret_enc="w",
        webhook_url="http://h/webhook/",
    )
    assert webhook_url_for(conn, "abc") == "http://h/webhook/abc"
    conn.webhook_url = ""
    assert webhook_url_for(conn, "abc") == ""
