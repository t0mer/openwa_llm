from typing import Annotated

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from api.deps import (
    get_session_id,
    get_webhook_session_id,
    get_webhook_whatsapp,
    get_whatsapp,
)
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

    @app.get("/hook")
    def hook(
        session_id: Annotated[str | None, Depends(get_webhook_session_id)],
        whatsapp: Annotated[WhatsAppGateway | None, Depends(get_webhook_whatsapp)],
    ) -> list[str | None]:
        return [session_id, None if whatsapp is None else str(whatsapp)]

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


def test_webhook_temp_uses_first_active_session():
    assert _client(["a", "b"]).get("/hook").json() == ["a", "gw-a"]


def test_webhook_temp_without_sessions_is_none():
    assert _client([]).get("/hook").json() == [None, None]
