import logging
from typing import Any, Callable

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
        """Sync gateways with the DB; returns session pk -> error message or None."""
        conn = await load_connection(db)
        result: dict[str, str | None] = {}
        wanted: dict[str, tuple[str, str, str]] = {}
        self._errors = {}
        if conn is None:
            self.webhook_secret = None
        else:
            try:
                self.webhook_secret = self._box.decrypt(conn.webhook_secret_enc)
                api_key = self._box.decrypt(conn.api_key_enc)
            except ValueError as exc:
                log.error("cannot decrypt openwa connection secrets: %s", exc)
                self.webhook_secret = None
                for s in await list_sessions(db, enabled_only=True):
                    self._errors[s.id] = str(exc)
                    result[s.id] = str(exc)
                api_key = None
            if api_key is not None:
                for s in await list_sessions(db, enabled_only=True):
                    wanted[s.id] = (conn.base_url, api_key, s.openwa_session_id)
                    result[s.id] = None
        stale = [
            pk
            for pk in self._gateways
            if pk not in wanted or self._cfg[pk] != wanted[pk]
        ]
        for pk in stale:
            await self._gateways.pop(pk).aclose()
            self._cfg.pop(pk, None)
        for pk, cfg in wanted.items():
            if pk not in self._gateways:
                self._gateways[pk] = self._factory(*cfg)
                self._cfg[pk] = cfg
        return result

    def get(self, session_pk: str) -> OpenWAGateway:
        return self._gateways[session_pk]

    def ids(self) -> list[str]:
        return list(self._gateways)

    def errors(self) -> dict[str, str]:
        return dict(self._errors)

    async def aclose(self) -> None:
        for gw in self._gateways.values():
            await gw.aclose()
        self._gateways.clear()
        self._cfg.clear()


# TEMP(T7): callers become per-session; until then they use the first active one.
def first_gateway(app: Any) -> OpenWAGateway:
    """Gateway of the first active session; LookupError when there is none."""
    ids = app.state.registry.ids()
    if not ids:
        raise LookupError("no active OpenWA session configured")
    return app.state.registry.get(ids[0])
