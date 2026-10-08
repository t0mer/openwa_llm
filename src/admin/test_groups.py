from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from admin import groups as groups_module
from admin.auth import require_admin
from api.deps import get_db_async_session
from models import Group

NOW = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc)


def make_group(**kw: Any) -> Group:
    base: dict[str, Any] = dict(
        group_jid="1203@g.us",
        group_name="WA name",
        group_topic="topic",
        display_name=None,
        managed=False,
        notify_on_spam=False,
        community_keys=None,
        last_ingest=NOW.replace(tzinfo=None),
        last_summary_sync=NOW.replace(tzinfo=None),
        created_at=NOW,
    )
    base.update(kw)
    return Group(**base)


@pytest.fixture
def ctx():
    session = AsyncMock()
    session.add = MagicMock()
    app = FastAPI()
    app.include_router(groups_module.router, prefix="/groups")
    app.dependency_overrides[require_admin] = lambda: None
    app.dependency_overrides[get_db_async_session] = lambda: session
    return TestClient(app), session


def _result(rows=None, scalar=None):
    res = MagicMock()
    res.all.return_value = rows or []
    res.scalar_one.return_value = scalar
    return res


def test_list_groups_maps_rows_and_total(ctx):
    client, session = ctx
    g = make_group(community_keys=["a"], display_name="Alias")
    session.execute.side_effect = [_result(rows=[(g, 7)]), _result(scalar=1)]
    body = client.get("/groups?search=wa&managed=false&sort=-message_count").json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["group_jid"] == "1203@g.us"
    assert item["group_name"] == "WA name" and item["display_name"] == "Alias"
    assert item["community_keys"] == ["a"] and item["message_count"] == 7
    assert item["managed"] is False and item["notify_on_spam"] is False


def test_list_groups_none_keys_become_empty_list(ctx):
    client, session = ctx
    session.execute.side_effect = [_result(rows=[(make_group(), 0)]), _result(scalar=1)]
    assert client.get("/groups").json()["items"][0]["community_keys"] == []


def test_list_groups_validates_query_params(ctx):
    client, _ = ctx
    assert client.get("/groups?sort=bogus").status_code == 422
    assert client.get("/groups?limit=0").status_code == 422
    assert client.get("/groups?limit=201").status_code == 422
    assert client.get("/groups?offset=-1").status_code == 422
    assert client.get("/groups?search=" + "x" * 101).status_code == 422


def test_group_filters_escape_like_wildcards():
    from sqlalchemy.dialects import postgresql

    (cond,) = groups_module.group_filters("50%_off\\", None)
    params = cond.compile(dialect=postgresql.dialect()).params
    assert set(params.values()) == {"%50\\%\\_off\\\\%"}


def test_get_group_404(ctx):
    client, session = ctx
    session.get.return_value = None
    assert client.get("/groups/nope@g.us").status_code == 404


def test_patch_changes_only_sent_fields(ctx):
    client, session = ctx
    group = make_group(
        managed=False, notify_on_spam=True, community_keys=["x"], display_name="Keep"
    )
    session.get.return_value = group
    session.execute.return_value = _result(scalar=3)
    resp = client.patch("/groups/1203@g.us", json={"managed": True})
    assert resp.status_code == 200
    assert group.managed is True
    assert group.notify_on_spam is True
    assert group.community_keys == ["x"]
    assert group.display_name == "Keep"
    assert resp.json()["message_count"] == 3
    session.add.assert_called_once_with(group)


def test_patch_display_name_trims_and_clears(ctx):
    client, session = ctx
    group = make_group(display_name="Old")
    session.get.return_value = group
    session.execute.return_value = _result(scalar=0)
    client.patch("/groups/1203@g.us", json={"display_name": "  New  "})
    assert group.display_name == "New"
    client.patch("/groups/1203@g.us", json={"display_name": "   "})
    assert group.display_name is None
    group.display_name = "Again"
    client.patch("/groups/1203@g.us", json={"display_name": None})
    assert group.display_name is None


def test_patch_community_keys_normalized(ctx):
    client, session = ctx
    group = make_group()
    session.get.return_value = group
    session.execute.return_value = _result(scalar=0)
    client.patch(
        "/groups/1203@g.us", json={"community_keys": [" b ", "a", "b", "", "  "]}
    )
    assert group.community_keys == ["b", "a"]
    client.patch("/groups/1203@g.us", json={"community_keys": []})
    assert group.community_keys is None
    group.community_keys = ["z"]
    client.patch("/groups/1203@g.us", json={"community_keys": None})
    assert group.community_keys is None


def test_patch_validation_errors(ctx):
    client, session = ctx
    session.get.return_value = make_group()
    assert client.patch("/groups/1203@g.us", json={"managed": None}).status_code == 422
    assert (
        client.patch("/groups/1203@g.us", json={"notify_on_spam": None}).status_code
        == 422
    )
    assert (
        client.patch(
            "/groups/1203@g.us", json={"community_keys": [f"k{i}" for i in range(51)]}
        ).status_code
        == 422
    )
    assert (
        client.patch(
            "/groups/1203@g.us", json={"community_keys": ["x" * 101]}
        ).status_code
        == 422
    )
    assert (
        client.patch("/groups/1203@g.us", json={"display_name": "x" * 256}).status_code
        == 422
    )


def test_patch_many_duplicate_keys_collapse_before_the_limit(ctx):
    client, session = ctx
    session.get.return_value = make_group()
    session.execute.return_value = _result(scalar=0)
    resp = client.patch("/groups/1203@g.us", json={"community_keys": ["k"] * 60})
    assert resp.status_code == 200
    assert session.get.return_value.community_keys == ["k"]


def test_patch_unknown_group_404_and_ignores_unknown_fields(ctx):
    client, session = ctx
    session.get.return_value = None
    assert client.patch("/groups/nope@g.us", json={"managed": True}).status_code == 404
    session.get.return_value = make_group()
    session.execute.return_value = _result(scalar=0)
    resp = client.patch(
        "/groups/1203@g.us", json={"group_name": "hack", "owner_jid": "x"}
    )
    assert resp.status_code == 200
    assert session.get.return_value.group_name == "WA name"
