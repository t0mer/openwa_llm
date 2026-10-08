from __future__ import annotations

from typing import Protocol

from .jid import JID
from .types import GroupInfo, SessionStatus


class GatewayError(Exception):
    """Raised when the WhatsApp gateway rejects or fails a request."""


class WhatsAppGateway(Protocol):
    async def send_text(self, jid: str, text: str, reply_to: str | None = None) -> str:
        """Send a text message; returns the gateway's id for the sent message."""
        ...

    async def get_my_jid(self) -> JID: ...

    async def list_groups(self) -> list[GroupInfo]: ...

    async def get_status(self) -> SessionStatus: ...
