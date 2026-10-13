import logging
from typing import Annotated, AsyncGenerator, Awaitable, Callable

from fastapi import Depends, HTTPException, Query, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from handler import MessageHandler
from openwa_settings.registry import GatewayRegistry
from whatsapp import WhatsAppGateway
from voyageai.client_async import AsyncClient
from config import Settings
from config import get_settings as get_settings  # re-exported for API modules


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
    return _gateway(registry, session_id)


def _gateway(registry: GatewayRegistry, session_id: str) -> WhatsAppGateway:
    try:
        return registry.get(session_id)
    except KeyError:  # removed by a reload after the session was resolved
        raise HTTPException(status_code=404, detail="session not found")


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
    return _gateway(registry, session_id) if session_id is not None else None


def get_requested_session_ids(
    registry: Annotated[GatewayRegistry, Depends(get_registry)],
    session_id: Annotated[str | None, Query()] = None,
) -> list[str]:
    """The explicit session (404 when not active), else every active session."""
    if session_id is None:
        return registry.ids()
    return [get_session_id(registry, session_id)]


SessionJob = Callable[[AsyncSession, WhatsAppGateway, str], Awaitable[object]]


async def run_for_sessions(
    request: Request, session_ids: list[str], job: SessionJob
) -> dict[str, str]:
    """Run `job` once per session, each with its own DB session.

    One failing session never stops the others; returns session id -> "ok" or
    "failed" (details are only logged). Raises 500 when every session failed.
    """
    if not session_ids:
        logger.info("No active OpenWA session: nothing to run")
        return {}
    registry: GatewayRegistry = request.app.state.registry
    results: dict[str, str] = {}
    for sid in session_ids:
        try:
            async with request.app.state.async_session() as db:
                await job(db, registry.get(sid), sid)
                await db.commit()
            results[sid] = "ok"
        except Exception:
            logger.exception("Run failed for OpenWA session %s", sid)
            results[sid] = "failed"
    if "ok" not in results.values():
        raise HTTPException(
            status_code=500,
            detail={"message": "failed for every session", "sessions": results},
        )
    return results


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
