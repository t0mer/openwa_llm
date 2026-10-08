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


async def test_nul_and_hostile_input_is_422_not_500(admin_client, db_sessionmaker):
    import base64
    import json

    await seed(db_sessionmaker)
    for params in (
        {"q": "a\u0000b"},
        {"group_jid": "1\u0000@g.us"},
        {"sender_jid": "a\u0000@s.whatsapp.net"},
        {"from": "0001-01-01T00:00:00+05:00"},
        {"to": "9999-12-31T23:59:59-12:00"},
    ):
        assert (await admin_client.get(BASE, params=params)).status_code == 422, params
    for ts, mid in (
        ("0001-01-01T00:00:00+05:00", "m1"),
        ("9999-12-31T23:59:59.999999-12:00", "m1"),
        ("2026-01-01T00:00:00+00:00", "a\u0000b"),
    ):
        cur = base64.urlsafe_b64encode(json.dumps([ts, mid]).encode()).decode()
        assert (await admin_client.get(BASE, params={"before": cur})).status_code == 422


async def test_nul_in_other_admin_routes_is_422(admin_client, db_sessionmaker):
    await seed(db_sessionmaker)
    base = "/api/v1/admin"
    assert (
        await admin_client.get(f"{base}/groups", params={"search": "a\u0000"})
    ).status_code == 422
    assert (
        await admin_client.get(f"{base}/contacts", params={"search": "a\u0000"})
    ).status_code == 422
    r = await admin_client.patch(
        f"{base}/groups/1@g.us", json={"display_name": "a\u0000b"}
    )
    assert r.status_code == 422
    r = await admin_client.patch(
        f"{base}/groups/1@g.us", json={"community_keys": ["x\u0000"]}
    )
    assert r.status_code == 422
    r = await admin_client.patch(
        f"{base}/contacts/a@s.whatsapp.net", json={"push_name": "a\u0000b"}
    )
    assert r.status_code == 422


async def test_to_filter_reversed_range_naive_from_and_symbol_only_q(
    admin_client, db_sessionmaker
):
    await seed(db_sessionmaker)
    to = (await admin_client.get(BASE, params={"to": "2026-03-01T23:59:59Z"})).json()
    assert {m["message_id"] for m in to["items"]} == {
        "m0",
        "m1",
        "m2",
        "m3",
        "m4",
        "other",
    }
    rev = await admin_client.get(
        BASE, params={"from": "2026-03-05T00:00:00Z", "to": "2026-03-01T00:00:00Z"}
    )
    assert rev.status_code == 200 and rev.json()["items"] == []
    naive = await admin_client.get(BASE, params={"from": "2026-03-02T00:00:00"})
    assert naive.status_code == 200
    for term in ("the", "!!!", "&|!"):
        r = await admin_client.get(BASE, params={"q": term})
        assert r.status_code == 200 and r.json()["items"] == []
