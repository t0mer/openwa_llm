from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from admin import contacts as contacts_module
from admin.auth import require_admin
from api.deps import get_db_async_session
from models import Sender


@pytest.fixture
def ctx():
    session = AsyncMock()
    app = FastAPI()
    app.include_router(contacts_module.router, prefix="/contacts")
    app.dependency_overrides[require_admin] = lambda: None
    app.dependency_overrides[get_db_async_session] = lambda: session
    return TestClient(app), session


def _result(rows=None, scalar=None):
    res = MagicMock()
    res.all.return_value = rows or []
    res.scalar_one.return_value = scalar
    return res


def test_list_contacts(ctx):
    client, session = ctx
    sender = Sender(jid="9725@s.whatsapp.net", push_name="Dana")
    session.execute.side_effect = [_result(rows=[(sender, True)]), _result(scalar=1)]
    body = client.get("/contacts?search=dan&opted_out=true").json()
    assert body == {
        "items": [
            {"jid": "9725@s.whatsapp.net", "push_name": "Dana", "opted_out": True}
        ],
        "total": 1,
    }


def test_list_contacts_limits(ctx):
    client, _ = ctx
    assert client.get("/contacts?limit=0").status_code == 422
    assert client.get("/contacts?limit=201").status_code == 422


def test_patch_contact_only_changes_push_name(ctx):
    client, session = ctx
    sender = Sender(jid="9725@s.whatsapp.net", push_name="Old")
    session.get.return_value = sender
    session.execute.return_value = _result(scalar=1)
    resp = client.patch("/contacts/9725@s.whatsapp.net", json={"push_name": "  New  "})
    assert resp.status_code == 200 and resp.json()["push_name"] == "New"
    assert sender.push_name == "New"
    client.patch("/contacts/9725@s.whatsapp.net", json={"push_name": "  "})
    assert sender.push_name is None


def test_patch_contact_404_and_normalizes_jid(ctx):
    client, session = ctx
    session.get.return_value = None
    assert (
        client.patch(
            "/contacts/9725@s.whatsapp.net", json={"push_name": "x"}
        ).status_code
        == 404
    )
    session.get.assert_awaited_once()
    assert session.get.await_args.args[1] == "9725@s.whatsapp.net"
    session.get.reset_mock()
    client.patch("/contacts/9725:3@s.whatsapp.net", json={"push_name": "x"})
    assert session.get.await_args.args[1] == "9725@s.whatsapp.net"
