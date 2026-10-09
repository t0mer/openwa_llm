from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from .jid import JID
from .types import GroupInfo, SessionStatus


class GatewayError(Exception):
    """Raised when the WhatsApp gateway rejects or fails a request."""


class WhatsAppGateway(Protocol):
    async def send_text(
        self,
        jid: str,
        text: str,
        reply_to: str | None = None,
        mentions: Sequence[str] = (),
    ) -> str:
        """Send a text message; returns the gateway's id for the sent message.

        `mentions` are JIDs of users tagged in `text` (as `@<number>` tokens).
        """
        ...

    async def get_my_jid(self) -> JID: ...

    async def get_my_lid(self) -> JID | None:
        """The bot's own `@lid` privacy id, or None when it cannot be determined."""
        ...

    async def list_groups(self) -> list[GroupInfo]: ...

    async def get_status(self) -> SessionStatus: ...
