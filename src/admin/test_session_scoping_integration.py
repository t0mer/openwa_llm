from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

from models import Group, KBTopic, Message, Reaction, Sender
from test_utils.openwa_session import OTHER_SESSION_ID, TEST_SESSION_ID

pytestmark = pytest.mark.usefixtures("other_session_row")

A, B = TEST_SESSION_ID, OTHER_SESSION_ID
USER = "972501@s.whatsapp.net"
T = datetime(2026, 6, 10, 12, 0, tzinfo=timezone.utc)
RANGE = {"from": (T - timedelta(days=1)).isoformat(), "to": T.isoformat()}


def msg(mid: str, owner: str, chat: str) -> Message:
    return Message(
        session_id=owner,
        message_id=mid,
        chat_jid=chat,
        group_jid=chat if chat.endswith("@g.us") else None,
        sender_jid=USER,
        text="hi",
        timestamp=T - timedelta(hours=1),
    )


@pytest_asyncio.fixture(loop_scope="function")
async def seeded(db_sessionmaker, active_sessions, other_session_row):
    active_sessions(A, B)
    async with db_sessionmaker() as session:
        session.add(Sender(jid=USER))
        session.add(Group(session_id=A, group_jid="a@g.us", managed=True))
        session.add(Group(session_id=B, group_jid="b@g.us"))
        session.add(Group(session_id=B, group_jid="b2@g.us"))
        await session.flush()
        for row in (
            msg("a1", A, "a@g.us"),
            msg("a2", A, "a@g.us"),
            msg("dm-a", A, USER),
            msg("b1", B, "b@g.us"),
        ):
            session.add(row)
        await session.flush()
        for mid in ("a1", "b1"):
            session.add(
                Reaction(message_id=mid, sender_jid=USER, emoji="x", timestamp=T)
            )
        for tid, jid in (("ta", "a@g.us"), ("tb", "b@g.us")):
            session.add(
                KBTopic(
                    id=tid,
                    group_jid=jid,
                    start_time=T - timedelta(hours=1),
                    speakers="a",
                    subject="s",
                    summary="x",
                    embedding=None,
                )
            )
        await session.commit()


@pytest.mark.usefixtures("seeded")
async def test_group_list_is_scoped_to_the_session(admin_client):
    a = await admin_client.get("/api/v1/admin/groups", params={"session_id": A})
    b = await admin_client.get("/api/v1/admin/groups", params={"session_id": B})
    assert [g["group_jid"] for g in a.json()["items"]] == ["a@g.us"]
    assert a.json()["total"] == 1
    assert {g["group_jid"] for g in b.json()["items"]} == {"b@g.us", "b2@g.us"}


@pytest.mark.usefixtures("seeded")
async def test_message_list_is_scoped_to_the_session(admin_client):
    a = await admin_client.get("/api/v1/admin/messages", params={"session_id": A})
    b = await admin_client.get("/api/v1/admin/messages", params={"session_id": B})
    assert {m["message_id"] for m in a.json()["items"]} == {"a1", "a2", "dm-a"}
    assert [m["message_id"] for m in b.json()["items"]] == ["b1"]


@pytest.mark.usefixtures("seeded")
async def test_stats_are_scoped_to_the_session(admin_client):
    body = (
        await admin_client.get("/api/v1/admin/stats", params={**RANGE, "session_id": A})
    ).json()
    assert body["messages"] == 3
    assert body["groups"] == {"total": 1, "managed": 1}
    assert body["reactions"] == 1
    assert body["kb_topics"] == 1
    assert [g["group_jid"] for g in body["top_groups"]] == ["a@g.us"]

    other = (
        await admin_client.get("/api/v1/admin/stats", params={**RANGE, "session_id": B})
    ).json()
    assert other["messages"] == 1 and other["groups"]["total"] == 2


@pytest.mark.usefixtures("seeded")
async def test_lists_need_a_session_when_several_are_active(admin_client):
    for path in ("groups", "messages", "stats"):
        resp = await admin_client.get(f"/api/v1/admin/{path}")
        assert resp.status_code == 400, path


@pytest.mark.usefixtures("seeded")
async def test_unknown_session_is_404(admin_client):
    for path in ("groups", "messages", "stats"):
        resp = await admin_client.get(
            f"/api/v1/admin/{path}", params={"session_id": "nope"}
        )
        assert resp.status_code == 404, path


@pytest.mark.usefixtures("seeded")
async def test_stats_without_any_active_session_are_empty(
    admin_client, active_sessions
):
    active_sessions()
    resp = await admin_client.get("/api/v1/admin/stats", params=RANGE)
    assert resp.status_code == 200
    body = resp.json()
    assert body["messages"] == body["chats"] == body["active_senders"] == 0
    assert body["reactions"] == body["kb_topics"] == 0
    assert body["groups"] == {"total": 0, "managed": 0}
    assert body["top_groups"] == [] and body["top_senders"] == []
    assert body["bot_excluded"] is False
    assert body["series"] and all(p["count"] == 0 for p in body["series"])
    assert body["by_hour"] == [0] * 24 and body["by_weekday"] == [0] * 7


@pytest.mark.usefixtures("seeded")
async def test_single_group_endpoints_work_for_any_session_group(admin_client):
    resp = await admin_client.get("/api/v1/admin/groups/b@g.us")
    assert resp.status_code == 200 and resp.json()["group_jid"] == "b@g.us"
    resp = await admin_client.get("/api/v1/admin/groups/b@g.us/schedules")
    assert resp.status_code == 200
