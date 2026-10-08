import pytest
from datetime import datetime, timezone
from models.reaction import Reaction
from unittest.mock import AsyncMock, MagicMock
from whatsapp.types import InboundReaction


def test_reaction_normalization():
    reaction = Reaction.model_validate(
        {
            "message_id": "msg1",
            "sender_jid": "1234567890.1:1@s.whatsapp.net",
            "emoji": "👍",
        }
    )
    assert reaction.sender_jid == "1234567890@s.whatsapp.net"


@pytest.mark.asyncio
async def test_upsert_reaction():
    mock_session = AsyncMock()
    reaction = Reaction(message_id="msg1", sender_jid="sender1", emoji="👍")

    # Mock exec return for select
    mock_result = MagicMock()
    mock_result.first.return_value = reaction
    mock_session.exec.return_value = mock_result

    result = await Reaction.upsert_reaction(mock_session, reaction)

    assert result == reaction
    assert mock_session.exec.call_count == 2  # One for insert/upsert, one for select


def test_from_inbound():
    r = Reaction.from_inbound(
        InboundReaction(
            message_id="msg1",
            sender_jid="1234567890.1:1@s.whatsapp.net",
            emoji="👍",
            timestamp=datetime(2026, 10, 8, tzinfo=timezone.utc),
        )
    )
    assert (r.message_id, r.emoji) == ("msg1", "👍")
    assert r.sender_jid == "1234567890@s.whatsapp.net"
