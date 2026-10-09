import pytest

from models import Group, GroupSummarySchedule

BASE = "/api/v1/admin/groups/1@g.us/schedules"


async def seed(db_sessionmaker):
    async with db_sessionmaker() as session:
        session.add(Group(group_jid="1@g.us", group_name="Alpha", managed=True))
        session.add(Group(group_jid="2@g.us", group_name="Beta"))
        await session.commit()


async def stored(db_sessionmaker, group_jid="1@g.us"):
    from sqlmodel import select

    async with db_sessionmaker() as session:
        rows = await session.execute(
            select(GroupSummarySchedule).where(
                GroupSummarySchedule.group_jid == group_jid
            )
        )
        return list(rows.scalars().all())


async def test_get_empty_and_timezone(admin_client, db_sessionmaker):
    await seed(db_sessionmaker)
    resp = await admin_client.get(BASE)
    assert resp.status_code == 200
    assert resp.json() == {"timezone": "Asia/Jerusalem", "items": []}


@pytest.mark.parametrize(
    "body,hour,hour12,meridiem,minute",
    [
        ({"hour": 0, "minute": 0}, 0, 12, "AM", 0),
        ({"hour12": 12, "meridiem": "AM", "minute": 0}, 0, 12, "AM", 0),
        ({"hour": 12, "minute": 0}, 12, 12, "PM", 0),
        ({"hour12": 12, "meridiem": "PM", "minute": 0}, 12, 12, "PM", 0),
        ({"hour12": 11, "meridiem": "PM", "minute": 59}, 23, 11, "PM", 59),
        ({"hour": 23, "minute": 59}, 23, 11, "PM", 59),
        ({"hour12": 1, "meridiem": "PM", "minute": 5}, 13, 1, "PM", 5),
    ],
)
async def test_create_round_trip(
    admin_client, db_sessionmaker, body, hour, hour12, meridiem, minute
):
    await seed(db_sessionmaker)
    resp = await admin_client.post(BASE, json={"weekdays": [6, 0, 6], **body})
    assert resp.status_code == 201, resp.text
    out = resp.json()
    assert (out["hour"], out["hour12"], out["meridiem"], out["minute"]) == (
        hour,
        hour12,
        meridiem,
        minute,
    )
    assert out["weekdays"] == [0, 6]
    assert out["enabled"] is True
    assert out["last_run_at"] is None and out["last_status"] is None
    rows = await stored(db_sessionmaker)
    assert [(r.hour, r.minute, r.weekdays) for r in rows] == [(hour, minute, [0, 6])]
    listed = (await admin_client.get(BASE)).json()["items"]
    assert [i["id"] for i in listed] == [out["id"]]


@pytest.mark.parametrize(
    "body",
    [
        {"weekdays": [], "hour": 1, "minute": 0},
        {"weekdays": [7], "hour": 1, "minute": 0},
        {"weekdays": [1], "hour12": 1, "meridiem": "PM", "hour": 13, "minute": 0},
        {"weekdays": [1], "hour": 13, "meridiem": "PM", "minute": 0},
        {"weekdays": [1], "hour12": 13, "meridiem": "PM", "minute": 0},
        {"weekdays": [1], "minute": 0},
        {"weekdays": [1], "hour": 1},
        {"weekdays": [1], "hour": 24, "minute": 0},
        {"weekdays": [1], "hour": 1, "minute": 60},
        {"weekdays": [1], "hour12": 1, "minute": 0},
        {"weekdays": [1] * 1000, "hour": 1, "minute": 0},
        {"hour": 1, "minute": 0},
        {},
    ],
)
async def test_create_invalid_is_422_without_row(admin_client, db_sessionmaker, body):
    await seed(db_sessionmaker)
    resp = await admin_client.post(BASE, json=body)
    assert resp.status_code == 422
    assert await stored(db_sessionmaker) == []


async def test_limit_20_then_409(admin_client, db_sessionmaker):
    await seed(db_sessionmaker)
    for i in range(20):
        resp = await admin_client.post(
            BASE, json={"weekdays": [1], "hour": i % 24, "minute": i}
        )
        assert resp.status_code == 201
    resp = await admin_client.post(BASE, json={"weekdays": [1], "hour": 1, "minute": 1})
    assert resp.status_code == 409
    assert len(await stored(db_sessionmaker)) == 20
    # another group is unaffected
    other = await admin_client.post(
        "/api/v1/admin/groups/2@g.us/schedules",
        json={"weekdays": [1], "hour": 1, "minute": 1},
    )
    assert other.status_code == 201
    # deleting one frees a slot
    first = (await admin_client.get(BASE)).json()["items"][0]["id"]
    assert (await admin_client.delete(f"{BASE}/{first}")).status_code == 204
    again = await admin_client.post(
        BASE, json={"weekdays": [1], "hour": 1, "minute": 1}
    )
    assert again.status_code == 201


async def test_unknown_group_and_schedule(admin_client, db_sessionmaker):
    await seed(db_sessionmaker)
    missing = "/api/v1/admin/groups/nope@g.us/schedules"
    assert (await admin_client.get(missing)).status_code == 404
    assert (
        await admin_client.post(missing, json={"weekdays": [1], "hour": 1, "minute": 0})
    ).status_code == 404
    assert (await admin_client.patch(f"{missing}/x", json={})).status_code == 404
    assert (await admin_client.delete(f"{missing}/x")).status_code == 404
    assert (await admin_client.patch(f"{BASE}/nope", json={})).status_code == 404


async def test_schedule_of_other_group_is_not_reachable(admin_client, db_sessionmaker):
    await seed(db_sessionmaker)
    created = (
        await admin_client.post(
            "/api/v1/admin/groups/2@g.us/schedules",
            json={"weekdays": [1], "hour": 1, "minute": 0},
        )
    ).json()
    assert (
        await admin_client.patch(f"{BASE}/{created['id']}", json={"enabled": False})
    ).status_code == 404
    assert (await admin_client.delete(f"{BASE}/{created['id']}")).status_code == 204
    assert len(await stored(db_sessionmaker, "2@g.us")) == 1  # not deleted


async def test_patch_only_sent_fields(admin_client, db_sessionmaker):
    await seed(db_sessionmaker)
    created = (
        await admin_client.post(
            BASE, json={"weekdays": [1, 2], "hour": 9, "minute": 30, "enabled": True}
        )
    ).json()
    url = f"{BASE}/{created['id']}"
    r = await admin_client.patch(url, json={"enabled": False})
    assert r.status_code == 200
    assert r.json()["enabled"] is False
    assert (r.json()["weekdays"], r.json()["hour"], r.json()["minute"]) == (
        [1, 2],
        9,
        30,
    )
    r = await admin_client.patch(url, json={"minute": 45})
    assert (r.json()["hour"], r.json()["minute"], r.json()["enabled"]) == (9, 45, False)
    r = await admin_client.patch(url, json={"hour12": 12, "meridiem": "AM"})
    assert (r.json()["hour"], r.json()["minute"]) == (0, 45)
    r = await admin_client.patch(url, json={"weekdays": [5, 3, 5]})
    assert r.json()["weekdays"] == [3, 5] and r.json()["hour"] == 0
    r = await admin_client.patch(url, json={})
    assert r.status_code == 200 and r.json()["weekdays"] == [3, 5]
    rows = await stored(db_sessionmaker)
    assert [(x.weekdays, x.hour, x.minute, x.enabled) for x in rows] == [
        ([3, 5], 0, 45, False)
    ]


async def test_patch_invalid_leaves_row_untouched(admin_client, db_sessionmaker):
    await seed(db_sessionmaker)
    created = (
        await admin_client.post(BASE, json={"weekdays": [1], "hour": 9, "minute": 30})
    ).json()
    url = f"{BASE}/{created['id']}"
    for bad in (
        {"weekdays": []},
        {"weekdays": [9]},
        {"hour": 1, "hour12": 1, "meridiem": "AM"},
        {"hour": 13, "meridiem": "PM"},
        {"hour12": 1},
        {"minute": 99},
        {"enabled": None},
    ):
        assert (await admin_client.patch(url, json=bad)).status_code == 422, bad
    rows = await stored(db_sessionmaker)
    assert [(x.weekdays, x.hour, x.minute) for x in rows] == [([1], 9, 30)]


async def test_delete_is_idempotent(admin_client, db_sessionmaker):
    await seed(db_sessionmaker)
    created = (
        await admin_client.post(BASE, json={"weekdays": [1], "hour": 9, "minute": 30})
    ).json()
    url = f"{BASE}/{created['id']}"
    assert (await admin_client.delete(url)).status_code == 204
    assert (await admin_client.delete(url)).status_code == 204
    assert await stored(db_sessionmaker) == []


async def test_last_run_fields_exposed(admin_client, db_sessionmaker):
    from datetime import datetime, timezone

    await seed(db_sessionmaker)
    async with db_sessionmaker() as session:
        session.add(
            GroupSummarySchedule(
                group_jid="1@g.us",
                weekdays=[1],
                hour=9,
                minute=0,
                last_run_at=datetime(2026, 1, 1, 7, 0, tzinfo=timezone.utc),
                last_status="failed",
                last_reason="error",
                last_message_count=3,
            )
        )
        await session.commit()
    item = (await admin_client.get(BASE)).json()["items"][0]
    assert item["last_status"] == "failed" and item["last_reason"] == "error"
    assert item["last_message_count"] == 3 and item["last_run_at"].startswith(
        "2026-01-01"
    )


async def test_errors_do_not_leak_internals(admin_client, db_sessionmaker):
    await seed(db_sessionmaker)
    resp = await admin_client.post(BASE, json={"weekdays": [1], "hour": 1})
    assert resp.status_code == 422
    for needle in ("Traceback", "sqlalchemy", "asyncpg", "psycopg"):
        assert needle not in resp.text


async def test_schedule_count_on_group_list_get_patch(admin_client, db_sessionmaker):
    await seed(db_sessionmaker)
    for h in (1, 2):
        await admin_client.post(BASE, json={"weekdays": [1], "hour": h, "minute": 0})
    listed = (await admin_client.get("/api/v1/admin/groups")).json()["items"]
    counts = {g["group_jid"]: g["schedule_count"] for g in listed}
    assert counts == {"1@g.us": 2, "2@g.us": 0}
    one = (await admin_client.get("/api/v1/admin/groups/1@g.us")).json()
    assert one["schedule_count"] == 2
    patched = (
        await admin_client.patch("/api/v1/admin/groups/1@g.us", json={"managed": False})
    ).json()
    assert patched["schedule_count"] == 2
    # message_count still correct alongside the second join
    assert patched["message_count"] == 0


async def test_requires_auth_and_csrf(admin_client, db_sessionmaker):
    import httpx

    await seed(db_sessionmaker)
    anon = httpx.AsyncClient(transport=admin_client._transport, base_url="http://test")
    try:
        assert (await anon.get(BASE)).status_code == 401
    finally:
        await anon.aclose()
    no_csrf = httpx.AsyncClient(
        transport=admin_client._transport,
        base_url="http://test",
        cookies=admin_client.cookies,
    )
    try:
        resp = await no_csrf.post(BASE, json={"weekdays": [1], "hour": 1, "minute": 0})
        assert resp.status_code in (401, 403)
    finally:
        await no_csrf.aclose()
    assert await stored(db_sessionmaker) == []
