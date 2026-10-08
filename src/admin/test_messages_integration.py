from datetime import datetime, timezone

from models import Group, Message, Reaction, Sender

BASE = "/api/v1/admin/messages"
SAME = datetime(2026, 3, 1, 10, 0, tzinfo=timezone.utc)


async def seed(db_sessionmaker, n=7):
    async with db_sessionmaker() as session:
        session.add(Sender(jid="a@s.whatsapp.net", push_name="Ann"))
        session.add(Sender(jid="b@s.whatsapp.net", push_name="Bob"))
        session.add(Group(group_jid="1@g.us"))
        session.add(Group(group_jid="2@g.us"))
        await session.flush()
        for i in range(n):  # several messages share the exact same timestamp
            session.add(
                Message(
                    message_id=f"m{i}",
                    chat_jid="1@g.us",
                    group_jid="1@g.us",
                    sender_jid="a@s.whatsapp.net" if i % 2 == 0 else "b@s.whatsapp.net",
                    text=f"deploy number {i}" if i % 2 == 0 else "lunch at noon",
                    timestamp=SAME
                    if i < 5
                    else datetime(2026, 3, 2, tzinfo=timezone.utc),
                )
            )
        session.add(
            Message(
                message_id="other",
                chat_jid="2@g.us",
                group_jid="2@g.us",
                sender_jid="a@s.whatsapp.net",
                text="other group",
                timestamp=SAME,
            )
        )
        await session.flush()
        session.add(
            Reaction(
                message_id="m0",
                sender_jid="b@s.whatsapp.net",
                emoji="👍",
                timestamp=SAME,
            )
        )
        await session.commit()


async def test_keyset_paging_never_skips_or_repeats_with_equal_timestamps(
    admin_client, db_sessionmaker
):
    await seed(db_sessionmaker)
    seen, cursor = [], None
    for _ in range(10):
        params = {"limit": 3, "group_jid": "1@g.us"}
        if cursor:
            params["before"] = cursor
        body = (await admin_client.get(BASE, params=params)).json()
        seen += [m["message_id"] for m in body["items"]]
        cursor = body["next_cursor"]
        if not cursor:
            break
    assert sorted(seen) == [f"m{i}" for i in range(7)]
    assert len(seen) == len(set(seen)) == 7
    assert seen[:2] == [
        "m6",
        "m5",
    ]  # newest first (2026-03-02), then the equal-timestamp block


async def test_filters_search_and_reaction_counts(admin_client, db_sessionmaker):
    await seed(db_sessionmaker)
    by_sender = (
        await admin_client.get(BASE, params={"sender_jid": "b@s.whatsapp.net"})
    ).json()
    assert {m["sender_jid"] for m in by_sender["items"]} == {"b@s.whatsapp.net"}
    found = (await admin_client.get(BASE, params={"q": "deploy"})).json()
    assert {m["message_id"] for m in found["items"]} == {"m0", "m2", "m4", "m6"}
    assert (await admin_client.get(BASE, params={"q": "   "})).json()[
        "items"
    ]  # blank q = no filter
    for odd in ("'; DROP TABLE message;--", "a & b | !c", "(((", "%_\\"):
        assert (await admin_client.get(BASE, params={"q": odd})).status_code == 200
    dated = (
        await admin_client.get(BASE, params={"from": "2026-03-02T00:00:00Z"})
    ).json()
    assert {m["message_id"] for m in dated["items"]} == {"m5", "m6"}
    first = next(
        m
        for m in (
            await admin_client.get(BASE, params={"group_jid": "1@g.us", "limit": 100})
        ).json()["items"]
        if m["message_id"] == "m0"
    )
    assert (
        first["reaction_count"] == 1
        and first["sender_name"] == "Ann"
        and first["has_media"] is False
    )
