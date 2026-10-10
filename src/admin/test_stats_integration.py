from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock
from zoneinfo import ZoneInfo

import pytest

from api.deps import get_whatsapp
from models import Group, KBTopic, Message, Reaction, Sender
from whatsapp.jid import parse_jid

BASE = "/api/v1/admin/stats"
TZ = ZoneInfo("Asia/Jerusalem")
UTC = timezone.utc
BOT = "999@s.whatsapp.net"
BOT_LID = "888@lid"
A = "111@s.whatsapp.net"
B = "222@s.whatsapp.net"
C = "333@s.whatsapp.net"
G1 = "100@g.us"
G2 = "200@g.us"
T = datetime(2026, 6, 10, 12, 0, tzinfo=UTC)  # a Wednesday
HEBREW_LONG = ("קבוצת " + "שם ארוך מאוד " * 30)[:255]  # longest the column allows


def _whatsapp(fail: bool = False):
    whatsapp = MagicMock()
    if fail:
        whatsapp.get_my_jid = AsyncMock(side_effect=RuntimeError("session down"))
    else:
        whatsapp.get_my_jid = AsyncMock(return_value=parse_jid(BOT))
    whatsapp.get_my_lid = AsyncMock(return_value=parse_jid(BOT_LID))
    return whatsapp


@pytest.fixture
def bot(admin_app):
    admin_app.dependency_overrides[get_whatsapp] = lambda: _whatsapp()


@pytest.fixture
def no_bot(admin_app):
    admin_app.dependency_overrides[get_whatsapp] = lambda: _whatsapp(fail=True)


def _msg(mid, ts, sender, chat=G1, text: str | None = "hi", media=None):
    return Message(
        message_id=mid,
        chat_jid=chat,
        group_jid=chat if chat.endswith("@g.us") else None,
        sender_jid=sender,
        text=text,
        media_url=media,
        timestamp=ts,
    )


async def _add(db_sessionmaker, *rows, senders=(A, B, C, BOT, BOT_LID), groups=()):
    async with db_sessionmaker() as session:
        for jid in senders:
            session.add(Sender(jid=jid, push_name=None if jid == C else f"n-{jid}"))
        for group in groups:
            session.add(group)
        await session.flush()
        for row in rows:
            session.add(row)
            await session.flush()
        await session.commit()


async def seed(db_sessionmaker):
    await _add(
        db_sessionmaker,
        _msg("a1", T, A),
        _msg("a2", T + timedelta(minutes=1), A),
        _msg("a3", T + timedelta(minutes=2), A, text=None, media="http://m/1"),
        _msg("b1", T, B, chat=G2, text="caption", media="http://m/2"),
        _msg("b2", T, B, chat=G2, text=None),  # neither text nor media: other
        _msg("dm", T, C, chat=A),  # direct chat, no group
        _msg("bot1", T, BOT),
        _msg("bot2", T, BOT_LID, chat=G2),
        Reaction(message_id="a1", sender_jid=B, emoji="👍", timestamp=T),
        Reaction(message_id="a2", sender_jid=BOT, emoji="👍", timestamp=T),
        Reaction(
            message_id="a3", sender_jid=C, emoji="👍", timestamp=T - timedelta(days=9)
        ),
        groups=(
            Group(group_jid=G1, group_name="One", managed=True),
            Group(group_jid=G2, group_name=HEBREW_LONG),
            Group(group_jid="300@g.us", group_name="Idle"),
        ),
    )


RANGE = {"from": "2026-06-10T00:00:00Z", "to": "2026-06-10T23:59:59Z"}


async def test_totals_split_and_distinct_counts_exclude_the_bot(
    admin_client, db_sessionmaker, bot
):
    await seed(db_sessionmaker)
    resp = await admin_client.get(BASE, params=RANGE)
    assert resp.status_code == 200
    body = resp.json()
    assert body["bot_excluded"] is True
    assert body["timezone"] == "Asia/Jerusalem"
    assert body["messages"] == 6
    assert body["chats"] == 3  # two groups plus the direct chat
    assert body["active_senders"] == 3
    assert body["split"] == {"text": 3, "media": 2, "other": 1}
    assert body["reactions"] == 1  # bot reaction and out-of-range one excluded
    assert body["groups"] == {"total": 3, "managed": 1}
    assert [g["group_jid"] for g in body["top_groups"]] == [G1, G2]
    assert body["top_groups"][1]["name"] == HEBREW_LONG
    senders = {s["sender_jid"]: s for s in body["top_senders"]}
    assert set(senders) == {A, B, C}
    assert senders[C]["name"] is None
    assert senders[A] == {"sender_jid": A, "name": f"n-{A}", "count": 3}
    assert sum(body["by_hour"]) == sum(body["by_weekday"]) == 6
    assert sum(p["count"] for p in body["series"]) == 6


async def test_identity_failure_includes_the_bot_without_error(
    admin_client, db_sessionmaker, no_bot
):
    await seed(db_sessionmaker)
    resp = await admin_client.get(BASE, params=RANGE)
    assert resp.status_code == 200
    body = resp.json()
    assert body["bot_excluded"] is False
    assert body["messages"] == 8
    assert body["active_senders"] == 5
    assert body["reactions"] == 2


async def test_groups_are_not_range_scoped(admin_client, db_sessionmaker, bot):
    await seed(db_sessionmaker)
    body = (
        await admin_client.get(
            BASE, params={"from": "2030-01-01T00:00:00Z", "to": "2030-01-02T00:00:00Z"}
        )
    ).json()
    assert body["messages"] == 0
    assert body["groups"] == {"total": 3, "managed": 1}
    assert body["top_groups"] == [] and body["top_senders"] == []


async def test_bounds_are_inclusive(admin_client, db_sessionmaker, bot):
    await seed(db_sessionmaker)
    exact = T.isoformat()
    body = (await admin_client.get(BASE, params={"from": exact, "to": exact})).json()
    assert body["messages"] == 4  # a1, b1, b2, dm at exactly T
    after = (T + timedelta(minutes=2)).isoformat()
    body = (await admin_client.get(BASE, params={"from": after, "to": after})).json()
    assert body["messages"] == 1


async def test_top_groups_limit_ordering_and_tie_break(
    admin_client, db_sessionmaker, bot
):
    counts = {"5@g.us": 2, "1@g.us": 3, "4@g.us": 3, "3@g.us": 1, "2@g.us": 1}
    counts["6@g.us"] = 1
    rows = [
        _msg(f"{jid}-{i}", T, A, chat=jid)
        for jid, n in counts.items()
        for i in range(n)
    ]
    await _add(db_sessionmaker, *rows, groups=[Group(group_jid=jid) for jid in counts])
    body = (await admin_client.get(BASE, params=RANGE)).json()
    assert [(g["group_jid"], g["count"]) for g in body["top_groups"]] == [
        ("1@g.us", 3),
        ("4@g.us", 3),
        ("5@g.us", 2),
        ("2@g.us", 1),
        ("3@g.us", 1),
    ]


async def test_top_senders_are_limited_to_ten(admin_client, db_sessionmaker, bot):
    jids = [f"{500 + i}@s.whatsapp.net" for i in range(12)]
    rows = [_msg(f"s{i}", T, jid) for i, jid in enumerate(jids)]
    await _add(db_sessionmaker, *rows, senders=jids, groups=[Group(group_jid=G1)])
    body = (await admin_client.get(BASE, params=RANGE)).json()
    assert [s["sender_jid"] for s in body["top_senders"]] == jids[:10]


async def test_kb_topics_counted_by_start_time_in_range(
    admin_client, db_sessionmaker, bot
):
    def topic(tid, ts):
        return KBTopic(
            id=tid,
            group_jid=G1,
            start_time=ts,
            speakers="a",
            subject="s",
            summary="x",
            embedding=None,
        )

    await _add(
        db_sessionmaker,
        topic("in", T),
        topic("out", T - timedelta(days=3)),
        groups=[Group(group_jid=G1)],
    )
    body = (await admin_client.get(BASE, params=RANGE)).json()
    assert body["kb_topics"] == 1


async def test_late_utc_message_lands_on_next_local_day(
    admin_client, db_sessionmaker, bot
):
    late = datetime(2026, 6, 10, 22, 30, tzinfo=UTC)  # Thu 01:30 in Jerusalem
    await _add(db_sessionmaker, _msg("late", late, A), groups=[Group(group_jid=G1)])
    body = (
        await admin_client.get(
            BASE, params={"from": "2026-06-09T21:00:00Z", "to": "2026-06-12T20:59:59Z"}
        )
    ).json()
    assert body["bucket"] == "day"
    starts = [datetime.fromisoformat(p["start"]) for p in body["series"]]
    assert [s.astimezone(TZ).date().day for s in starts] == [10, 11, 12]
    assert all(s.astimezone(TZ).hour == 0 for s in starts)
    assert [p["count"] for p in body["series"]] == [0, 1, 0]
    assert body["by_hour"][1] == 1 and sum(body["by_hour"]) == 1
    assert body["by_weekday"][4] == 1 and sum(body["by_weekday"]) == 1  # Thursday
    assert len(body["by_hour"]) == 24 and len(body["by_weekday"]) == 7


async def test_hour_buckets_across_dst_start(admin_client, db_sessionmaker, bot):
    # Jerusalem jumps from 02:00 (+02) to 03:00 (+03) on 2026-03-27.
    before = datetime(2026, 3, 26, 23, 30, tzinfo=UTC)  # 01:30 +02
    after = datetime(2026, 3, 27, 0, 30, tzinfo=UTC)  # 03:30 +03
    await _add(
        db_sessionmaker,
        _msg("pre", before, A),
        _msg("post", after, A),
        groups=[Group(group_jid=G1)],
    )
    body = (
        await admin_client.get(
            BASE, params={"from": "2026-03-26T22:00:00Z", "to": "2026-03-27T03:00:00Z"}
        )
    ).json()
    assert body["bucket"] == "hour"
    starts = [datetime.fromisoformat(p["start"]) for p in body["series"]]
    assert [s.astimezone(UTC).hour for s in starts] == [22, 23, 0, 1, 2, 3]
    assert [s.astimezone(TZ).hour for s in starts] == [0, 1, 3, 4, 5, 6]
    assert [p["count"] for p in body["series"]] == [0, 1, 1, 0, 0, 0]
    assert body["by_hour"][1] == 1 and body["by_hour"][3] == 1


async def test_day_buckets_across_dst_start_are_local_midnights(
    admin_client, db_sessionmaker, bot
):
    body = (
        await admin_client.get(
            BASE, params={"from": "2026-03-25T00:00:00", "to": "2026-03-29T23:59:59"}
        )
    ).json()
    starts = [datetime.fromisoformat(p["start"]) for p in body["series"]]
    local = [s.astimezone(TZ) for s in starts]
    assert [d.day for d in local] == [25, 26, 27, 28, 29]
    assert all(d.hour == 0 for d in local)
    assert local[2].utcoffset() == timedelta(hours=2)
    assert local[3].utcoffset() == timedelta(hours=3)


async def test_naive_bounds_use_the_configured_zone(admin_client, db_sessionmaker, bot):
    await _add(
        db_sessionmaker,
        _msg("m", datetime(2026, 6, 10, 21, 30, tzinfo=UTC), A),  # 00:30 local, 11th
        groups=[Group(group_jid=G1)],
    )
    params = {"from": "2026-06-11T00:00:00", "to": "2026-06-11T23:59:59"}
    body = (await admin_client.get(BASE, params=params)).json()
    assert body["messages"] == 1
    assert datetime.fromisoformat(body["from"]) == datetime(2026, 6, 11, tzinfo=TZ)


async def test_sunday_is_weekday_zero(admin_client, db_sessionmaker, bot):
    sunday = datetime(2026, 6, 14, 9, 0, tzinfo=UTC)
    await _add(db_sessionmaker, _msg("sun", sunday, A), groups=[Group(group_jid=G1)])
    body = (
        await admin_client.get(
            BASE, params={"from": "2026-06-13T00:00:00Z", "to": "2026-06-15T00:00:00Z"}
        )
    ).json()
    assert body["by_weekday"] == [1, 0, 0, 0, 0, 0, 0]


async def test_missing_from_starts_at_the_earliest_message(
    admin_client, db_sessionmaker, bot
):
    await seed(db_sessionmaker)
    body = (await admin_client.get(BASE, params={"to": RANGE["to"]})).json()
    assert datetime.fromisoformat(body["from"]) == T
    assert body["messages"] == 6


async def test_empty_database_defaults_to_last_seven_days(admin_client, bot):
    resp = await admin_client.get(BASE)
    assert resp.status_code == 200
    body = resp.json()
    span = datetime.fromisoformat(body["to"]) - datetime.fromisoformat(body["from"])
    assert span == timedelta(days=7)
    assert body["bucket"] == "day"
    assert body["messages"] == body["chats"] == body["reactions"] == 0
    assert body["groups"] == {"total": 0, "managed": 0}
    assert body["split"] == {"text": 0, "media": 0, "other": 0}
    assert len(body["series"]) == 8
    assert all(p["count"] == 0 for p in body["series"])
    assert body["by_hour"] == [0] * 24 and body["by_weekday"] == [0] * 7


async def test_reversed_range_is_422(admin_client, bot):
    params = {"from": "2026-06-11T00:00:00Z", "to": "2026-06-10T00:00:00Z"}
    assert (await admin_client.get(BASE, params=params)).status_code == 422


@pytest.mark.parametrize(
    "params",
    [
        {"from": "1900-01-01T00:00:00Z"},
        {"to": "2200-01-01T00:00:00Z"},
        {"from": "not-a-date"},
    ],
)
async def test_out_of_range_or_invalid_dates_are_422(admin_client, bot, params):
    assert (await admin_client.get(BASE, params=params)).status_code == 422


async def test_huge_range_uses_month_buckets(admin_client, db_sessionmaker, bot):
    await seed(db_sessionmaker)
    params = {"from": "1970-01-01T00:00:00Z", "to": "2099-12-31T00:00:00Z"}
    resp = await admin_client.get(BASE, params=params)
    assert resp.status_code == 200
    body = resp.json()
    assert body["bucket"] == "month"
    assert len(body["series"]) == 130 * 12  # 1970-01 .. 2099-12
    first = datetime.fromisoformat(body["series"][0]["start"]).astimezone(TZ)
    assert (first.year, first.month, first.day, first.hour) == (1970, 1, 1, 0)
    assert body["messages"] == 6


async def test_month_buckets_for_a_known_range(admin_client, bot):
    params = {"from": "2020-01-15T00:00:00", "to": "2023-12-31T23:59:59"}
    body = (await admin_client.get(BASE, params=params)).json()
    assert body["bucket"] == "month"
    local = [datetime.fromisoformat(p["start"]).astimezone(TZ) for p in body["series"]]
    assert len(local) == 48
    assert local[0] == datetime(2020, 1, 1, tzinfo=TZ)
    assert all(d.day == 1 and d.hour == 0 for d in local)


async def test_week_buckets_are_monday_midnights_and_zero_filled(
    admin_client, db_sessionmaker, bot
):
    await _add(
        db_sessionmaker,
        _msg("w1", datetime(2026, 1, 8, 10, 0, tzinfo=UTC), A),  # Thu, week of 01-05
        _msg("w2", datetime(2026, 3, 5, 10, 0, tzinfo=UTC), A),  # Thu, week of 03-02
        groups=[Group(group_jid=G1)],
    )
    params = {"from": "2026-01-07T00:00:00", "to": "2026-06-10T00:00:00"}
    body = (await admin_client.get(BASE, params=params)).json()
    assert body["bucket"] == "week"
    local = [datetime.fromisoformat(p["start"]).astimezone(TZ) for p in body["series"]]
    assert local[0] == datetime(2026, 1, 5, tzinfo=TZ)  # precedes "from"
    assert all(d.weekday() == 0 and d.hour == 0 for d in local)  # Monday 00:00
    assert all((b.date() - a.date()).days == 7 for a, b in zip(local, local[1:]))
    counts = {d.date().isoformat(): p["count"] for d, p in zip(local, body["series"])}
    assert counts["2026-01-05"] == 1 and counts["2026-03-02"] == 1
    assert counts["2026-02-02"] == 0
    assert sum(counts.values()) == 2


async def test_naive_bounds_are_range_checked_in_the_configured_zone(admin_client, bot):
    # 1970-01-01 00:00 in Jerusalem is 1969-12-31 22:00 UTC.
    early = await admin_client.get(BASE, params={"from": "1970-01-01T00:00:00"})
    assert early.status_code == 422
    # 2100-01-01 01:00 in Jerusalem is 2099-12-31 23:00 UTC.
    late = await admin_client.get(BASE, params={"to": "2100-01-01T01:00:00"})
    assert late.status_code == 200


async def test_day_buckets_survive_a_dst_jump_at_midnight(
    admin_client, db_sessionmaker, bot
):
    # Jerusalem skipped 1974-07-07 00:00 -> 01:00; later days start at 00:00 again.
    msg = datetime(1974, 7, 8, 9, 0, tzinfo=UTC)  # 12:00 local
    await _add(db_sessionmaker, _msg("old", msg, A), groups=[Group(group_jid=G1)])
    params = {"from": "1974-07-05T00:00:00", "to": "1974-07-09T23:59:59"}
    body = (await admin_client.get(BASE, params=params)).json()
    local = [datetime.fromisoformat(p["start"]).astimezone(TZ) for p in body["series"]]
    assert [d.day for d in local] == [5, 6, 7, 8, 9]
    assert [d.hour for d in local] == [0, 0, 1, 0, 0]
    assert [p["count"] for p in body["series"]] == [0, 0, 0, 1, 0]
