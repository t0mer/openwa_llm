from datetime import datetime, timezone

import pytest

from models import Message
from whatsapp.types import InboundMessage


@pytest.mark.asyncio
async def test_message_mentions(mock_session):
    message = Message(
        message_id="test_mention",
        text="Hey @1234567890 check this out",
        chat_jid="group@g.us",
        sender_jid="sender@s.whatsapp.net",
    )

    assert message.has_mentioned("1234567890")
    assert message.has_mentioned("1234567890@s.whatsapp.net")
    assert not message.has_mentioned("9876543210@s.whatsapp.net")


def test_from_inbound_group_message():
    m = Message.from_inbound(
        InboundMessage(
            id="m1",
            chat_jid="123456789-123456@g.us",
            sender_jid="1234567890@s.whatsapp.net",
            timestamp=datetime(2026, 10, 8, tzinfo=timezone.utc),
            text="hi",
            reply_to_id="m0",
        )
    )
    assert m.message_id == "m1"
    assert m.group_jid == "123456789-123456@g.us"
    assert m.sender_jid == "1234567890@s.whatsapp.net"
    assert m.reply_to_id == "m0"
    assert m.text == "hi"


def test_from_inbound_normalizes_device_suffix_in_sender():
    m = Message.from_inbound(
        InboundMessage(
            id="m1",
            chat_jid="1234567890@s.whatsapp.net",
            sender_jid="1234567890:33@s.whatsapp.net",
            timestamp=datetime(2026, 10, 8, tzinfo=timezone.utc),
            text="hi",
        )
    )
    assert m.sender_jid == "1234567890@s.whatsapp.net"
    assert m.group_jid is None


def test_from_inbound_strips_device_suffix_from_dm_chat():
    m = Message.from_inbound(
        InboundMessage(
            id="m1",
            chat_jid="972501234567:7@s.whatsapp.net",
            sender_jid="972501234567@s.whatsapp.net",
            timestamp=datetime(2026, 10, 8, tzinfo=timezone.utc),
            text="hi",
        )
    )
    assert m.chat_jid == "972501234567@s.whatsapp.net"
