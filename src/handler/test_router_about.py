from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from handler.router import Router


async def test_about_links_this_repo_and_credits_the_original():
    router = Router(AsyncMock(), AsyncMock(), AsyncMock(), Mock())
    router.send_message = AsyncMock()

    await router.about(SimpleNamespace(chat_jid="chat@g.us", text="about"))

    assert router.send_message.await_args is not None
    text = router.send_message.await_args.args[1]
    assert "https://github.com/t0mer/openwa_llm" in text
    assert "originally based on https://github.com/ilanbenb/wa_llm" in text.lower()
    # the original repo is credited as the origin, not offered for PRs/stars
    assert text.index("t0mer/openwa_llm") < text.index("ilanbenb/wa_llm")


async def _about_text(question):
    router = Router(AsyncMock(), AsyncMock(), AsyncMock(), Mock())
    router.send_message = AsyncMock()
    await router.about(SimpleNamespace(chat_jid="chat@g.us", text=question))
    assert router.send_message.await_args is not None
    return router.send_message.await_args.args[1]


async def test_about_in_english_for_english_request():
    text = await _about_text("who are you?")
    assert text.startswith("I'm an open-source bot")
    assert "https://llm.org.il" in text
    assert "https://github.com/t0mer/openwa_llm" in text
    assert "Originally based on https://github.com/ilanbenb/wa_llm" in text


async def test_about_in_hebrew_for_hebrew_request():
    text = await _about_text("מי אתה?")
    assert "בקוד פתוח" in text
    assert "I'm an open-source" not in text
    assert "https://llm.org.il" in text
    assert "https://github.com/t0mer/openwa_llm" in text
    assert "https://github.com/ilanbenb/wa_llm" in text
    assert text.index("t0mer/openwa_llm") < text.index("ilanbenb/wa_llm")
