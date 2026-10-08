import httpx
import pytest
from pytest_httpx import HTTPXMock

from whatsapp.gateway import GatewayError
from whatsapp.openwa import OpenWAGateway
from whatsapp.types import GroupInfo, SessionStatus

BASE = "http://test-api"
SESSION = f"{BASE}/api/sessions/s1"


@pytest.fixture
def gateway():
    return OpenWAGateway(BASE, api_key="k", session_id="s1", groups_page_size=2)


async def test_send_text_maps_jid_and_reply(gateway, httpx_mock: HTTPXMock):
    httpx_mock.add_response(
        method="POST",
        url=f"{SESSION}/messages/send-text",
        match_headers={"X-API-Key": "k"},
        match_json={
            "chatId": "972501234567@c.us",
            "text": "hi",
            "quotedMessageId": "m0",
        },
        json={"messageId": "out1", "timestamp": 1},
        status_code=201,
    )
    assert await gateway.send_text("972501234567@s.whatsapp.net", "hi", "m0") == "out1"


async def test_send_text_group_without_reply_omits_quote(gateway, httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url=f"{SESSION}/messages/send-text",
        match_json={"chatId": "120363@g.us", "text": "yo"},
        json={"messageId": "out2"},
        status_code=201,
    )
    assert await gateway.send_text("120363@g.us", "yo") == "out2"


async def test_send_text_session_not_ready_raises(gateway, httpx_mock):
    httpx_mock.add_response(
        method="POST", url=f"{SESSION}/messages/send-text", status_code=409
    )
    with pytest.raises(GatewayError, match="not ready"):
        await gateway.send_text("120363@g.us", "yo")


async def test_send_text_server_error_raises(gateway, httpx_mock):
    httpx_mock.add_response(
        method="POST", url=f"{SESSION}/messages/send-text", status_code=500, text="boom"
    )
    with pytest.raises(GatewayError, match="500"):
        await gateway.send_text("120363@g.us", "yo")


async def test_send_text_network_error_raises(gateway, httpx_mock):
    httpx_mock.add_exception(httpx.ConnectError("down"))
    with pytest.raises(GatewayError):
        await gateway.send_text("120363@g.us", "yo")


async def test_send_text_missing_message_id_raises(gateway, httpx_mock):
    httpx_mock.add_response(
        method="POST", url=f"{SESSION}/messages/send-text", json={}, status_code=201
    )
    with pytest.raises(GatewayError, match="messageId"):
        await gateway.send_text("120363@g.us", "yo")


async def test_get_status(gateway, httpx_mock):
    httpx_mock.add_response(
        url=SESSION, json={"id": "s1", "status": "qr_ready", "phone": None}
    )
    assert await gateway.get_status() == SessionStatus(status="qr_ready", phone=None)


async def test_get_my_jid_ready_is_canonical_and_cached(gateway, httpx_mock):
    # Only one response registered: a second HTTP call would fail the test.
    httpx_mock.add_response(
        url=SESSION, json={"status": "ready", "phone": "+972 50-123-4567"}
    )
    jid = await gateway.get_my_jid()
    assert (jid.user, jid.server) == ("972501234567", "s.whatsapp.net")
    assert await gateway.get_my_jid() is jid


async def test_get_my_jid_strips_device_suffix(gateway, httpx_mock):
    httpx_mock.add_response(
        url=SESSION, json={"status": "ready", "phone": "972501234567:12@c.us"}
    )
    assert (await gateway.get_my_jid()).user == "972501234567"


async def test_get_my_jid_not_ready_raises_and_is_not_cached(gateway, httpx_mock):
    httpx_mock.add_response(url=SESSION, json={"status": "qr_ready", "phone": None})
    with pytest.raises(GatewayError, match="qr_ready"):
        await gateway.get_my_jid()
    httpx_mock.add_response(
        url=SESSION, json={"status": "ready", "phone": "972501234567"}
    )
    assert (await gateway.get_my_jid()).user == "972501234567"


async def test_list_groups_paginates_and_canonicalizes(gateway, httpx_mock):
    httpx_mock.add_response(
        url=f"{SESSION}/groups?limit=2&offset=0",
        json=[
            {"id": "1@g.us", "name": "A", "description": "da", "owner": "9725@c.us"},
            {"id": "2@g.us", "name": "B"},
        ],
    )
    httpx_mock.add_response(
        url=f"{SESSION}/groups?limit=2&offset=2",
        json={"data": [{"groupId": "3@g.us", "subject": "C"}]},
    )
    assert await gateway.list_groups() == [
        GroupInfo(jid="1@g.us", name="A", topic="da", owner_jid="9725@s.whatsapp.net"),
        GroupInfo(jid="2@g.us", name="B"),
        GroupInfo(jid="3@g.us", name="C"),
    ]


async def test_list_groups_stops_when_server_ignores_offset(gateway, httpx_mock):
    page = [{"id": "1@g.us"}, {"id": "2@g.us"}]
    httpx_mock.add_response(url=f"{SESSION}/groups?limit=2&offset=0", json=page)
    httpx_mock.add_response(url=f"{SESSION}/groups?limit=2&offset=2", json=page)
    assert [g.jid for g in await gateway.list_groups()] == ["1@g.us", "2@g.us"]


EVENTS = ["message.received", "message.reaction"]


async def test_ensure_webhook_creates_when_missing(gateway, httpx_mock):
    httpx_mock.add_response(method="GET", url=f"{SESSION}/webhooks", json=[])
    httpx_mock.add_response(
        method="POST",
        url=f"{SESSION}/webhooks",
        match_json={"url": "http://web/webhook", "events": EVENTS, "secret": "x" * 16},
        json={"id": "w1"},
        status_code=201,
    )
    assert await gateway.ensure_webhook("http://web/webhook", "x" * 16, EVENTS) is True


async def test_ensure_webhook_noop_when_url_already_registered(gateway, httpx_mock):
    httpx_mock.add_response(
        method="GET",
        url=f"{SESSION}/webhooks",
        json={"data": [{"id": "w1", "url": "http://web/webhook"}]},
    )
    assert await gateway.ensure_webhook("http://web/webhook", "x" * 16, EVENTS) is False


async def test_non_json_success_response_is_gateway_error(gateway, httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url=f"{SESSION}/messages/send-text",
        content=b"<html>" + b"x" * 5000 + b"</html>",
        status_code=200,
    )
    with pytest.raises(GatewayError, match="non-JSON") as exc:
        await gateway.send_text("120363@g.us", "yo")
    assert len(str(exc.value)) < 500
