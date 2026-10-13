from uuid import uuid4

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from config import Settings
from models import OpenWAConnection, OpenWASession

from .crypto import SecretBox


async def load_connection(db: AsyncSession) -> OpenWAConnection | None:
    return await db.get(OpenWAConnection, 1)


async def list_sessions(
    db: AsyncSession, *, enabled_only: bool = False
) -> list[OpenWASession]:
    stmt = select(OpenWASession).order_by(OpenWASession.label)  # pyright: ignore[reportArgumentType]
    if enabled_only:
        stmt = stmt.where(OpenWASession.enabled == True)  # noqa: E712
    return list((await db.exec(stmt)).all())


def webhook_url_for(connection: OpenWAConnection, session_pk: str) -> str:
    if not connection.webhook_url:
        return ""
    return f"{connection.webhook_url.rstrip('/')}/{session_pk}"


async def seed_from_env(db: AsyncSession, settings: Settings, box: SecretBox) -> bool:
    """One-time import of legacy env settings; no-op once a connection exists."""
    if await load_connection(db) is not None:
        return False
    if not (
        settings.whatsapp_host
        and settings.openwa_api_key
        and settings.openwa_webhook_secret
    ):
        return False
    db.add(
        OpenWAConnection(
            id=1,
            base_url=settings.whatsapp_host,
            api_key_enc=box.encrypt(settings.openwa_api_key),
            webhook_secret_enc=box.encrypt(settings.openwa_webhook_secret),
            webhook_url=settings.openwa_webhook_url,
        )
    )
    if settings.openwa_session_id:
        existing = (
            await db.exec(
                select(OpenWASession).where(
                    OpenWASession.openwa_session_id == settings.openwa_session_id
                )
            )
        ).first()
        if existing is None:
            db.add(
                OpenWASession(
                    id=uuid4().hex,
                    label="default",
                    openwa_session_id=settings.openwa_session_id,
                )
            )
        else:
            existing.enabled = True
            db.add(existing)
    await db.flush()
    return True
