import logging
from typing import Callable

from sqlmodel.ext.asyncio.session import AsyncSession

from whatsapp import OpenWAGateway

from .crypto import SecretBox
from .store import list_sessions, load_connection

log = logging.getLogger(__name__)
Factory = Callable[[str, str, str], OpenWAGateway]


class GatewayRegistry:
    """One OpenWA gateway per enabled session, rebuilt only when its config changes."""

    def __init__(self, box: SecretBox, factory: Factory = OpenWAGateway) -> None:
        self._box = box
        self._factory = factory
        self._gateways: dict[str, OpenWAGateway] = {}
        self._cfg: dict[str, tuple[str, str, str]] = {}
        self._errors: dict[str, str] = {}
        self.webhook_secret: str | None = None

    async def reload(self, db: AsyncSession) -> dict[str, str | None]:
        """Sync gateways with the DB; returns session pk -> error message or None.

        New gateways are built first and swapped in without an await in
        between, so `get()` never fails or returns a closed client for a session
        that stays active. Replaced gateways are closed afterwards, best-effort.
        One session's bad config never affects the others or raises.
        """
        conn = await load_connection(db)
        result: dict[str, str | None] = {}
        errors: dict[str, str] = {}
        wanted: dict[str, tuple[str, str, str]] = {}
        webhook_secret: str | None = None
        api_key: str | None = None
        if conn is not None:
            sessions = await list_sessions(db, enabled_only=True)
            try:
                webhook_secret = self._box.decrypt(conn.webhook_secret_enc)
                api_key = self._box.decrypt(conn.api_key_enc)
            except ValueError as exc:
                log.error("cannot decrypt openwa connection secrets: %s", exc)
                webhook_secret = None
                for s in sessions:
                    errors[s.id] = result[s.id] = str(exc)
            else:
                for s in sessions:
                    wanted[s.id] = (conn.base_url, api_key, s.openwa_session_id)
        # No await from here until the swap: read and replace atomically.
        gateways: dict[str, OpenWAGateway] = {}
        cfgs: dict[str, tuple[str, str, str]] = {}
        for pk, cfg in wanted.items():
            if pk in self._gateways and self._cfg.get(pk) == cfg:
                gateways[pk], cfgs[pk] = self._gateways[pk], cfg
                result[pk] = None
                continue
            try:
                gateways[pk] = self._factory(*cfg)
            except Exception as exc:
                msg = _redact(f"cannot create gateway: {exc}", api_key)
                log.error("openwa session %s: %s", pk, msg)
                errors[pk] = result[pk] = msg
                continue
            cfgs[pk] = cfg
            result[pk] = None
        retired = [
            gw for pk, gw in self._gateways.items() if gateways.get(pk) is not gw
        ]
        self._gateways, self._cfg, self._errors = gateways, cfgs, errors
        self.webhook_secret = webhook_secret
        for gw in retired:
            await _close_quietly(gw)
        return result

    def get(self, session_pk: str) -> OpenWAGateway:
        return self._gateways[session_pk]

    def ids(self) -> list[str]:
        return list(self._gateways)

    def errors(self) -> dict[str, str]:
        return dict(self._errors)

    async def aclose(self) -> None:
        gateways = list(self._gateways.values())
        self._gateways, self._cfg = {}, {}
        for gw in gateways:
            await _close_quietly(gw)


def _redact(message: str, secret: str | None) -> str:
    return message.replace(secret, "***") if secret else message


async def _close_quietly(gw: OpenWAGateway) -> None:
    try:
        await gw.aclose()
    except Exception as exc:
        # Only the exception type: a transport error could echo request data.
        log.warning("closing openwa gateway failed: %s", type(exc).__name__)
