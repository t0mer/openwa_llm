from datetime import datetime, timezone
from unittest.mock import AsyncMock

from models import Group, Sender
from whatsapp.init_groups import gather_groups
from whatsapp.types import GroupInfo


async def test_sync_keeps_admin_owned_columns(db_sessionmaker):
    stamp = datetime(2026, 1, 2, 3, 4, 5)
    async with db_sessionmaker() as session:
        session.add(Sender(jid="972501234567@s.whatsapp.net"))
        session.add(
            Group(
                group_jid="1203@g.us",
                group_name="Old name",
                group_topic="Old topic",
                display_name="My alias",
                summary_language="ru",
                managed=True,
                notify_on_spam=True,
                community_keys=["a", "b"],
                last_ingest=stamp,
                last_summary_sync=stamp,
                created_at=datetime(2025, 5, 5, tzinfo=timezone.utc),
            )
        )
        await session.commit()

    gateway = AsyncMock()
    gateway.list_groups.return_value = [
        GroupInfo(
            jid="1203@g.us",
            name="New name",
            topic="New topic",
            owner_jid="972501234567@s.whatsapp.net",
        ),
        GroupInfo(jid="999@g.us", name="Brand new"),
    ]
    async with db_sessionmaker() as session:
        await gather_groups(session, gateway)
        await session.commit()

    async with db_sessionmaker() as session:
        group = await session.get(Group, "1203@g.us")
        assert group is not None
        assert (group.group_name, group.group_topic) == ("New name", "New topic")
        assert group.owner_jid == "972501234567@s.whatsapp.net"
        assert group.display_name == "My alias"
        assert group.summary_language == "ru"
        assert group.managed is True and group.notify_on_spam is True
        assert group.community_keys == ["a", "b"]
        assert group.last_summary_sync == stamp
        new = await session.get(Group, "999@g.us")
        assert new is not None
        assert (new.group_name, new.managed, new.display_name) == (
            "Brand new",
            False,
            None,
        )
