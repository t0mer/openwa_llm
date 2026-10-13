# ruff: noqa: F811
import asyncio
import base64

import pytest
from alembic import command
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

# fresh_db_uri is a fixture: importing it registers it here (hence F401/F811)
from test_migration_schedule import _config, fresh_db_uri  # noqa: F401

REV = "f6a7b8c9d0e1"
PREV = "e5f6a7b8c9d0"


async def _run(uri: str, *statements: str) -> None:
    engine = create_async_engine(uri)
    async with engine.begin() as conn:
        for sql in statements:
            await conn.execute(text(sql))
    await engine.dispose()


def _no_legacy_session(monkeypatch, tmp_path) -> None:
    """No OPENWA_SESSION_ID in the env, and no .env file for Settings to read."""
    monkeypatch.delenv("OPENWA_SESSION_ID", raising=False)
    monkeypatch.chdir(tmp_path)


def _dotenv_session(monkeypatch, tmp_path, session_id: str) -> None:
    """OPENWA_SESSION_ID only reachable through Settings reading a .env file."""
    monkeypatch.delenv("OPENWA_SESSION_ID", raising=False)
    (tmp_path / ".env").write_text(
        "DB_URI=postgresql+asyncpg://u:p@localhost/x\n"
        f"SETTINGS_ENCRYPTION_KEY={base64.b64encode(b'k' * 32).decode()}\n"
        "ANTHROPIC_API_KEY=x\n"
        "VOYAGE_API_KEY=x\n"
        "LOGFIRE_TOKEN=x\n"
        f"OPENWA_SESSION_ID={session_id}\n"
    )
    monkeypatch.chdir(tmp_path)


def _seed_rows(uri: str) -> None:
    asyncio.run(
        _run(
            uri,
            "INSERT INTO sender (jid) VALUES ('1@s.whatsapp.net')",
            """INSERT INTO "group" (group_jid, managed, notify_on_spam,
                   last_ingest, last_summary_sync, created_at)
               VALUES ('1@g.us', false, false, now(), now(), now())""",
            """INSERT INTO message (message_id, timestamp, text, chat_jid,
                   sender_jid, group_jid)
               VALUES ('m1', now(), 'hi', '1@g.us', '1@s.whatsapp.net', '1@g.us')""",
        )
    )


def _snapshot(uri: str):
    async def work():
        engine = create_async_engine(uri)
        async with engine.connect() as conn:
            sessions = (
                await conn.execute(
                    text("SELECT id, openwa_session_id, enabled FROM openwa_session")
                )
            ).all()
            group_ids = (
                (await conn.execute(text('SELECT session_id FROM "group"')))
                .scalars()
                .all()
            )
            message_ids = (
                (await conn.execute(text("SELECT session_id FROM message")))
                .scalars()
                .all()
            )

            def cols(sync_conn):
                insp = inspect(sync_conn)
                return {
                    table: {
                        c["name"]: c["nullable"]
                        for c in insp.get_columns(table)
                        if c["name"] == "session_id"
                    }
                    for table in ("group", "message")
                }

            nullable = await conn.run_sync(cols)
            version = (
                await conn.execute(text("SELECT version_num FROM alembic_version"))
            ).scalar_one()
        await engine.dispose()
        return sessions, group_ids, message_ids, nullable, version

    return asyncio.run(work())


def test_backfills_existing_rows_with_env_session(fresh_db_uri, monkeypatch):
    config = _config(fresh_db_uri)
    command.upgrade(config, PREV)
    _seed_rows(fresh_db_uri)

    monkeypatch.setenv("OPENWA_SESSION_ID", "legacy-1")
    command.upgrade(config, "head")

    sessions, group_ids, message_ids, nullable, version = _snapshot(fresh_db_uri)
    assert version == REV
    assert len(sessions) == 1
    session_id, openwa_session_id, enabled = sessions[0]
    assert openwa_session_id == "legacy-1" and enabled is True
    assert group_ids == [session_id]
    assert message_ids == [session_id]
    assert nullable == {
        "group": {"session_id": False},
        "message": {"session_id": False},
    }


def test_empty_tables_and_no_env_create_no_session(fresh_db_uri, monkeypatch, tmp_path):
    _no_legacy_session(monkeypatch, tmp_path)
    command.upgrade(_config(fresh_db_uri), "head")

    sessions, group_ids, message_ids, nullable, version = _snapshot(fresh_db_uri)
    assert version == REV
    assert sessions == [] and group_ids == [] and message_ids == []
    assert nullable == {
        "group": {"session_id": False},
        "message": {"session_id": False},
    }


def test_existing_rows_and_no_env_create_disabled_default(
    fresh_db_uri, monkeypatch, tmp_path
):
    _no_legacy_session(monkeypatch, tmp_path)
    config = _config(fresh_db_uri)
    command.upgrade(config, PREV)
    _seed_rows(fresh_db_uri)
    command.upgrade(config, "head")

    sessions, group_ids, message_ids, _, _ = _snapshot(fresh_db_uri)
    assert len(sessions) == 1
    session_id, openwa_session_id, enabled = sessions[0]
    assert openwa_session_id == "default" and enabled is False
    assert group_ids == [session_id] and message_ids == [session_id]


def test_downgrade_removes_tables_and_columns(fresh_db_uri, monkeypatch):
    monkeypatch.setenv("OPENWA_SESSION_ID", "legacy-1")
    config = _config(fresh_db_uri)
    command.upgrade(config, PREV)
    _seed_rows(fresh_db_uri)
    command.upgrade(config, "head")
    command.downgrade(config, PREV)

    async def work():
        engine = create_async_engine(fresh_db_uri)
        async with engine.connect() as conn:

            def check(sync_conn):
                insp = inspect(sync_conn)
                return (
                    insp.has_table("openwa_session"),
                    insp.has_table("openwa_connection"),
                    {c["name"] for c in insp.get_columns("group")},
                    {c["name"] for c in insp.get_columns("message")},
                )

            result = await conn.run_sync(check)
        await engine.dispose()
        return result

    has_session, has_conn, group_cols, message_cols = asyncio.run(work())
    assert not has_session and not has_conn
    assert "session_id" not in group_cols and "session_id" not in message_cols

    command.upgrade(config, "head")
    assert _snapshot(fresh_db_uri)[-1] == REV


@pytest.mark.parametrize("table", ["openwa_connection", "openwa_session"])
def test_new_tables_exist_at_head(fresh_db_uri, monkeypatch, tmp_path, table):
    _no_legacy_session(monkeypatch, tmp_path)
    command.upgrade(_config(fresh_db_uri), "head")

    async def work():
        engine = create_async_engine(fresh_db_uri)
        async with engine.connect() as conn:
            result = await conn.run_sync(lambda c: inspect(c).has_table(table))
        await engine.dispose()
        return result

    assert asyncio.run(work())


def test_backfills_existing_rows_with_session_from_dotenv(
    fresh_db_uri, monkeypatch, tmp_path
):
    config = _config(fresh_db_uri)
    command.upgrade(config, PREV)
    _seed_rows(fresh_db_uri)

    _dotenv_session(monkeypatch, tmp_path, "from-dotenv")
    command.upgrade(config, "head")

    sessions, group_ids, message_ids, _, _ = _snapshot(fresh_db_uri)
    assert len(sessions) == 1
    session_id, openwa_session_id, enabled = sessions[0]
    assert openwa_session_id == "from-dotenv" and enabled is True
    assert group_ids == [session_id] and message_ids == [session_id]


def test_env_session_with_empty_tables_creates_enabled_session(
    fresh_db_uri, monkeypatch
):
    monkeypatch.setenv("OPENWA_SESSION_ID", "legacy-1")
    command.upgrade(_config(fresh_db_uri), "head")

    sessions, group_ids, message_ids, _, _ = _snapshot(fresh_db_uri)
    assert [(s[1], s[2]) for s in sessions] == [("legacy-1", True)]
    assert group_ids == [] and message_ids == []
