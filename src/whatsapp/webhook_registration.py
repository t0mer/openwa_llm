from __future__ import annotations

import asyncio
import logging

from .openwa import OpenWAGateway

logger = logging.getLogger(__name__)

# 5s doubling to a 30s cap; sums to roughly five minutes.
DEFAULT_DELAYS: tuple[float, ...] = (5, 10, 20, 30) + (30,) * 8


async def register_webhook_with_retry(
    gateway: OpenWAGateway,
    url: str,
    secret: str,
    events: list[str],
    *,
    delays: tuple[float, ...] = DEFAULT_DELAYS,
) -> bool:
    """Best-effort webhook registration that tolerates OpenWA starting late.

    Tries once, then once more after each delay. Never raises (except for task
    cancellation) and never logs the secret. Returns True once registered.
    """
    if not url:
        return False
    attempts = len(delays) + 1
    for attempt in range(attempts):
        try:
            created = await gateway.ensure_webhook(url, secret, events)
        except Exception as e:
            if attempt == attempts - 1:
                logger.warning(
                    "Giving up registering OpenWA webhook after %d attempts: %s",
                    attempts,
                    e,
                )
                return False
            logger.info(
                "OpenWA webhook registration attempt %d failed (%s); retrying in %ss",
                attempt + 1,
                e,
                delays[attempt],
            )
            await asyncio.sleep(delays[attempt])
        else:
            logger.info("OpenWA webhook %s", "registered" if created else "present")
            return True
    return False
