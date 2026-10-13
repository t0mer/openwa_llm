from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from .jid import JID
from .types import GroupInfo, SessionStatus


class GatewayError(Exception):
    """Raised when the WhatsApp gateway rejects or fails a request.

    `status_code` is the gateway's HTTP status when it answered with an error,
    None when it could not be reached or answered unusably.
    """

    def __init__(self, *args: object, status_code: int | None = None) -> None:
        super().__init__(*args)
        self.status_code = status_code


def describe_gateway_failure(exc: BaseException) -> str:
    """A safe, fixed description of a failed gateway call.

    Never includes the exception's message: it can carry the gateway's
    response body or request data.
    """
    status = exc.status_code if isinstance(exc, GatewayError) else None
    if status:
        return f"OpenWA returned HTTP {status}"
    return f"cannot reach OpenWA ({type(exc).__name__})"


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
