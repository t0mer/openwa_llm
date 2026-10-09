import os
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

import models  # noqa: F401  (register tables)
from admin.auth import CSRF_HEADER, CSRF_VALUE, SESSION_COOKIE, create_session_token
from admin.router import build_admin_router
from api.deps import get_db_async_session
from config import get_settings
from models import Group, GroupSummarySchedule, Message, OptOut, Reaction, Sender

TABLES = [
    model.__table__  # pyright: ignore[reportAttributeAccessIssue]
    for model in (Sender, Group, Message, Reaction, OptOut, GroupSummarySchedule)
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
        await conn.run_sync(lambda c: SQLModel.metadata.drop_all(c, tables=TABLES))
        await conn.run_sync(lambda c: SQLModel.metadata.create_all(c, tables=TABLES))
        await conn.execute(text("SELECT 1"))
    yield async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    await engine.dispose()


SECRET = "s" * 32


def settings():
    return SimpleNamespace(
        admin_password="pw", admin_session_secret=SECRET, admin_cookie_secure=False
    )


@pytest_asyncio.fixture
async def admin_client(db_sessionmaker):
    app = FastAPI()
    app.include_router(build_admin_router())

    async def _session():
        async with db_sessionmaker() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db_async_session] = _session
    app.dependency_overrides[get_settings] = settings
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={CSRF_HEADER: CSRF_VALUE},
        cookies={SESSION_COOKIE: create_session_token(SECRET)},
    ) as c:
        yield c
