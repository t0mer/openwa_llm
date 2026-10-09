from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from handler.base_handler import BaseHandler
from handler.knowledge_base_answers import KnowledgeBaseAnswers
from models import Message

ASKER = "227912345678901@lid"


def _message(text="q"):
    return Message(
        message_id="m1",
        text=text,
        chat_jid="chat@g.us",
        sender_jid=ASKER,
        timestamp=Mock(),
    )


async def test_send_message_passes_mentions_only_when_present():
    whatsapp = AsyncMock()
    whatsapp.send_text = AsyncMock(return_value="out")
    whatsapp.get_my_jid = AsyncMock(return_value="bot@s.whatsapp.net")
    handler = BaseHandler(Mock(), whatsapp, Mock())
    handler.store_message = AsyncMock(return_value=Mock())

    await handler.send_message("chat@g.us", "hi")
    whatsapp.send_text.assert_awaited_with("chat@g.us", "hi", None)

    await handler.send_message("chat@g.us", "hi @1", mentions=[ASKER])
    whatsapp.send_text.assert_awaited_with("chat@g.us", "hi @1", None, mentions=[ASKER])


async def _run_kb(output: str, opt_out: dict[str, str]):
    session = AsyncMock()
    session.exec.return_value = SimpleNamespace(all=lambda: [])
    kb = KnowledgeBaseAnswers(session, AsyncMock(), AsyncMock(), Mock())
    kb.send_message = AsyncMock()
    kb.rephrasing_agent = AsyncMock(return_value=SimpleNamespace(output="r"))
    kb.generation_agent = AsyncMock(return_value=SimpleNamespace(output=output))
    msg = _message()
    msg.group = None
    with (
        patch(
            "handler.knowledge_base_answers.get_opt_out_map",
            AsyncMock(return_value=opt_out),
        ),
        patch(
            "handler.knowledge_base_answers.get_bot_identity",
            AsyncMock(
                return_value=SimpleNamespace(phone=SimpleNamespace(user="b"), lid=None)
            ),
        ),
        patch(
            "handler.knowledge_base_answers.voyage_embed_text",
            AsyncMock(return_value=[[0.0]]),
        ),
        patch("search.hybrid_search.hybrid_search", AsyncMock(return_value=[])),
        patch(
            "search.hybrid_search.format_search_results_for_prompt",
            Mock(return_value=""),
        ),
    ):
        await kb(msg)
    return kb.send_message


async def test_kb_reply_mentions_asker_when_tagged():
    send = await _run_kb("Hey @227912345678901, here you go", {})
    assert send.await_args.kwargs["mentions"] == [ASKER]


async def test_kb_reply_no_mention_when_not_tagged_or_opted_out():
    send = await _run_kb("no tags", {})
    assert send.await_args.kwargs["mentions"] == []
    send = await _run_kb("Hey @227912345678901", {"227912345678901": "Dan"})
    assert send.await_args.kwargs["mentions"] == []
