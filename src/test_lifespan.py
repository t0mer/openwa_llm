"""Startup/shutdown of the real app lifespan against the *test* database.

OpenWA is never contacted: group sync and webhook registration are replaced
with mocks; only the per-session wiring is checked.
"""

import asyncio
import base64
import importlib.util
import os
from pathlib import Path
from unittest.mock import AsyncMock

import logfire
import pytest
from fastapi import FastAPI

from config import Settings
from models import OpenWAConnection, OpenWASession
from openwa_settings.crypto import SecretBox
from whatsapp import OpenWAGateway

MAIN = Path(__file__).resolve().parent.parent / "app" / "main.py"
KEY = base64.b64encode(os.urandom(32)).decode()


@pytest.fixture(scope="module")
def main_module():
    original = logfire.configure
    logfire.configure = lambda **_: original(
        send_to_logfire=False, console=False, metrics=False
    )
    try:
        spec = importlib.util.spec_from_file_location("lifespan_test_main", MAIN)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    finally:
        logfire.configure = original
    return module


@pytest.fixture
def mocks(main_module, monkeypatch):
    gather = AsyncMock()
    register = AsyncMock(return_value=True)
    monkeypatch.setattr(main_module, "gather_groups", gather)
    monkeypatch.setattr(main_module, "register_webhook_with_retry", register)
    return gather, register


@pytest.fixture
def boot(main_module, db_sessionmaker, monkeypatch):
    """`boot(app, **legacy_env)` -> the app's lifespan context on the test DB."""

    def run(app: FastAPI, **env):
        settings = Settings.model_validate(
            {
                "db_uri": os.environ["ADMIN_TEST_DB_URI"],
                "settings_encryption_key": KEY,
                "anthropic_api_key": "a",
                "voyage_api_key": "v",
                "logfire_token": "l",
                "scheduler_enabled": False,
                # explicit, so a local .env/environment cannot leak in
                **{k: "" for k in LEGACY},
                **env,
            }
        )
        monkeypatch.setattr(main_module, "get_settings", lambda: settings)
        return main_module.lifespan(app)

    return run


LEGACY = dict(
    whatsapp_host="http://owa:2785",
    openwa_api_key="api-key",
    openwa_session_id="wa-default",
    openwa_webhook_secret="webhook-secret-123456",
    openwa_webhook_url="http://bot/webhook",
)


async def test_fresh_install_boots_with_zero_gateways(boot, mocks):
    gather, register = mocks
    app = FastAPI()
    async with boot(app):
        assert app.state.registry.ids() == []
        assert app.state.bg_tasks == []
        assert not hasattr(app.state, "whatsapp")
    gather.assert_not_awaited()
    register.assert_not_awaited()


async def test_legacy_env_is_seeded_and_each_session_started(main_module, boot, mocks):
    gather, register = mocks
    app = FastAPI()
    async with boot(app, **LEGACY):
        registry = app.state.registry
        (pk,) = registry.ids()
        gateway = registry.get(pk)
        assert isinstance(gateway, OpenWAGateway)
        await asyncio.gather(*app.state.bg_tasks)
        gather.assert_awaited_once()
        assert gather.await_args.args[1:] == (gateway, pk)
        register.assert_awaited_once_with(
            gateway,
            f"http://bot/webhook/{pk}",
            "webhook-secret-123456",
            main_module.WEBHOOK_EVENTS,
        )
        assert registry.webhook_secret == "webhook-secret-123456"


async def test_registration_skipped_without_webhook_url(boot, mocks):
    gather, register = mocks
    app = FastAPI()
    async with boot(app, **{**LEGACY, "openwa_webhook_url": ""}):
        assert len(app.state.registry.ids()) == 1
        await asyncio.gather(*app.state.bg_tasks)
    gather.assert_awaited_once()
    register.assert_not_awaited()


async def test_undecryptable_connection_does_not_crash_startup(
    boot, mocks, db_sessionmaker
):
    gather, register = mocks
    other = SecretBox(base64.b64encode(os.urandom(32)).decode())
    async with db_sessionmaker() as db:
        db.add(
            OpenWAConnection(
                id=1,
                base_url="http://owa:2785",
                api_key_enc=other.encrypt("k"),
                webhook_secret_enc=other.encrypt("s" * 16),
            )
        )
        db.add(OpenWASession(id="a", label="A", openwa_session_id="wa-a"))
        await db.commit()
    app = FastAPI()
    async with boot(app):
        assert app.state.registry.ids() == []
        assert set(app.state.registry.errors()) == {"a"}
    gather.assert_not_awaited()
    register.assert_not_awaited()


async def test_session_tasks_tolerate_a_session_removed_before_they_run(
    main_module, mocks, db_sessionmaker
):
    gather, register = mocks
    box = SecretBox(KEY)
    async with db_sessionmaker() as db:
        db.add(
            OpenWAConnection(
                id=1,
                base_url="http://owa:2785",
                api_key_enc=box.encrypt("k"),
                webhook_secret_enc=box.encrypt("s" * 16),
                webhook_url="http://bot/webhook",
            )
        )
        await db.commit()

    class GoneRegistry:
        webhook_secret = "s" * 16

        def get(self, pk: str):
            raise KeyError(pk)

    app = FastAPI()
    app.state.registry = GoneRegistry()
    app.state.async_session = db_sessionmaker
    app.state.bg_tasks = []
    main_module.start_session_tasks(app, "gone")
    results = await asyncio.gather(*app.state.bg_tasks, return_exceptions=True)
    assert results == [None, None]
    gather.assert_not_awaited()
    register.assert_not_awaited()
