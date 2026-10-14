import asyncio
from contextlib import asynccontextmanager
from warnings import warn

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession
import logging
import logfire

from admin import admin_router, spa_router
from admin.auth import admin_config_warning
from admin.actions import runner as admin_actions
from api import load_new_kbtopics_api, status, summarize_and_send_to_group_api, webhook
import models  # noqa
from config import get_settings
from scheduling.runner import start_scheduler
from openwa_settings.crypto import SecretBox
from openwa_settings.registry import GatewayRegistry
from openwa_settings.store import load_connection, seed_from_env, webhook_url_for
from whatsapp import OpenWAGateway
from whatsapp.init_groups import gather_groups
from whatsapp.webhook_registration import WEBHOOK_EVENTS, register_webhook_with_retry
from voyageai.client_async import AsyncClient

logger = logging.getLogger(__name__)


def _active_gateway(app: FastAPI, pk: str) -> OpenWAGateway | None:
    """The session's gateway, or None when a reload removed it meanwhile."""
    try:
        return app.state.registry.get(pk)
    except KeyError:
        logger.info("OpenWA session %s is no longer active; skipping its task", pk)
        return None


async def _sync_groups(app: FastAPI, pk: str) -> None:
    if (gateway := _active_gateway(app, pk)) is None:
        return
    async with app.state.async_session() as db:
        try:
            await gather_groups(db, gateway, pk)
            await db.commit()
        except Exception:
            await db.rollback()
            raise


async def _register_webhook(app: FastAPI, pk: str) -> None:
    registry = app.state.registry
    async with app.state.async_session() as db:
        conn = await load_connection(db)
    url = webhook_url_for(conn, pk) if conn is not None else ""
    if not url:
        logger.info("No webhook URL configured; not registering session %s", pk)
        return
    if not registry.webhook_secret:
        logger.info("No webhook secret available; not registering session %s", pk)
        return
    if (gateway := _active_gateway(app, pk)) is None:
        return
    if await register_webhook_with_retry(
        gateway, url, registry.webhook_secret, WEBHOOK_EVENTS
    ):
        # The first sync may have run before OpenWA was ready; redo it now.
        await _sync_groups(app, pk)


def _task_done(app: FastAPI, task: asyncio.Task) -> None:
    """Forget a finished session task and log its failure."""
    try:
        app.state.bg_tasks.remove(task)
    except ValueError:
        pass
    if task.cancelled() or (exc := task.exception()) is None:
        return
    # Only the type: the message can carry OpenWA's response or request data.
    logger.error("Background task %s failed: %s", task.get_name(), type(exc).__name__)


def start_session_tasks(app: FastAPI, pk: str) -> None:
    """Sync groups and register the per-session webhook for one active session."""
    # Keep references so tasks are not garbage-collected mid-flight; each one
    # removes itself when done, so repeated settings saves do not pile up.
    for name, coro in (
        ("sync-groups", _sync_groups(app, pk)),
        ("register-webhook", _register_webhook(app, pk)),
    ):
        task = asyncio.create_task(coro, name=f"{name}:{pk}")
        task.add_done_callback(lambda t: _task_done(app, t))
        app.state.bg_tasks.append(task)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    # Create and configure logger
    logging.basicConfig(
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        level=settings.log_level,
    )

    app.state.settings = settings

    if (admin_warning := admin_config_warning(settings)) is not None:
        logger.warning(admin_warning)

    if settings.db_uri.startswith("postgresql://"):
        warn("use 'postgresql+asyncpg://' instead of 'postgresql://' in db_uri")
    engine = create_async_engine(
        settings.db_uri,
        pool_size=20,
        max_overflow=40,
        pool_timeout=30,
        pool_pre_ping=True,
        pool_recycle=600,
        future=True,
    )
    logfire.instrument_sqlalchemy(engine)
    async_session = async_sessionmaker(
        engine, expire_on_commit=False, class_=AsyncSession
    )

    app.state.db_engine = engine
    app.state.async_session = async_session
    app.state.bg_tasks = []

    box = SecretBox(settings.settings_encryption_key.get_secret_value())
    app.state.secret_box = box
    app.state.registry = GatewayRegistry(box)
    app.state.start_session_tasks = start_session_tasks  # used by admin settings
    async with async_session() as db:
        await seed_from_env(db, settings, box)
        await app.state.registry.reload(db)
        await db.commit()
    for pk in app.state.registry.ids():
        start_session_tasks(app, pk)
    logger.info("OpenWA sessions active: %d", len(app.state.registry.ids()))

    app.state.embedding_client = AsyncClient(
        api_key=settings.voyage_api_key, max_retries=settings.voyage_max_retries
    )
    if (scheduler_task := start_scheduler(app)) is not None:
        app.state.bg_tasks.append(scheduler_task)
    try:
        yield
    finally:
        await admin_actions.shutdown()
        for task in app.state.bg_tasks:
            task.cancel()
        await asyncio.gather(*app.state.bg_tasks, return_exceptions=True)
        await app.state.registry.aclose()
        await engine.dispose()


# Initialize FastAPI app
app = FastAPI(title="Webhook API", lifespan=lifespan)

logfire.configure()
logfire.instrument_pydantic_ai()
logfire.instrument_fastapi(app)
logfire.instrument_httpx(capture_all=True)
logfire.instrument_system_metrics()


app.include_router(webhook.router)
app.include_router(status.router)
app.include_router(summarize_and_send_to_group_api.router)
app.include_router(load_new_kbtopics_api.router)
app.include_router(admin_router)
app.include_router(spa_router)

if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    print(f"Running on {settings.host}:{settings.port}")

    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=True)
