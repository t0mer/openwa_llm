from types import SimpleNamespace
from unittest.mock import AsyncMock

import summarize_and_send_to_groups as mod

LID = "227912345678901@lid"
OPTED = "111222333444@lid"
BOT = SimpleNamespace(normalized=lambda: ["bot@s.whatsapp.net"])


class FakeSession:
    def __init__(self, messages):
        self._messages = messages

    async def exec(self, stmt):
        return SimpleNamespace(all=lambda: self._messages)

    def add(self, obj):
        pass

    async def commit(self):
        pass


async def test_summary_sends_mentions_to_group_and_community(monkeypatch):
    messages = [SimpleNamespace(sender_jid=LID if i % 2 else OPTED) for i in range(16)]
    output = f"Summary: @227912345678901 vs 111 222 and @111222333444 @999999999"
    monkeypatch.setattr(mod, "get_bot_identity", AsyncMock(return_value=BOT))
    monkeypatch.setattr(mod, "messages_to_summarize_stmt", lambda *a: None)
    monkeypatch.setattr(
        mod, "summarize", AsyncMock(return_value=SimpleNamespace(output=output))
    )
    monkeypatch.setattr(
        mod, "get_opt_out_map", AsyncMock(return_value={"111222333444": "Dan"})
    )
    community = SimpleNamespace(group_jid="community@g.us")
    group = SimpleNamespace(
        group_jid="main@g.us",
        group_name="G",
        last_summary_sync=None,
        get_related_community_groups=AsyncMock(return_value=[community]),
    )
    whatsapp = SimpleNamespace(send_text=AsyncMock(return_value="id"))

    await mod.summarize_and_send_to_group(
        SimpleNamespace(), FakeSession(messages), whatsapp, group
    )

    assert whatsapp.send_text.await_args_list[0].args == ("main@g.us", output)
    for call in whatsapp.send_text.await_args_list:
        assert call.kwargs == {"mentions": [LID]}
    assert [c.args[0] for c in whatsapp.send_text.await_args_list] == [
        "main@g.us",
        "community@g.us",
    ]
