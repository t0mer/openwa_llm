from typing import Annotated, AsyncGenerator

from fastapi import Depends, HTTPException, Query, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from handler import MessageHandler
from openwa_settings.registry import GatewayRegistry
from whatsapp import WhatsAppGateway
from voyageai.client_async import AsyncClient
from config import Settings
from config import get_settings as get_settings  # re-exported for API modules


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


def get_optional_session_id(
    registry: Annotated[GatewayRegistry, Depends(get_registry)],
    session_id: Annotated[str | None, Query()] = None,
) -> str | None:
    """Like `get_session_id`, but None (not 400) while no session is active."""
    if session_id is None and not registry.ids():
        return None
    return get_session_id(registry, session_id)


def get_optional_whatsapp(
    registry: Annotated[GatewayRegistry, Depends(get_registry)],
    session_id: Annotated[str | None, Depends(get_optional_session_id)],
) -> WhatsAppGateway | None:
    return registry.get(session_id) if session_id is not None else None


def get_text_embebedding(request: Request) -> AsyncClient:
    assert request.app.state.embedding_client, "text embedding not initialized"
    return request.app.state.embedding_client


def build_handler(
    request: Request, db: AsyncSession, session_pk: str, settings: Settings
) -> MessageHandler:
    """Message handler bound to one active session's gateway."""
    return MessageHandler(
        db,
        request.app.state.registry.get(session_pk),
        get_text_embebedding(request),
        settings,
        session_pk,
    )
