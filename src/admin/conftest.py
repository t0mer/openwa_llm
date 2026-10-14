import base64
import os
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI

from admin.auth import CSRF_HEADER, CSRF_VALUE, SESSION_COOKIE, create_session_token
from admin.router import build_admin_router
from api.deps import get_db_async_session
from config import get_settings
from openwa_settings.crypto import SecretBox
from openwa_settings.registry import GatewayRegistry
from test_utils.openwa_session import TEST_SESSION_ID, StubRegistry
from whatsapp import OpenWAGateway
from whatsapp.types import SessionStatus

SECRET = "s" * 32


def settings():
    return SimpleNamespace(
        admin_password="pw",
        admin_session_secret=SECRET,
        admin_cookie_secure=False,
        timezone="Asia/Jerusalem",
    )


class FakeGateway:
    """Stand-in OpenWA gateway; every call is an AsyncMock."""

    def __init__(self, base_url: str, api_key: str, session_id: str) -> None:
        self.cfg = (base_url, api_key, session_id)
        self.get_status = AsyncMock(return_value=SessionStatus(status="WORKING"))
        self.ensure_webhook = AsyncMock(return_value=True)
        self.list_groups = AsyncMock(return_value=[])
        self.aclose = AsyncMock()


class FakeFactory:
    def __init__(self) -> None:
        self.built: list[FakeGateway] = []
        self.fail_for: set[str] = set()

    def __call__(self, base_url: str, api_key: str, session_id: str) -> OpenWAGateway:
        if session_id in self.fail_for:
            raise ValueError(f"rejected {session_id} with key {api_key}")
        gw = FakeGateway(base_url, api_key, session_id)
        self.built.append(gw)
        return cast(OpenWAGateway, gw)


@pytest_asyncio.fixture
async def openwa_state():
    """What the app lifespan puts on app.state for the OpenWA settings."""
    box = SecretBox(base64.b64encode(os.urandom(32)).decode())
    factory = FakeFactory()
    started: list[str] = []
    return SimpleNamespace(
        secret_box=box,
        factory=factory,
        registry=GatewayRegistry(box, factory),
        started=started,
        start_session_tasks=lambda _app, pk: started.append(pk),
    )


@pytest_asyncio.fixture
async def admin_app(db_sessionmaker, openwa_state):
    app = FastAPI()
    app.include_router(build_admin_router())
    app.state.secret_box = openwa_state.secret_box
    app.state.registry = openwa_state.registry
    app.state.start_session_tasks = openwa_state.start_session_tasks

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
    return app


@pytest.fixture
def active_sessions(admin_app):
    """Serve the given session pks as the active ones (default: the test session)."""

    def activate(*ids: str) -> None:
        admin_app.state.registry = StubRegistry({pk: object() for pk in ids})

    activate(TEST_SESSION_ID)
    return activate


@pytest_asyncio.fixture
async def admin_client(admin_app):
    transport = httpx.ASGITransport(app=admin_app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={CSRF_HEADER: CSRF_VALUE},
        cookies={SESSION_COOKIE: create_session_token(SECRET)},
    ) as c:
        yield c
