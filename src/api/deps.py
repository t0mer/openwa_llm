import logging
from typing import Annotated, AsyncGenerator

from fastapi import Depends, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from handler import MessageHandler
from models import OpenWASession
from whatsapp import WhatsAppGateway
from voyageai.client_async import AsyncClient
from config import Settings, get_settings

logger = logging.getLogger(__name__)


async def get_db_async_session(request: Request) -> AsyncGenerator[AsyncSession, None]:
    assert request.app.state.async_session, "AsyncSession generator not initialized"
    async with request.app.state.async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


def get_whatsapp(request: Request) -> WhatsAppGateway:
    assert request.app.state.whatsapp, "WhatsApp client not initialized"
    return request.app.state.whatsapp


def get_text_embebedding(request: Request) -> AsyncClient:
    assert request.app.state.embedding_client, "text embedding not initialized"
    return request.app.state.embedding_client


# TEMP(T4/T5): replaced by the session registry
async def first_openwa_session_id(session: AsyncSession) -> str | None:
    """Id of the first configured OpenWA session, or None when there is none."""
    result = await session.exec(
        select(OpenWASession.id).order_by(OpenWASession.id).limit(1)  # pyright: ignore[reportArgumentType]
    )
    return result.first()


# TEMP(T4/T5): replaced by the session registry
async def get_session_id(
    session: Annotated[AsyncSession, Depends(get_db_async_session)],
) -> str | None:
    session_id = await first_openwa_session_id(session)
    if session_id is None:
        logger.warning("No OpenWA session configured; skipping webhook processing")
    return session_id


async def get_handler(
    session: Annotated[AsyncSession, Depends(get_db_async_session)],
    whatsapp: Annotated[WhatsAppGateway, Depends(get_whatsapp)],
    embedding_client: Annotated[AsyncClient, Depends(get_text_embebedding)],
    settings: Annotated[Settings, Depends(get_settings)],
    session_id: Annotated[str | None, Depends(get_session_id)],
) -> MessageHandler | None:
    if session_id is None:
        return None
    return MessageHandler(session, whatsapp, embedding_client, settings, session_id)
