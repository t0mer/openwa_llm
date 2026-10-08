from unittest.mock import AsyncMock

from whatsapp.gateway import GatewayError
from whatsapp.webhook_registration import register_webhook_with_retry

EVENTS = ["message.received"]
FAST = (0.0, 0.0, 0.0)


async def test_succeeds_after_failures():
    gw = AsyncMock()
    gw.ensure_webhook.side_effect = [GatewayError("down"), GatewayError("down"), True]
    assert await register_webhook_with_retry(gw, "http://w", "s", EVENTS, delays=FAST)
    assert gw.ensure_webhook.await_count == 3


async def test_gives_up_without_raising_and_without_logging_secret(caplog):
    gw = AsyncMock()
    gw.ensure_webhook.side_effect = GatewayError("down")
    caplog.set_level("DEBUG")
    ok = await register_webhook_with_retry(
        gw, "http://w", "topsecretvalue", EVENTS, delays=FAST
    )
    assert ok is False
    assert gw.ensure_webhook.await_count == len(FAST) + 1
    assert "topsecretvalue" not in caplog.text


async def test_skips_when_url_empty():
    gw = AsyncMock()
    assert await register_webhook_with_retry(gw, "", "s", EVENTS, delays=FAST) is False
    gw.ensure_webhook.assert_not_awaited()
