from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from handler.router import Router


async def test_about_links_this_repo_and_credits_the_original():
    router = Router(AsyncMock(), AsyncMock(), AsyncMock(), Mock())
    router.send_message = AsyncMock()

    await router.about(SimpleNamespace(chat_jid="chat@g.us"))

    text = router.send_message.await_args.args[1]
    assert "https://github.com/t0mer/openwa_llm" in text
    assert "originally based on https://github.com/ilanbenb/wa_llm" in text.lower()
    # the original repo is credited as the origin, not offered for PRs/stars
    assert text.index("t0mer/openwa_llm") < text.index("ilanbenb/wa_llm")
