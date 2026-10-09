from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import FastAPI

from api.deps import get_db_async_session, get_whatsapp
from api.status import router
from whatsapp.jid import JID
from whatsapp.types import SessionStatus


def make_client(lid):
    whatsapp = AsyncMock()
    whatsapp.get_status = AsyncMock(
        return_value=SessionStatus(status="ready", phone="972559661780")
    )
    whatsapp.get_my_jid = AsyncMock(
        return_value=JID(user="972559661780", server="s.whatsapp.net")
    )
    whatsapp.get_my_lid = AsyncMock(return_value=lid)

    result = MagicMock()
    result.fetchone.return_value = (2,)
    conn = AsyncMock()
    conn.execute = AsyncMock(return_value=result)
    session = AsyncMock()
    session.connection = AsyncMock(return_value=conn)

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_whatsapp] = lambda: whatsapp
    app.dependency_overrides[get_db_async_session] = lambda: session
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


@pytest.mark.asyncio
async def test_status_reports_bot_lid():
    async with make_client(JID(user="209878492672151", server="lid")) as c:
        body = (await c.get("/status")).json()
    whatsapp = body["checks"]["whatsapp"]
    assert whatsapp["bot_jid"] == "972559661780@s.whatsapp.net"
    assert whatsapp["bot_lid"] == "209878492672151@lid"


@pytest.mark.asyncio
async def test_status_bot_lid_is_null_when_unknown():
    async with make_client(None) as c:
        resp = await c.get("/status")
    assert resp.status_code == 200
    assert resp.json()["checks"]["whatsapp"]["bot_lid"] is None
