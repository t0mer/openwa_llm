import json
import logging
from typing import Annotated

from cachetools import TTLCache
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from api.deps import get_db_async_session, get_handler, get_whatsapp
from config import Settings, get_settings
from handler import MessageHandler
from whatsapp import (
    GroupEvent,
    InboundMessage,
    InboundReaction,
    WhatsAppGateway,
)
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


@router.post("/webhook")
async def webhook(
    request: Request,
    handler: Annotated[MessageHandler, Depends(get_handler)],
    session: Annotated[AsyncSession, Depends(get_db_async_session)],
    whatsapp: Annotated[WhatsAppGateway, Depends(get_whatsapp)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> str:
    """OpenWA webhook endpoint. Returns "ok" to acknowledge receipt."""
    body = await _read_body_limited(request)
    if not verify_signature(
        settings.openwa_webhook_secret,
        body,
        request.headers.get("X-OpenWA-Signature"),
    ):
        raise HTTPException(status_code=401, detail="invalid signature")

    try:
        envelope = json.loads(body)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid JSON")
    if not isinstance(envelope, dict):
        raise HTTPException(status_code=400, detail="expected a JSON object")

    key = request.headers.get("X-OpenWA-Idempotency-Key")
    if key and (key in _seen_keys or key in _in_flight):
        logger.info("Skipping duplicate delivery %s", key)
        return "ok"
    if key:
        _in_flight.add(key)
    try:
        event = parse_event(envelope)
        if isinstance(event, (InboundMessage, InboundReaction)):
            await handler(event)
        elif isinstance(event, GroupEvent):
            # Keep GROUPS table in sync when group-related events happen
            await gather_groups(session, whatsapp)
        # Mark seen only after success, so a failed delivery is retried by OpenWA.
        if key:
            _seen_keys[key] = True
    finally:
        if key:
            _in_flight.discard(key)
    return "ok"
