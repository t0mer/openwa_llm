from unittest.mock import AsyncMock

import pytest

from models import Group
from test_utils.openwa_session import OTHER_SESSION_ID, TEST_SESSION_ID
from whatsapp.init_groups import gather_groups
from whatsapp.types import GroupInfo

pytestmark = pytest.mark.usefixtures("other_session_row")


def gateway(*groups: GroupInfo) -> AsyncMock:
    gw = AsyncMock()
    gw.list_groups.return_value = list(groups)
    return gw


async def sync(db_sessionmaker, session_id: str, gw: AsyncMock) -> None:
    async with db_sessionmaker() as session:
        await gather_groups(session, gw, session_id)
        await session.commit()


async def test_groups_are_owned_by_the_first_session_that_syncs_them(
    db_sessionmaker,
):
    await sync(
        db_sessionmaker,
        TEST_SESSION_ID,
        gateway(GroupInfo(jid="shared@g.us", name="A name")),
    )
    await sync(
        db_sessionmaker,
        OTHER_SESSION_ID,
        gateway(
            GroupInfo(jid="shared@g.us", name="B name"),
            GroupInfo(jid="b-only@g.us", name="B only"),
        ),
    )

    async with db_sessionmaker() as session:
        shared = await session.get(Group, "shared@g.us")
        b_only = await session.get(Group, "b-only@g.us")
        assert shared is not None
        assert (shared.session_id, shared.group_name) == (TEST_SESSION_ID, "A name")
        assert b_only is not None and b_only.session_id == OTHER_SESSION_ID


async def test_owner_resync_updates_names(db_sessionmaker):
    await sync(
        db_sessionmaker,
        TEST_SESSION_ID,
        gateway(GroupInfo(jid="shared@g.us", name="Old")),
    )
    await sync(
        db_sessionmaker,
        TEST_SESSION_ID,
        gateway(GroupInfo(jid="shared@g.us", name="New", topic="T")),
    )

    async with db_sessionmaker() as session:
        group = await session.get(Group, "shared@g.us")
        assert group is not None
        assert (group.group_name, group.group_topic) == ("New", "T")
        assert group.session_id == TEST_SESSION_ID
