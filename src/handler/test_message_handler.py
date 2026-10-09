import itertools
from datetime import datetime, timezone
from unittest.mock import AsyncMock, Mock

import pytest

from handler import MessageHandler
from models import Group, Message
from test_utils.mock_session import AsyncSessionMock
from whatsapp import InboundMessage
from whatsapp.jid import JID
from config import Settings


def inbound(text, *, chat="user@s.whatsapp.net", sender="user@s.whatsapp.net", **kw):
    return InboundMessage(
        id=kw.pop("id", "m1"),
        chat_jid=chat,
        sender_jid=sender,
        timestamp=datetime.now(timezone.utc),
        text=text,
        sender_name="User",
        **kw,
    )


@pytest.fixture
def mock_whatsapp():
    client = AsyncMock()
    client.send_text = AsyncMock(return_value="response_id")
    client.get_my_jid = AsyncMock(return_value=JID(user="bot", server="s.whatsapp.net"))
    client.get_my_lid = AsyncMock(return_value=None)
    return client


@pytest.fixture
def mock_embedding_client():
    client = AsyncMock()
    return client


@pytest.fixture
def mock_settings():
    return Mock(spec=Settings, model_name="test-model", dm_autoreply_enabled=False)


@pytest.mark.asyncio
async def test_message_handler_dm_opt_out(
    mock_session: AsyncSessionMock,
    mock_whatsapp: AsyncMock,
    mock_embedding_client: AsyncMock,
    mock_settings: Mock,
):
    # Create handler instance
    handler = MessageHandler(
        mock_session, mock_whatsapp, mock_embedding_client, mock_settings
    )

    # Mock store_message to return our test message
    test_message = Message(
        message_id="1",
        chat_jid="user@s.whatsapp.net",
        sender_jid="user@s.whatsapp.net",  # DM: sender == chat (usually, but logic checks message.group)
        text="opt-out",
        timestamp=datetime.now(timezone.utc),
    )
    # Ensure message.group is None for DM check
    # In the code: if message and not message.group:
    # Message model has a 'group' relationship. We can just set it to None or rely on default.
    # But wait, store_message returns a Message object.

    # We need to mock store_message because __call__ calls it.
    # However, store_message is an async method on the instance.
    handler.store_message = AsyncMock(return_value=test_message)

    # Create a dummy payload
    payload = inbound("opt-out")

    await handler(payload)

    # Verify upsert was called (which calls execute)
    mock_session.execute.assert_called()

    # Verify confirmation message
    mock_whatsapp.send_text.assert_called_with(
        "user@s.whatsapp.net",
        "You have been opted out. You will no longer be tagged in summaries and answers.",
        None,
    )


@pytest.mark.asyncio
async def test_message_handler_dm_opt_in(
    mock_session: AsyncSessionMock,
    mock_whatsapp: AsyncMock,
    mock_embedding_client: AsyncMock,
    mock_settings: Mock,
):
    handler = MessageHandler(
        mock_session, mock_whatsapp, mock_embedding_client, mock_settings
    )

    test_message = Message(
        message_id="1",
        chat_jid="user@s.whatsapp.net",
        sender_jid="user@s.whatsapp.net",
        text="opt-in",
        timestamp=datetime.now(timezone.utc),
    )
    handler.store_message = AsyncMock(return_value=test_message)

    payload = inbound("opt-in")

    # Mock existing opt-out record
    from models import OptOut

    opt_out = OptOut(jid="user@s.whatsapp.net")
    mock_session._storage[("OptOut", "user@s.whatsapp.net")] = opt_out

    await handler(payload)

    # Verify delete was called
    mock_session.delete.assert_called_with(opt_out)
    mock_session.commit.assert_called()

    # Verify confirmation message
    mock_whatsapp.send_text.assert_called_with(
        "user@s.whatsapp.net",
        "You have been opted in. You will now be tagged in summaries and answers.",
        None,
    )


@pytest.mark.asyncio
async def test_message_handler_dm_status(
    mock_session: AsyncSessionMock,
    mock_whatsapp: AsyncMock,
    mock_embedding_client: AsyncMock,
    mock_settings: Mock,
):
    handler = MessageHandler(
        mock_session, mock_whatsapp, mock_embedding_client, mock_settings
    )

    test_message = Message(
        message_id="1",
        chat_jid="user@s.whatsapp.net",
        sender_jid="user@s.whatsapp.net",
        text="status",
        timestamp=datetime.now(timezone.utc),
    )
    handler.store_message = AsyncMock(return_value=test_message)

    payload = inbound("status")

    # Mock get to return None (opted in)
    mock_session.get.return_value = None

    await handler(payload)

    # Verify status message
    mock_whatsapp.send_text.assert_called_with(
        "user@s.whatsapp.net",
        "You are currently opted in.",
        None,
    )


@pytest.mark.asyncio
async def test_message_handler_ignores_own_messages(
    mock_session, mock_whatsapp, mock_embedding_client, mock_settings
):
    handler = MessageHandler(
        mock_session, mock_whatsapp, mock_embedding_client, mock_settings
    )
    handler.store_message = AsyncMock(
        return_value=Message(
            message_id="1",
            chat_jid="user@s.whatsapp.net",
            sender_jid="user@s.whatsapp.net",
            text="opt-out",
            timestamp=datetime.now(timezone.utc),
        )
    )
    await handler(inbound("opt-out", from_me=True))
    mock_whatsapp.send_text.assert_not_called()


@pytest.mark.asyncio
async def test_message_handler_routes_mention_from_mentioned_jids(
    mock_session, mock_whatsapp, mock_embedding_client, mock_settings
):
    handler = MessageHandler(
        mock_session, mock_whatsapp, mock_embedding_client, mock_settings
    )
    handler.router = AsyncMock()
    msg = Message(
        message_id="g1",
        chat_jid="1203@g.us",
        sender_jid="user@s.whatsapp.net",
        text="what is the plan?",  # no literal @bot in the text
        timestamp=datetime.now(timezone.utc),
    )
    msg.group = Group(group_jid="1203@g.us", managed=True)
    handler.store_message = AsyncMock(return_value=msg)
    await handler(
        inbound(
            "what is the plan?",
            chat="1203@g.us",
            id="g1",
            mentioned_jids=("bot@s.whatsapp.net",),
        )
    )
    handler.router.assert_awaited_once_with(msg)


@pytest.mark.asyncio
async def test_message_handler_stores_reaction_event(
    mock_session, mock_whatsapp, mock_embedding_client, mock_settings
):
    from whatsapp import InboundReaction

    handler = MessageHandler(
        mock_session, mock_whatsapp, mock_embedding_client, mock_settings
    )
    handler.store_reaction = AsyncMock()
    handler.store_message = AsyncMock()
    reaction = InboundReaction(
        message_id="m1",
        sender_jid="user@s.whatsapp.net",
        emoji="👍",
        timestamp=datetime.now(timezone.utc),
    )
    await handler(reaction)
    handler.store_reaction.assert_awaited_once_with(reaction)
    handler.store_message.assert_not_awaited()
    mock_whatsapp.send_text.assert_not_called()


@pytest.mark.asyncio
async def test_store_reaction_ignores_empty_emoji(
    mock_session, mock_whatsapp, mock_embedding_client, mock_settings
):
    from whatsapp import InboundReaction

    handler = MessageHandler(
        mock_session, mock_whatsapp, mock_embedding_client, mock_settings
    )
    removal = InboundReaction(
        message_id="m1",
        sender_jid="user@s.whatsapp.net",
        emoji="",
        timestamp=datetime.now(timezone.utc),
    )
    assert await handler.store_reaction(removal) is None
    mock_session.execute.assert_not_called()


BOT_PHONE = JID(user="972559661780", server="s.whatsapp.net")
BOT_LID = JID(user="209878492672151", server="lid")
LID_SENDER = "107945496977449@lid"


def _whatsapp_for(lid):
    client = AsyncMock()
    client.send_text = AsyncMock(return_value="response_id")
    client.get_my_jid = AsyncMock(return_value=BOT_PHONE)
    client.get_my_lid = AsyncMock(return_value=lid)
    return client


_ids = itertools.count()


async def _run_group_message(
    mock_session,
    mock_embedding_client,
    mock_settings,
    whatsapp,
    text,
    *,
    sender=LID_SENDER,
    mentioned_jids=(),
    from_me=False,
):
    handler = MessageHandler(
        mock_session, whatsapp, mock_embedding_client, mock_settings
    )
    handler.router = AsyncMock()
    message_id = f"lid-{next(_ids)}"  # the handler dedupes by id across tests
    msg = Message(
        message_id=message_id,
        chat_jid="1203@g.us",
        sender_jid=sender,
        text=text,
        timestamp=datetime.now(timezone.utc),
    )
    msg.group = Group(group_jid="1203@g.us", managed=True)
    handler.store_message = AsyncMock(return_value=msg)
    await handler(
        inbound(
            text,
            chat="1203@g.us",
            sender=sender,
            id=message_id,
            mentioned_jids=mentioned_jids,
            from_me=from_me,
        )
    )
    return handler, msg


@pytest.mark.asyncio
@pytest.mark.parametrize("mentioned_jids", [("209878492672151@lid",), ()])
async def test_lid_tag_reaches_router_when_bot_lid_known(
    mock_session, mock_embedding_client, mock_settings, mentioned_jids
):
    handler, msg = await _run_group_message(
        mock_session,
        mock_embedding_client,
        mock_settings,
        _whatsapp_for(BOT_LID),
        "@209878492672151 מה המצב?",
        mentioned_jids=mentioned_jids,
    )
    handler.router.assert_awaited_once_with(msg)


@pytest.mark.asyncio
@pytest.mark.parametrize("mentioned_jids", [("209878492672151@lid",), ()])
async def test_lid_tag_ignored_when_bot_lid_unknown(
    mock_session, mock_embedding_client, mock_settings, mentioned_jids
):
    # Degradation: without the bot's lid behaviour is the old phone-only one.
    handler, _ = await _run_group_message(
        mock_session,
        mock_embedding_client,
        mock_settings,
        _whatsapp_for(None),
        "@209878492672151 מה המצב?",
        mentioned_jids=mentioned_jids,
    )
    handler.router.assert_not_awaited()


@pytest.mark.asyncio
async def test_phone_tag_still_works_with_lid_known(
    mock_session, mock_embedding_client, mock_settings
):
    handler, msg = await _run_group_message(
        mock_session,
        mock_embedding_client,
        mock_settings,
        _whatsapp_for(BOT_LID),
        "@972559661780 hello",
    )
    handler.router.assert_awaited_once_with(msg)


@pytest.mark.asyncio
async def test_message_from_bot_lid_is_ignored(
    mock_session, mock_embedding_client, mock_settings
):
    handler, _ = await _run_group_message(
        mock_session,
        mock_embedding_client,
        mock_settings,
        _whatsapp_for(BOT_LID),
        "@209878492672151 talking to myself",
        sender="209878492672151@lid",
    )
    handler.router.assert_not_awaited()


@pytest.mark.asyncio
async def test_from_me_message_is_ignored_even_with_tag(
    mock_session, mock_embedding_client, mock_settings
):
    handler, _ = await _run_group_message(
        mock_session,
        mock_embedding_client,
        mock_settings,
        _whatsapp_for(BOT_LID),
        "@209878492672151 hi",
        from_me=True,
    )
    handler.router.assert_not_awaited()
