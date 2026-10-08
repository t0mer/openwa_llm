import asyncio
from contextlib import asynccontextmanager
from warnings import warn

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlmodel.ext.asyncio.session import AsyncSession
import logging
import logfire

from api import load_new_kbtopics_api, status, summarize_and_send_to_group_api, webhook
import models  # noqa
from config import get_settings
from whatsapp import OpenWAGateway
from whatsapp.init_groups import gather_groups
from voyageai.client_async import AsyncClient


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

    app.state.whatsapp = OpenWAGateway(
        settings.whatsapp_host,
        settings.openwa_api_key,
        settings.openwa_session_id,
    )

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

    async def sync_groups_on_startup() -> None:
        async with async_session() as session:
            try:
                await gather_groups(session, app.state.whatsapp)
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    asyncio.create_task(sync_groups_on_startup())

    async def register_webhook_on_startup() -> None:
        if not settings.openwa_webhook_url:
            return
        try:
            created = await app.state.whatsapp.ensure_webhook(
                settings.openwa_webhook_url,
                settings.openwa_webhook_secret,
                [
                    "message.received",
                    "message.reaction",
                    "group.join",
                    "group.leave",
                    "group.update",
                    "group.join_request",
                ],
            )
            logging.info("OpenWA webhook %s", "registered" if created else "present")
        except Exception as e:  # best effort: never block startup
            logging.warning("Could not register OpenWA webhook: %s", e)

    asyncio.create_task(register_webhook_on_startup())

    app.state.db_engine = engine
    app.state.async_session = async_session
    app.state.embedding_client = AsyncClient(
        api_key=settings.voyage_api_key, max_retries=settings.voyage_max_retries
    )
    try:
        yield
    finally:
        await app.state.whatsapp.aclose()
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

if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    print(f"Running on {settings.host}:{settings.port}")

    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=True)
