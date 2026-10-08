from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from admin import optouts as optouts_module
from admin.auth import require_admin
from api.deps import get_db_async_session
from models import OptOut


@pytest.fixture
def ctx():
    session = AsyncMock()
    session.add = MagicMock()
    app = FastAPI()
    app.include_router(optouts_module.router, prefix="/opt-outs")
    app.dependency_overrides[require_admin] = lambda: None
    app.dependency_overrides[get_db_async_session] = lambda: session
    return TestClient(app), session


def test_add_opt_out_normalizes_and_is_idempotent(ctx):
    client, session = ctx
    session.get.return_value = None
    resp = client.post("/opt-outs", json={"jid": "+972 50-123-4567"})
    assert resp.status_code == 201
    assert resp.json()["jid"] == "972501234567@s.whatsapp.net"
    (added,), _ = session.add.call_args
    assert isinstance(added, OptOut) and added.jid == "972501234567@s.whatsapp.net"

    session.add.reset_mock()
    existing = OptOut(jid="972501234567@s.whatsapp.net")
    session.get.side_effect = lambda model, _key: existing if model is OptOut else None
    again = client.post("/opt-outs", json={"jid": "972501234567@c.us"})
    assert again.status_code == 200
    session.add.assert_not_called()


@pytest.mark.parametrize("bad", ["", "abc", "1203@g.us", "@c.us"])
def test_add_opt_out_rejects_bad_input(ctx, bad):
    client, session = ctx
    assert client.post("/opt-outs", json={"jid": bad}).status_code == 422
    session.add.assert_not_called()


def test_delete_opt_out_is_idempotent(ctx):
    client, session = ctx
    existing = OptOut(jid="972501234567@s.whatsapp.net")
    session.get.return_value = existing
    assert client.delete("/opt-outs/972501234567@s.whatsapp.net").status_code == 204
    session.delete.assert_awaited_once_with(existing)
    session.delete.reset_mock()
    session.get.return_value = None
    assert client.delete("/opt-outs/972501234567@s.whatsapp.net").status_code == 204
    session.delete.assert_not_called()


def test_delete_opt_out_normalizes_c_us(ctx):
    client, session = ctx
    session.get.return_value = None
    client.delete("/opt-outs/972501234567@c.us")
    assert session.get.await_args.args[1] == "972501234567@s.whatsapp.net"


def test_list_opt_outs(ctx):
    client, session = ctx
    res = MagicMock()
    res.all.return_value = [
        (
            OptOut(
                jid="9725@s.whatsapp.net",
                created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            ),
            "Dana",
        )
    ]
    session.execute.return_value = res
    body = client.get("/opt-outs").json()
    assert body[0]["jid"] == "9725@s.whatsapp.net" and body[0]["push_name"] == "Dana"


@pytest.mark.parametrize("bad", ["972\x00@c.us", "٣٤٥"])
def test_add_opt_out_rejects_nul_and_non_ascii_digits(ctx, bad):
    client, session = ctx
    assert client.post("/opt-outs", json={"jid": bad}).status_code == 422
    session.add.assert_not_called()


@pytest.mark.parametrize("bad", ["972%00@c.us", "garbage", "%D9%A3%D9%A4%D9%A5"])
def test_delete_opt_out_rejects_garbage(ctx, bad):
    client, session = ctx
    assert client.delete(f"/opt-outs/{bad}").status_code == 422
    session.delete.assert_not_called()
