from datetime import datetime, timezone

import httpx
import pytest_asyncio
from fastapi import FastAPI

from admin.auth import CSRF_HEADER, CSRF_VALUE, SESSION_COOKIE, create_session_token
from admin.router import build_admin_router
from api.deps import get_db_async_session
from config import get_settings
from models import Group, Message, Sender

from types import SimpleNamespace

SECRET = "s" * 32


def settings():
    return SimpleNamespace(
        admin_password="pw", admin_session_secret=SECRET, admin_cookie_secure=False
    )


@pytest_asyncio.fixture
async def client(db_sessionmaker):
    app = FastAPI()
    app.include_router(build_admin_router())

    async def _session():
        async with db_sessionmaker() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db_async_session] = _session
    app.dependency_overrides[get_settings] = settings
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={CSRF_HEADER: CSRF_VALUE},
        cookies={SESSION_COOKIE: create_session_token(SECRET)},
    ) as c:
        yield c


async def seed(db_sessionmaker):
    async with db_sessionmaker() as session:
        session.add(Sender(jid="972501@s.whatsapp.net", push_name="Dana"))
        session.add(Group(group_jid="1@g.us", group_name="Alpha team", managed=True))
        session.add(
            Group(group_jid="2@g.us", group_name="Beta_100%", display_name="Zulu")
        )
        session.add(Group(group_jid="3@g.us", group_name=None))
        await session.flush()
        for i in range(3):
            session.add(
                Message(
                    message_id=f"m{i}",
                    chat_jid="1@g.us",
                    sender_jid="972501@s.whatsapp.net",
                    group_jid="1@g.us",
                    text=f"hello {i}",
                    timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc),
                )
            )
        await session.commit()


async def test_list_search_filter_sort_and_counts(client, db_sessionmaker):
    await seed(db_sessionmaker)
    body = (await client.get("/api/v1/admin/groups")).json()
    assert body["total"] == 3
    names = [g["group_jid"] for g in body["items"]]
    assert names == ["3@g.us", "1@g.us", "2@g.us"]  # "3@g.us" < "alpha team" < "zulu"
    counts = {g["group_jid"]: g["message_count"] for g in body["items"]}
    assert counts == {"1@g.us": 3, "2@g.us": 0, "3@g.us": 0}

    only_managed = (await client.get("/api/v1/admin/groups?managed=true")).json()
    assert [g["group_jid"] for g in only_managed["items"]] == ["1@g.us"]
    assert only_managed["total"] == 1

    # wildcard characters are matched literally
    literal = (
        await client.get("/api/v1/admin/groups", params={"search": "100%"})
    ).json()
    assert [g["group_jid"] for g in literal["items"]] == ["2@g.us"]
    assert (await client.get("/api/v1/admin/groups", params={"search": "%"})).json()[
        "total"
    ] == 1
    by_alias = (
        await client.get("/api/v1/admin/groups", params={"search": "zulu"})
    ).json()
    assert [g["group_jid"] for g in by_alias["items"]] == ["2@g.us"]

    top = (await client.get("/api/v1/admin/groups?sort=-message_count&limit=1")).json()
    assert top["items"][0]["group_jid"] == "1@g.us" and top["total"] == 3


async def test_patch_persists_only_sent_fields(client, db_sessionmaker):
    await seed(db_sessionmaker)
    resp = await client.patch(
        "/api/v1/admin/groups/1@g.us",
        json={
            "notify_on_spam": True,
            "community_keys": ["x", "y"],
            "display_name": "Alias",
        },
    )
    assert resp.status_code == 200
    async with db_sessionmaker() as session:
        group = await session.get(Group, "1@g.us")
        assert group.managed is True  # untouched
        assert group.notify_on_spam is True
        assert group.community_keys == ["x", "y"]
        assert group.display_name == "Alias"
        assert group.group_name == "Alpha team"
    cleared = await client.patch(
        "/api/v1/admin/groups/1@g.us", json={"community_keys": [], "display_name": ""}
    )
    assert (
        cleared.json()["community_keys"] == []
        and cleared.json()["display_name"] is None
    )
    async with db_sessionmaker() as session:
        assert (await session.get(Group, "1@g.us")).community_keys is None
    assert (
        await client.patch("/api/v1/admin/groups/missing@g.us", json={"managed": True})
    ).status_code == 404
