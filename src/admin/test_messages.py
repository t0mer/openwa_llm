from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from admin import messages as messages_module
from admin.auth import require_admin
from api.deps import get_db_async_session
from models import Message, Sender

TS = datetime(2026, 10, 8, 12, 0, 0, 123456, tzinfo=timezone.utc)


def test_cursor_roundtrip_keeps_microseconds_and_ids_with_odd_characters():
    for message_id in ("3EB0ABCD", "true_1203@g.us_ABC|x", "ünï"):
        cursor = messages_module.encode_cursor(TS, message_id)
        assert messages_module.decode_cursor(cursor) == (TS, message_id)


@pytest.mark.parametrize("bad", ["", "!!!", "bm90LWEtY3Vyc29y", "e30"])
def test_decode_cursor_rejects_garbage(bad):
    with pytest.raises(ValueError):
        messages_module.decode_cursor(bad)


@pytest.fixture
def ctx():
    session = AsyncMock()
    app = FastAPI()
    app.include_router(messages_module.router, prefix="/messages")
    app.dependency_overrides[require_admin] = lambda: None
    app.dependency_overrides[get_db_async_session] = lambda: session
    return TestClient(app), session


def _msg(i: int) -> Message:
    m = Message(
        message_id=f"m{i}",
        chat_jid="1203@g.us",
        sender_jid="9725@s.whatsapp.net",
        group_jid="1203@g.us",
        text=f"hi {i}",
        media_url="x" if i == 0 else None,
        timestamp=TS,
    )
    m.sender = Sender(jid="9725@s.whatsapp.net", push_name="Dana")
    return m


def _scalars(items):
    res = MagicMock()
    res.scalars.return_value.all.return_value = items
    return res


def _rows(rows):
    res = MagicMock()
    res.all.return_value = rows
    return res


def test_page_has_next_cursor_when_more_rows_than_limit(ctx):
    client, session = ctx
    session.execute.side_effect = [
        _scalars([_msg(0), _msg(1), _msg(2)]),
        _rows([("m0", 2)]),
    ]
    body = client.get("/messages?limit=2").json()
    assert [m["message_id"] for m in body["items"]] == ["m0", "m1"]
    assert (
        body["items"][0]["reaction_count"] == 2
        and body["items"][1]["reaction_count"] == 0
    )
    assert (
        body["items"][0]["has_media"] is True and body["items"][1]["has_media"] is False
    )
    assert body["items"][0]["sender_name"] == "Dana"
    assert messages_module.decode_cursor(body["next_cursor"]) == (TS, "m1")


def test_last_page_has_no_cursor(ctx):
    client, session = ctx
    session.execute.side_effect = [_scalars([_msg(1)]), _rows([])]
    assert client.get("/messages?limit=2").json()["next_cursor"] is None


def test_empty_page_skips_reaction_query(ctx):
    client, session = ctx
    session.execute.side_effect = [_scalars([])]
    assert client.get("/messages").json() == {"items": [], "next_cursor": None}


def test_validation(ctx):
    client, _ = ctx
    assert client.get("/messages?limit=101").status_code == 422
    assert client.get("/messages?limit=0").status_code == 422
    assert client.get("/messages?before=garbage").status_code == 422
    assert client.get("/messages?from=not-a-date").status_code == 422
    assert client.get("/messages?q=" + "x" * 201).status_code == 422
