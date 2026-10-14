from datetime import datetime, timezone
from unittest.mock import AsyncMock, Mock

from handler.base_handler import BaseHandler
from models import Group, Message
from whatsapp.types import InboundMessage


async def test_inbound_message_and_new_group_are_stored_under_the_handler_session(
    db_sessionmaker, session_row
):
    async with db_sessionmaker() as session:
        handler = BaseHandler(session, AsyncMock(), Mock(), session_row.id)
        await handler.store_message(
            InboundMessage(
                id="m1",
                chat_jid="1@g.us",
                sender_jid="972501@s.whatsapp.net",
                timestamp=datetime(2026, 10, 13, tzinfo=timezone.utc),
                text="hi",
            )
        )
        await session.commit()

    async with db_sessionmaker() as session:
        group = await session.get(Group, "1@g.us")
        message = await session.get(Message, "m1")
        assert group is not None and group.session_id == session_row.id
        assert message is not None and message.session_id == session_row.id
