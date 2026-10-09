from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from handler.router import Router
from models import Message

ASKER = "227912345678901@lid"
OTHER = "972501234567@s.whatsapp.net"
QUIET = "972509999999@s.whatsapp.net"


def _msg(jid, mid):
    return Message(
        message_id=mid,
        text="hello",
        chat_jid="chat@g.us",
        sender_jid=jid,
        timestamp=datetime.now(timezone.utc),
    )


async def _run(output, opt_out):
    session = AsyncMock()
    session.exec.return_value = SimpleNamespace(
        all=lambda: [_msg(OTHER, "a"), _msg(QUIET, "b")]
    )
    router = Router(session, AsyncMock(), AsyncMock(), Mock())
    router.send_message = AsyncMock()
    agent = SimpleNamespace(run=AsyncMock(return_value=SimpleNamespace(output=output)))
    with (
        patch("handler.router.Agent", Mock(return_value=agent)),
        patch("handler.router.get_opt_out_map", AsyncMock(return_value=opt_out)),
    ):
        await router.summarize(_msg(ASKER, "q"))
    return router.send_message


def _kwargs(send):
    assert send.await_args is not None
    return send.await_args.kwargs


async def test_summary_passes_mentions_of_non_opted_out_senders():
    send = await _run(
        "@972501234567 @972509999999 @227912345678901 @123456789012",
        {"972509999999": "Quiet"},
    )
    assert _kwargs(send)["mentions"] == [OTHER, ASKER]


async def test_summary_mentions_failure_sends_without_mentions():
    with patch("handler.router.safe_extract_mentions", return_value=[]):
        send = await _run("@972501234567", {})
    assert _kwargs(send)["mentions"] == []
