from types import SimpleNamespace

import httpx
import pytest_asyncio
from fastapi import FastAPI

from admin.auth import CSRF_HEADER, CSRF_VALUE, SESSION_COOKIE, create_session_token
from admin.router import build_admin_router
from api.deps import get_db_async_session
from config import get_settings

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
