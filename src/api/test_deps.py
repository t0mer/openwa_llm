from types import SimpleNamespace
from typing import Annotated
from unittest.mock import Mock

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from api.deps import (
    build_handler,
    get_optional_whatsapp,
    get_session_id,
    get_whatsapp,
)
from handler import MessageHandler
from whatsapp import WhatsAppGateway


class FakeRegistry:
    def __init__(self, ids: list[str]) -> None:
        self._gw = {pk: f"gw-{pk}" for pk in ids}

    def ids(self) -> list[str]:
        return list(self._gw)

    def get(self, pk: str):
        return self._gw[pk]


def _client(ids: list[str]) -> TestClient:
    app = FastAPI()
    app.state.registry = FakeRegistry(ids)

    @app.get("/sid")
    def sid(session_id: Annotated[str, Depends(get_session_id)]) -> str:
        return session_id

    @app.get("/gw")
    def gw(whatsapp: Annotated[WhatsAppGateway, Depends(get_whatsapp)]) -> str:
        return str(whatsapp)

    return TestClient(app)


def test_single_active_session_is_auto_selected():
    client = _client(["a"])
    assert client.get("/sid").json() == "a"
    assert client.get("/gw").json() == "gw-a"


def test_given_active_session_is_used():
    client = _client(["a", "b"])
    assert client.get("/sid", params={"session_id": "b"}).json() == "b"
    assert client.get("/gw", params={"session_id": "b"}).json() == "gw-b"


@pytest.mark.parametrize("ids", [["a"], ["a", "b"], []])
def test_unknown_session_is_404(ids):
    resp = _client(ids).get("/gw", params={"session_id": "zzz"})
    assert resp.status_code == 404


@pytest.mark.parametrize("ids", [["a", "b"], []])
def test_omitted_session_without_single_active_is_400(ids):
    resp = _client(ids).get("/gw")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "session_id required"


def test_build_handler_binds_the_sessions_gateway():
    state = SimpleNamespace(registry=FakeRegistry(["a", "b"]), embedding_client="emb")
    request = SimpleNamespace(app=SimpleNamespace(state=state))
    db = Mock()
    handler = build_handler(request, db, "b", Mock())  # type: ignore[arg-type]
    assert isinstance(handler, MessageHandler)
    assert (handler.session, handler.whatsapp, handler.embedding_client) == (
        db,
        "gw-b",
        "emb",
    )
    assert handler.session_id == "b"


class VanishingRegistry(FakeRegistry):
    """Lists a session that a concurrent reload removes before `get`."""

    def get(self, pk: str):
        raise KeyError(pk)


def test_session_removed_between_lookup_and_get_is_404():
    app = FastAPI()
    app.state.registry = VanishingRegistry(["a"])

    @app.get("/gw")
    def gw(whatsapp: Annotated[WhatsAppGateway, Depends(get_whatsapp)]) -> str:
        return str(whatsapp)

    @app.get("/optional")
    def optional(
        whatsapp: Annotated[WhatsAppGateway | None, Depends(get_optional_whatsapp)],
    ) -> str:
        return str(whatsapp)

    client = TestClient(app, raise_server_exceptions=False)
    for path in ("/gw", "/optional"):
        resp = client.get(path)
        assert resp.status_code == 404
        assert resp.json() == {"detail": "session not found"}
