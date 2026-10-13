import os

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

import models  # noqa: F401  (register tables)
from models import (
    Group,
    GroupSummarySchedule,
    KBTopic,
    Message,
    OpenWAConnection,
    OpenWASession,
    OptOut,
    Reaction,
    Sender,
)
from models.kb_topic_message import KBTopicMessage
from test_utils.openwa_session import OTHER_SESSION_ID, seed_session

TABLES = [
    model.__table__  # pyright: ignore[reportAttributeAccessIssue]
    for model in (
        Sender,
        OpenWAConnection,
        OpenWASession,
        Group,
        Message,
        Reaction,
        OptOut,
        GroupSummarySchedule,
        KBTopic,
        KBTopicMessage,
    )
]


def _test_uri() -> str | None:
    uri = os.environ.get("ADMIN_TEST_DB_URI")
    if not uri:
        return None
    database = make_url(uri).database or ""
    if "test" not in database:
        return None  # refuse to drop tables in a non-test database
    return uri


@pytest_asyncio.fixture(loop_scope="function")
async def db_sessionmaker():
    uri = _test_uri()
    if uri is None:
        pytest.skip("set ADMIN_TEST_DB_URI to a *test* Postgres database")
    engine = create_async_engine(uri)
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(lambda c: SQLModel.metadata.drop_all(c, tables=TABLES))
        await conn.run_sync(lambda c: SQLModel.metadata.create_all(c, tables=TABLES))
        await conn.execute(text("SELECT 1"))
    yield async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    await engine.dispose()


@pytest_asyncio.fixture(loop_scope="function")
async def session_row(db_sessionmaker) -> OpenWASession:
    """A committed OpenWA session row for DB-backed tests (id TEST_SESSION_ID)."""
    async with db_sessionmaker() as session:
        row = await seed_session(session)
        await session.commit()
    return row


@pytest_asyncio.fixture(loop_scope="function")
async def other_session_row(db_sessionmaker, session_row) -> OpenWASession:
    """A second committed OpenWA session row (id OTHER_SESSION_ID)."""
    async with db_sessionmaker() as session:
        row = await seed_session(session, OTHER_SESSION_ID)
        await session.commit()
    return row
