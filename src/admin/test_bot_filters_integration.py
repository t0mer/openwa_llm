"""Summary and KB-ingest queries must skip the bot's phone AND lid messages.

Lives here to reuse the real-Postgres `db_sessionmaker` fixture (conftest.py).
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from models import Group, Message, Sender
from load_new_kbtopics import get_conversation_topics, messages_to_ingest_stmt
from summarize_and_send_to_groups import messages_to_summarize_stmt

PHONE = "972559661780@s.whatsapp.net"
LID = "209878492672151@lid"
USER = "107945496977449@lid"
WHEN = datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc)
BOT = frozenset({PHONE, LID})


async def seed(db_sessionmaker):
    async with db_sessionmaker() as session:
        for jid in (PHONE, LID, USER):
            session.add(Sender(jid=jid))
        group = Group(
            group_jid="1@g.us",
            last_summary_sync=datetime(2026, 1, 1),
            last_ingest=datetime(2026, 1, 1),
        )
        session.add(group)
        await session.flush()
        for mid, sender in (("by-phone", PHONE), ("by-lid", LID), ("by-user", USER)):
            session.add(
                Message(
                    message_id=mid,
                    chat_jid="1@g.us",
                    group_jid="1@g.us",
                    sender_jid=sender,
                    text="hi",
                    timestamp=WHEN,
                )
            )
        await session.commit()
        return group


async def test_summary_query_excludes_both_bot_ids(db_sessionmaker):
    group = await seed(db_sessionmaker)
    async with db_sessionmaker() as session:
        rows = (await session.exec(messages_to_summarize_stmt(group, BOT))).all()
    assert [m.message_id for m in rows] == ["by-user"]


async def test_summary_query_phone_only_keeps_lid_messages(db_sessionmaker):
    group = await seed(db_sessionmaker)
    async with db_sessionmaker() as session:
        rows = (
            await session.exec(messages_to_summarize_stmt(group, frozenset({PHONE})))
        ).all()
    assert sorted(m.message_id for m in rows) == ["by-lid", "by-user"]


async def test_kb_ingest_query_excludes_both_bot_ids(db_sessionmaker):
    group = await seed(db_sessionmaker)
    async with db_sessionmaker() as session:
        rows = (await session.exec(messages_to_ingest_stmt(group, BOT))).all()
    assert [m.message_id for m in rows] == ["by-user"]


async def test_conversation_topics_maps_both_bot_ids_to_bot():
    msg = Message(
        message_id="m",
        chat_jid="1@g.us",
        sender_jid=USER,
        text="@209878492672151 and @972559661780 please",
        timestamp=WHEN,
    )
    agent = AsyncMock(return_value=AsyncMock(output=[]))
    with patch("load_new_kbtopics.conversation_splitter_agent", agent):
        await get_conversation_topics(
            AsyncMock(), [msg], ("972559661780", "209878492672151")
        )
    content = agent.await_args.args[1]
    assert "@bot and @bot please" in content
