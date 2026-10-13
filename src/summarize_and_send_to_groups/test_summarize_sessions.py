# pyright: reportArgumentType=false
from unittest.mock import AsyncMock

import pytest

import summarize_and_send_to_groups as mod
from load_new_kbtopics import topicsLoader
from models import Group
from summarize_and_send_to_groups import (
    GroupSummaryResult,
    summarize_and_send_to_groups,
)
from test_utils.openwa_session import OTHER_SESSION_ID, TEST_SESSION_ID

pytestmark = pytest.mark.usefixtures("other_session_row")


async def seed(db_sessionmaker) -> None:
    async with db_sessionmaker() as session:
        for jid, owner, managed in (
            ("a1@g.us", TEST_SESSION_ID, True),
            ("a2@g.us", TEST_SESSION_ID, False),
            ("b1@g.us", OTHER_SESSION_ID, True),
        ):
            session.add(
                Group(
                    group_jid=jid,
                    session_id=owner,
                    managed=managed,
                    community_keys=["c"],
                )
            )
        await session.commit()


async def test_summaries_only_cover_the_session_managed_groups(
    db_sessionmaker, monkeypatch
):
    await seed(db_sessionmaker)
    seen: list[str] = []

    async def fake(settings, session, whatsapp, group):
        seen.append(group.group_jid)
        return GroupSummaryResult(status="sent")

    monkeypatch.setattr(mod, "summarize_and_send_to_group", fake)
    async with db_sessionmaker() as session:
        results = await summarize_and_send_to_groups(
            object(), session, object(), TEST_SESSION_ID
        )

    assert seen == ["a1@g.us"]
    assert [r.group_jid for r in results] == ["a1@g.us"]


async def test_kb_load_only_covers_the_session_managed_groups(db_sessionmaker):
    await seed(db_sessionmaker)
    loader = topicsLoader()
    loader.load_topics = AsyncMock()

    async with db_sessionmaker() as session:
        await loader.load_topics_for_all_groups(
            session, object(), object(), OTHER_SESSION_ID
        )

    assert [c.args[1].group_jid for c in loader.load_topics.await_args_list] == [
        "b1@g.us"
    ]


async def test_community_groups_stay_within_the_session(db_sessionmaker):
    await seed(db_sessionmaker)
    async with db_sessionmaker() as session:
        group = await session.get(Group, "a1@g.us")
        assert group is not None
        related = await group.get_related_community_groups(session)

    assert [g.group_jid for g in related] == ["a2@g.us"]
