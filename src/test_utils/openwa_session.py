from typing import Any

from sqlmodel.ext.asyncio.session import AsyncSession

from models import OpenWASession

TEST_SESSION_ID = "test-session"
OTHER_SESSION_ID = "other-session"


async def seed_session(
    session: AsyncSession, session_id: str = TEST_SESSION_ID
) -> OpenWASession:
    """Insert the OpenWA session row that groups and messages belong to."""
    row = OpenWASession(id=session_id, label=session_id, openwa_session_id=session_id)
    session.add(row)
    await session.flush()
    return row


class StubRegistry:
    """Minimal GatewayRegistry stand-in: session pk -> gateway."""

    def __init__(self, gateways: dict[str, Any]) -> None:
        self._gw = gateways

    def ids(self) -> list[str]:
        return list(self._gw)

    def get(self, pk: str) -> Any:
        return self._gw[pk]
