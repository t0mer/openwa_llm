# pyright: reportArgumentType=false
from unittest.mock import AsyncMock

import httpx
from fastapi import FastAPI

from api import summarize_and_send_to_group_api as api
from api.deps import get_db_async_session, get_settings, get_whatsapp


async def test_legacy_endpoint_contract_unchanged(monkeypatch):
    called = AsyncMock(return_value=[])
    monkeypatch.setattr(api, "summarize_and_send_to_groups", called)
    app = FastAPI()
    app.include_router(api.router)
    app.dependency_overrides[get_db_async_session] = lambda: object()
    app.dependency_overrides[get_whatsapp] = lambda: object()
    app.dependency_overrides[get_settings] = lambda: object()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        r = await c.post("/summarize_and_send_to_groups")
    assert r.status_code == 200
    assert r.json() == {
        "status": "success",
        "message": "send summaries to groups sync completed successfully",
    }
    called.assert_awaited_once()
