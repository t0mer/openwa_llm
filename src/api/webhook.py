import json
import logging
from typing import Annotated, Any

from cachetools import TTLCache
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from api.deps import build_handler, get_db_async_session, get_registry
from config import Settings, get_settings
from whatsapp import GroupEvent, InboundMessage, InboundReaction
from whatsapp.init_groups import gather_groups
from whatsapp.openwa_webhook import parse_event, verify_signature

logger = logging.getLogger(__name__)

router = APIRouter(tags=["webhook"])

# Delivery is at-least-once: remember idempotency keys of deliveries we finished.
_seen_keys: TTLCache = TTLCache(maxsize=2000, ttl=10 * 60)
# Keys currently being processed, so concurrent duplicates are not run twice.
_in_flight: set[str] = set()

# Upper bound for an (unauthenticated, pre-signature) request body.
MAX_BODY_BYTES = 2 * 1024 * 1024


async def _read_body_limited(request: Request) -> bytes:
    """Read the body, raising 413 if it exceeds MAX_BODY_BYTES."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="payload too large")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail="payload too large")
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/webhook/{session_pk}")
async def webhook(
    session_pk: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db_async_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Any:
    """OpenWA webhook for one session. Returns "ok" to acknowledge receipt."""
    return await _handle(request, session_pk, db, settings)


@router.post("/webhook")
async def legacy_webhook(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db_async_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Any:
    """Legacy single-session webhook; 404 unless exactly one session is active."""
    return await _handle(request, None, db, settings)


async def _handle(
    request: Request,
    session_pk: str | None,
    db: AsyncSession,
    settings: Settings,
) -> Any:
    body = await _read_body_limited(request)
    registry = get_registry(request)
    # Verify before revealing anything about which sessions exist; the secret
    # is shared by every session, so no lookup is needed first.
    secret = registry.webhook_secret
    if not secret or not verify_signature(
        secret, body, request.headers.get("X-OpenWA-Signature")
    ):
        raise HTTPException(status_code=401, detail="invalid signature")

    ids = registry.ids()
    if session_pk is None:
        if len(ids) != 1:
            raise HTTPException(status_code=404, detail="session not found")
        session_pk = ids[0]

    try:
        envelope = json.loads(body)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid JSON")
    if not isinstance(envelope, dict):
        raise HTTPException(status_code=400, detail="expected a JSON object")

    if session_pk not in ids:
        logger.info("Ignoring webhook for unknown or inactive session %s", session_pk)
        return {"status": "ignored"}

    header = request.headers.get("X-OpenWA-Idempotency-Key")
    key = f"{session_pk}:{header}" if header else None
    if key and (key in _seen_keys or key in _in_flight):
        logger.info("Skipping duplicate delivery %s", key)
        return "ok"
    if key:
        _in_flight.add(key)
    try:
        event = parse_event(envelope)
        if isinstance(event, (InboundMessage, InboundReaction)):
            await build_handler(request, db, session_pk, settings)(event)
        elif isinstance(event, GroupEvent):
            # Keep GROUPS table in sync when group-related events happen
            await gather_groups(db, registry.get(session_pk), session_pk)
        # Mark seen only after success, so a failed delivery is retried by OpenWA.
        if key:
            _seen_keys[key] = True
    finally:
        if key:
            _in_flight.discard(key)
    return "ok"
