"""Admin API for the OpenWA connection and its WhatsApp sessions.

Secrets are stored encrypted and never returned, logged or echoed: responses
only say whether a secret is set.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Annotated, Any, Callable
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from api.deps import get_db_async_session
from models import Group, OpenWAConnection, OpenWASession
from openwa_settings.crypto import SecretBox
from openwa_settings.registry import GatewayRegistry
from openwa_settings.store import list_sessions, load_connection, webhook_url_for
from whatsapp import GatewayError, OpenWAGateway
from whatsapp.gateway import describe_gateway_failure
from whatsapp.init_groups import gather_groups
from whatsapp.webhook_registration import WEBHOOK_EVENTS

from .schemas import (
    MAX_SECRET_LEN,
    MIN_SECRET_LEN,
    ConnectionOut,
    ConnectionPut,
    ConnectionTest,
    ConnectionTestResult,
    SessionCreate,
    SessionOut,
    SessionPatch,
    SessionSynced,
    WebhookRegistered,
)

router = APIRouter(tags=["admin-settings"])
log = logging.getLogger(__name__)

Db = Annotated[AsyncSession, Depends(get_db_async_session)]
# Bounds the live status check in the session list; a slow OpenWA only means
# the cached status is shown.
STATUS_TIMEOUT = 3.0
TEST_TIMEOUT = 10.0


def _box(request: Request) -> SecretBox:
    return request.app.state.secret_box


def _registry(request: Request) -> GatewayRegistry:
    return request.app.state.registry


def _start_tasks(request: Request) -> Callable[[Any, str], None]:
    """`start_session_tasks` from app/main.py, put on app.state by the lifespan."""
    return request.app.state.start_session_tasks


def _secret_or_keep(new: str | None, old_enc: str | None, box: SecretBox) -> str | None:
    return box.encrypt(new) if new else old_enc


def _check_secret(name: str, value: str | None, *, min_len: int) -> None:
    # Raised here, not in the schema, so the 422 never echoes the value.
    if value and not (min_len <= len(value) <= MAX_SECRET_LEN):
        raise HTTPException(
            status_code=422,
            detail=f"{name} must be {min_len}-{MAX_SECRET_LEN} characters",
        )


def _same_url(a: str, b: str) -> bool:
    return a.strip().rstrip("/") == b.strip().rstrip("/")


def _reenter_required(*missing: str) -> HTTPException:
    """Stored secrets are never sent to a changed host; names fields, no values."""
    return HTTPException(
        status_code=422,
        detail=f"{' and '.join(missing)} must be re-entered when base_url changes",
    )


def _connection_out(conn: OpenWAConnection | None) -> ConnectionOut:
    if conn is None:
        return ConnectionOut(
            base_url="", webhook_url="", api_key_set=False, webhook_secret_set=False
        )
    return ConnectionOut(
        base_url=conn.base_url,
        webhook_url=conn.webhook_url,
        api_key_set=bool(conn.api_key_enc),
        webhook_secret_set=bool(conn.webhook_secret_enc),
    )


async def _apply(request: Request, db: AsyncSession, *, restart_all: bool) -> None:
    """Commit, reload the registry, and start tasks for sessions that need them.

    Committing first (not just flushing) means the background tasks, which use
    their own DB sessions, see the new configuration.
    """
    registry = _registry(request)
    before = {pk: registry.get(pk) for pk in registry.ids()}
    await db.commit()
    errors = await registry.reload(db)
    for pk, error in errors.items():
        if error:
            log.warning("openwa session %s is not active: %s", pk, error)
    start = _start_tasks(request)
    for pk in registry.ids():
        if restart_all or before.get(pk) is not registry.get(pk):
            start(request.app, pk)


async def _get_session(db: AsyncSession, session_id: str) -> OpenWASession:
    row = await db.get(OpenWASession, session_id)
    if row is None:
        raise HTTPException(status_code=404, detail="session not found")
    return row


async def _openwa_id_taken(db: AsyncSession, openwa_id: str, exclude: str) -> bool:
    found = await db.exec(
        select(OpenWASession.id).where(
            OpenWASession.openwa_session_id == openwa_id, OpenWASession.id != exclude
        )
    )
    return found.first() is not None


async def _group_counts(db: AsyncSession) -> dict[str, int]:
    rows = await db.exec(
        select(col(Group.session_id), func.count()).group_by(col(Group.session_id))
    )
    return {session_id: int(n) for session_id, n in rows.all()}


def _session_out(
    row: OpenWASession, registry: GatewayRegistry, counts: dict[str, int]
) -> SessionOut:
    return SessionOut(
        id=row.id,
        label=row.label,
        openwa_session_id=row.openwa_session_id,
        enabled=row.enabled,
        status=row.status,
        error=registry.errors().get(row.id),
        group_count=counts.get(row.id, 0),
    )


async def _refresh_status(
    db: AsyncSession, registry: GatewayRegistry, rows: list[OpenWASession]
) -> None:
    """Best-effort live status for active sessions; failures keep the cached value."""
    active = set(registry.ids())

    async def one(row: OpenWASession) -> None:
        try:
            status = await asyncio.wait_for(
                registry.get(row.id).get_status(), STATUS_TIMEOUT
            )
        except Exception as exc:  # never fail the list call
            log.info(
                "openwa status check for %s failed: %s", row.id, type(exc).__name__
            )
            return
        row.status = status.status
        row.status_checked_at = datetime.now(timezone.utc)
        db.add(row)

    await asyncio.gather(*(one(r) for r in rows if r.id in active))
    await db.flush()


# --- connection ---------------------------------------------------------------


@router.get("/connection", response_model=ConnectionOut)
async def get_connection(db: Db) -> ConnectionOut:
    return _connection_out(await load_connection(db))


@router.put("/connection", response_model=ConnectionOut)
async def put_connection(
    body: ConnectionPut, request: Request, db: Db
) -> ConnectionOut:
    _check_secret("api_key", body.api_key, min_len=1)
    _check_secret("webhook_secret", body.webhook_secret, min_len=MIN_SECRET_LEN)
    box = _box(request)
    conn = await load_connection(db)
    if conn is not None and not _same_url(body.base_url, conn.base_url):
        missing = [
            name
            for name, value in (
                ("api_key", body.api_key),
                ("webhook_secret", body.webhook_secret),
            )
            if not value
        ]
        if missing:
            raise _reenter_required(*missing)
    api_key_enc = _secret_or_keep(body.api_key, conn and conn.api_key_enc, box)
    secret_enc = _secret_or_keep(
        body.webhook_secret, conn and conn.webhook_secret_enc, box
    )
    if not api_key_enc or not secret_enc:
        raise HTTPException(
            status_code=422, detail="api_key and webhook_secret are required"
        )
    if conn is None:
        conn = OpenWAConnection(
            id=1, base_url="", api_key_enc=api_key_enc, webhook_secret_enc=secret_enc
        )
    conn.base_url = body.base_url
    conn.webhook_url = body.webhook_url
    conn.api_key_enc = api_key_enc
    conn.webhook_secret_enc = secret_enc
    conn.updated_at = datetime.now(timezone.utc)
    db.add(conn)
    await db.flush()
    await _apply(request, db, restart_all=True)
    return _connection_out(conn)


@router.post("/connection/test", response_model=ConnectionTestResult)
async def test_connection(
    body: ConnectionTest, request: Request, db: Db
) -> ConnectionTestResult:
    """Check OpenWA with the given values, falling back to the stored ones."""
    conn = await load_connection(db)
    base_url = body.base_url or (conn.base_url if conn else "")
    api_key = body.api_key
    if not api_key and conn is not None and not _same_url(base_url, conn.base_url):
        raise _reenter_required("api_key")
    if not api_key and conn is not None:
        try:
            api_key = _box(request).decrypt(conn.api_key_enc)
        except ValueError as exc:
            return ConnectionTestResult(ok=False, detail=str(exc))
    session_id = body.openwa_session_id
    if not session_id:
        sessions = await list_sessions(db)
        session_id = sessions[0].openwa_session_id if sessions else ""
    if not (base_url and api_key and session_id):
        return ConnectionTestResult(
            ok=False, detail="base_url, api_key and openwa_session_id are required"
        )
    gateway: OpenWAGateway | None = None
    try:
        # Built inside the try: bad input (a non-ASCII key, an unusable URL)
        # fails in the constructor, and must be reported, not raised.
        gateway = OpenWAGateway(base_url, api_key, session_id, timeout=TEST_TIMEOUT)
        await gateway.get_status()
    except Exception as exc:
        # Only the status code or exception type: upstream text is never returned.
        return ConnectionTestResult(ok=False, detail=describe_gateway_failure(exc))
    finally:
        if gateway is not None:
            await gateway.aclose()
    return ConnectionTestResult(ok=True, detail="connected")


# --- sessions -----------------------------------------------------------------


@router.get("/sessions", response_model=list[SessionOut])
async def get_sessions(request: Request, db: Db) -> list[SessionOut]:
    registry = _registry(request)
    rows = await list_sessions(db)
    await _refresh_status(db, registry, rows)
    counts = await _group_counts(db)
    return [_session_out(r, registry, counts) for r in rows]


@router.post("/sessions", response_model=SessionOut, status_code=201)
async def create_session(body: SessionCreate, request: Request, db: Db) -> SessionOut:
    if await _openwa_id_taken(db, body.openwa_session_id, exclude=""):
        raise HTTPException(status_code=409, detail="openwa session id already used")
    row = OpenWASession(
        id=uuid4().hex, label=body.label, openwa_session_id=body.openwa_session_id
    )
    db.add(row)
    try:
        await db.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail="openwa session id already used")
    await _apply(request, db, restart_all=False)
    return _session_out(row, _registry(request), {})


@router.patch("/sessions/{session_id}", response_model=SessionOut)
async def patch_session(
    session_id: str, patch: SessionPatch, request: Request, db: Db
) -> SessionOut:
    row = await _get_session(db, session_id)
    sent = patch.model_fields_set
    if "openwa_session_id" in sent and patch.openwa_session_id is not None:
        if await _openwa_id_taken(db, patch.openwa_session_id, exclude=row.id):
            raise HTTPException(
                status_code=409, detail="openwa session id already used"
            )
        row.openwa_session_id = patch.openwa_session_id
    if "label" in sent and patch.label is not None:
        row.label = patch.label
    if "enabled" in sent and patch.enabled is not None:
        row.enabled = patch.enabled
    db.add(row)
    try:
        await db.flush()
    except IntegrityError:
        raise HTTPException(status_code=409, detail="openwa session id already used")
    await _apply(request, db, restart_all=False)
    counts = await _group_counts(db)
    return _session_out(row, _registry(request), counts)


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str, request: Request, db: Db) -> Response:
    row = await _get_session(db, session_id)
    if (await _group_counts(db)).get(row.id):
        raise HTTPException(
            status_code=409, detail="session still owns groups; disable it instead"
        )
    await db.delete(row)
    try:
        await db.flush()
    except IntegrityError:  # e.g. messages still reference it
        raise HTTPException(
            status_code=409, detail="session still owns data; disable it instead"
        )
    await _apply(request, db, restart_all=False)
    return Response(status_code=204)


async def _sync_groups(db: AsyncSession, gateway: OpenWAGateway, pk: str) -> int:
    """Import the session's groups from OpenWA; returns how many it now owns."""
    await gather_groups(db, gateway, pk)
    await db.commit()
    return (await _group_counts(db)).get(pk, 0)


@router.post("/sessions/{session_id}/sync", response_model=SessionSynced)
async def sync_session(session_id: str, request: Request, db: Db) -> SessionSynced:
    row = await _get_session(db, session_id)
    registry = _registry(request)
    if row.id not in registry.ids():
        raise HTTPException(status_code=409, detail="session is not active")
    try:
        gateway = registry.get(row.id)
    except KeyError:  # removed by a concurrent reload
        raise HTTPException(status_code=409, detail="session is not active")
    try:
        groups = await _sync_groups(db, gateway, row.id)
    except GatewayError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=502,
            detail=f"group sync failed: {describe_gateway_failure(exc)}",
        )
    return SessionSynced(groups=groups)


@router.post("/sessions/{session_id}/webhook", response_model=WebhookRegistered)
async def register_session_webhook(
    session_id: str, request: Request, db: Db
) -> WebhookRegistered:
    row = await _get_session(db, session_id)
    pk = row.id
    registry = _registry(request)
    if row.id not in registry.ids():
        raise HTTPException(status_code=409, detail="session is not active")
    conn = await load_connection(db)
    url = webhook_url_for(conn, row.id) if conn is not None else ""
    secret = registry.webhook_secret
    if not url or not secret:
        raise HTTPException(status_code=409, detail="no webhook url configured")
    try:
        await registry.get(row.id).ensure_webhook(url, secret, WEBHOOK_EVENTS)
    except GatewayError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"webhook registration failed: {describe_gateway_failure(exc)}",
        )
    except KeyError:  # removed by a concurrent reload
        raise HTTPException(status_code=409, detail="session is not active")
    # A fresh webhook usually means a new or repaired session: pull its groups too.
    # Best effort; the registration itself already succeeded.
    try:
        await _sync_groups(db, registry.get(pk), pk)
    except Exception as exc:
        await db.rollback()
        log.warning(
            "group sync after webhook for %s failed: %s", pk, type(exc).__name__
        )
    return WebhookRegistered(registered=True)
