from unittest.mock import AsyncMock

from sqlalchemy.dialects import postgresql

from whatsapp.init_groups import gather_groups
from whatsapp.types import GroupInfo


async def test_gather_groups_updates_only_gateway_owned_columns():
    gateway = AsyncMock()
    gateway.list_groups.return_value = [
        GroupInfo(
            jid="1203@g.us",
            name="Name",
            topic="Topic",
            owner_jid="972501234567@s.whatsapp.net",
        )
    ]
    session = AsyncMock()
    session.get.return_value = object()  # owner sender already exists

    await gather_groups(session, gateway)

    (stmt,), _ = session.execute.await_args
    sql = str(stmt.compile(dialect=postgresql.dialect()))
    insert_part, set_part = sql.split("DO UPDATE SET")
    assert "ON CONFLICT (group_jid)" in insert_part
    assert "display_name" in insert_part  # new rows still insert every column
    assert "summary_language" in insert_part
    assert "group_name = excluded.group_name" in set_part
    assert "group_topic = excluded.group_topic" in set_part
    assert "owner_jid = excluded.owner_jid" in set_part
    for column in (
        "display_name",
        "summary_language",
        "managed",
        "notify_on_spam",
        "community_keys",
        "last_ingest",
        "last_summary_sync",
        "created_at",
    ):
        assert column not in set_part


async def test_gather_groups_without_owner_does_not_look_up_sender():
    gateway = AsyncMock()
    gateway.list_groups.return_value = [GroupInfo(jid="1203@g.us", name="Name")]
    session = AsyncMock()

    await gather_groups(session, gateway)

    session.get.assert_not_awaited()
    session.execute.assert_awaited_once()
