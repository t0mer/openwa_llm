import asyncio
import os
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

ROOT = Path(__file__).resolve().parents[1]
HEAD = "e5f6a7b8c9d0"
TABLE = "group_summary_schedule"


def _admin_uri() -> str:
    uri = os.environ.get("ADMIN_TEST_DB_URI")
    if not uri or "test" not in (make_url(uri).database or ""):
        pytest.skip("set ADMIN_TEST_DB_URI to a *test* Postgres database")
    return uri


async def _admin_sql(uri: str, sql: str) -> None:
    engine = create_async_engine(uri, isolation_level="AUTOCOMMIT")
    async with engine.connect() as conn:
        await conn.execute(text(sql))
    await engine.dispose()


@pytest.fixture
def fresh_db_uri():
    base = _admin_uri()
    name = f"test_mig_{uuid.uuid4().hex[:8]}"
    asyncio.run(_admin_sql(base, f'CREATE DATABASE "{name}"'))
    uri = make_url(base).set(database=name)
    asyncio.run(
        _admin_sql(
            uri.render_as_string(hide_password=False),
            "CREATE EXTENSION IF NOT EXISTS vector",
        )
    )
    try:
        yield uri.render_as_string(hide_password=False)
    finally:
        asyncio.run(_admin_sql(base, f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))


def _config(uri: str) -> Config:
    # no ini file: env.py would call logging.fileConfig and disable app loggers
    config = Config()
    config.set_main_option("script_location", str(ROOT / "migrations"))
    config.set_main_option("sqlalchemy.url", uri.replace("%", "%%"))
    return config


def test_schedule_migration_upgrade_downgrade_upgrade(fresh_db_uri):
    config = _config(fresh_db_uri)
    command.upgrade(config, "head")

    async def snapshot():
        engine = create_async_engine(fresh_db_uri)
        async with engine.connect() as conn:

            def work(sync_conn):
                insp = inspect(sync_conn)
                if not insp.has_table(TABLE):
                    return (False, [], [], set())
                return (
                    insp.has_table(TABLE),
                    insp.get_foreign_keys(TABLE),
                    insp.get_indexes(TABLE),
                    {c["name"] for c in insp.get_check_constraints(TABLE)},
                )

            result = await conn.run_sync(work)
            version = (
                await conn.execute(text("SELECT version_num FROM alembic_version"))
            ).scalar_one()
        await engine.dispose()
        return result, version

    (has, fks, idxs, checks), version = asyncio.run(snapshot())
    assert version == HEAD and has
    assert len(fks) == 1
    assert fks[0]["referred_table"] == "group"
    assert fks[0]["constrained_columns"] == ["group_jid"]
    assert fks[0]["options"].get("ondelete") == "CASCADE"
    assert any(i["column_names"] == ["group_jid"] for i in idxs)
    assert checks == {
        "ck_group_summary_schedule_hour",
        "ck_group_summary_schedule_minute",
        "ck_group_summary_schedule_weekdays_not_empty",
        "ck_group_summary_schedule_weekdays_range",
    }

    command.downgrade(config, "-1")
    (has, *_), version = asyncio.run(snapshot())
    assert not has and version == "d4e5f6a7b8c9"

    command.upgrade(config, "head")
    (has, *_), version = asyncio.run(snapshot())
    assert has and version == HEAD
