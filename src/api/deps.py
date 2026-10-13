import logging
from typing import Annotated, AsyncGenerator

from fastapi import Depends, HTTPException, Query, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from handler import MessageHandler
from openwa_settings.registry import GatewayRegistry
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


def get_registry(request: Request) -> GatewayRegistry:
    assert request.app.state.registry, "gateway registry not initialized"
    return request.app.state.registry


def get_session_id(
    registry: Annotated[GatewayRegistry, Depends(get_registry)],
    session_id: Annotated[str | None, Query()] = None,
) -> str:
    """The requested active session, or the only active one when omitted."""
    ids = registry.ids()
    if session_id is not None:
        if session_id not in ids:
            raise HTTPException(status_code=404, detail="session not found or inactive")
        return session_id
    if len(ids) == 1:
        return ids[0]
    raise HTTPException(status_code=400, detail="session_id required")


def get_whatsapp(
    registry: Annotated[GatewayRegistry, Depends(get_registry)],
    session_id: Annotated[str, Depends(get_session_id)],
) -> WhatsAppGateway:
    return registry.get(session_id)


def get_text_embebedding(request: Request) -> AsyncClient:
    assert request.app.state.embedding_client, "text embedding not initialized"
    return request.app.state.embedding_client


# TEMP(T5): the webhook becomes per-session; until then it uses the first active one.
def get_webhook_session_id(
    registry: Annotated[GatewayRegistry, Depends(get_registry)],
) -> str | None:
    ids = registry.ids()
    if not ids:
        logger.warning("No active OpenWA session; skipping webhook processing")
        return None
    return ids[0]


# TEMP(T5): the webhook becomes per-session; until then it uses the first active one.
def get_webhook_whatsapp(
    registry: Annotated[GatewayRegistry, Depends(get_registry)],
    session_id: Annotated[str | None, Depends(get_webhook_session_id)],
) -> WhatsAppGateway | None:
    return None if session_id is None else registry.get(session_id)


async def get_handler(
    session: Annotated[AsyncSession, Depends(get_db_async_session)],
    whatsapp: Annotated[WhatsAppGateway | None, Depends(get_webhook_whatsapp)],
    embedding_client: Annotated[AsyncClient, Depends(get_text_embebedding)],
    settings: Annotated[Settings, Depends(get_settings)],
    session_id: Annotated[str | None, Depends(get_webhook_session_id)],
) -> MessageHandler | None:
    if session_id is None or whatsapp is None:
        return None
    return MessageHandler(session, whatsapp, embedding_client, settings, session_id)
