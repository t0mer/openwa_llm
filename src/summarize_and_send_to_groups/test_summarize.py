# pyright: reportArgumentType=false
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from datetime import datetime

import summarize_and_send_to_groups as mod
from summarize_and_send_to_groups import summarize as real_summarize
from summarize_and_send_to_groups import (
    MIN_MESSAGES_TO_SUMMARIZE,
    GroupSummaryResult,
    summarize_and_send_to_group,
    summarize_and_send_to_groups,
)


def _group(jid="g1@g.us", name="Name", display=None, language=None):
    return SimpleNamespace(
        group_jid=jid,
        group_name=name,
        display_name=display,
        summary_language=language,
        last_summary_sync=datetime(2026, 1, 1),
        get_related_community_groups=AsyncMock(return_value=[]),
    )


def _session(messages):
    session = MagicMock()
    resp = MagicMock()
    resp.all.return_value = messages
    session.exec = AsyncMock(return_value=resp)
    session.add = MagicMock()
    session.commit = AsyncMock()
    return session


@pytest.fixture(autouse=True)
def _patch(monkeypatch):
    bot = MagicMock()
    bot.normalized.return_value = set()
    monkeypatch.setattr(mod, "get_bot_identity", AsyncMock(return_value=bot))
    monkeypatch.setattr(
        mod, "summarize", AsyncMock(return_value=SimpleNamespace(output="sum"))
    )


async def test_sent():
    wa = MagicMock(send_text=AsyncMock())
    res = await summarize_and_send_to_group(object(), _session([1] * 20), wa, _group())
    assert res == GroupSummaryResult(
        status="sent", message_count=20, required=MIN_MESSAGES_TO_SUMMARIZE
    )
    wa.send_text.assert_awaited_once_with("g1@g.us", "sum", mentions=[])


async def test_skipped_not_enough_messages():
    wa = MagicMock(send_text=AsyncMock())
    res = await summarize_and_send_to_group(object(), _session([1] * 3), wa, _group())
    assert (res.status, res.reason, res.message_count, res.required) == (
        "skipped",
        "not_enough_messages",
        3,
        15,
    )
    wa.send_text.assert_not_awaited()


async def test_failed_when_summarize_raises(monkeypatch):
    monkeypatch.setattr(mod, "summarize", AsyncMock(side_effect=RuntimeError("llm")))
    wa = MagicMock(send_text=AsyncMock())
    res = await summarize_and_send_to_group(object(), _session([1] * 20), wa, _group())
    assert res.status == "failed" and res.reason == "summarize_error"
    wa.send_text.assert_not_awaited()


async def test_failed_when_send_raises():
    wa = MagicMock(send_text=AsyncMock(side_effect=RuntimeError("wa")))
    session = _session([1] * 20)
    res = await summarize_and_send_to_group(object(), session, wa, _group())
    assert res.status == "failed" and res.reason == "send_error"
    session.commit.assert_awaited()  # sync marker still updated, as before


async def test_groups_returns_results_and_isolates_failures(monkeypatch):
    g1, g2 = _group("a@g.us", "A", display="Shown"), _group("b@g.us", "B")
    session = MagicMock()
    resp = MagicMock()
    resp.all.return_value = [g1, g2]
    session.exec = AsyncMock(return_value=resp)

    async def fake(settings, session, whatsapp, group):
        if group is g2:
            raise RuntimeError("boom")
        return GroupSummaryResult(status="sent", message_count=20, required=15)

    monkeypatch.setattr(mod, "summarize_and_send_to_group", fake)
    results = await summarize_and_send_to_groups(object(), session, object())
    assert [(r.group_jid, r.group_name, r.status) for r in results] == [
        ("a@g.us", "Shown", "sent"),
        ("b@g.us", "B", "failed"),
    ]
    assert results[1].reason == "unexpected_error"


async def test_groups_none_managed():
    session = MagicMock()
    resp = MagicMock()
    resp.all.return_value = []
    session.exec = AsyncMock(return_value=resp)
    assert await summarize_and_send_to_groups(object(), session, object()) == []


@pytest.mark.parametrize("language", [None, "he", "en", "ru"])
async def test_summarize_receives_group_language(monkeypatch, language):
    summarize_mock = AsyncMock(return_value=SimpleNamespace(output="sum"))
    monkeypatch.setattr(mod, "summarize", summarize_mock)
    wa = MagicMock(send_text=AsyncMock())
    await summarize_and_send_to_group(
        object(), _session([1] * 20), wa, _group(language=language)
    )
    assert summarize_mock.await_args is not None
    assert summarize_mock.await_args.kwargs["summary_language"] == language


async def test_summarize_renders_prompt_with_language(monkeypatch):
    agent_cls = MagicMock()
    agent_cls.return_value.run = AsyncMock(return_value=SimpleNamespace(output="x"))
    monkeypatch.setattr(mod, "Agent", agent_cls)
    monkeypatch.setattr(mod, "get_opt_out_map", AsyncMock(return_value={}))
    monkeypatch.setattr(mod, "chat2text", MagicMock(return_value="chat"))
    settings = SimpleNamespace(model_name="test")

    await real_summarize(object(), settings, "G", [], summary_language="ru")
    assert (
        "Write the entire summary in Russian"
        in (agent_cls.call_args.kwargs["system_prompt"])
    )
    await real_summarize(object(), settings, "G", [])
    assert (
        "Write in the same language as the chat group"
        in (agent_cls.call_args.kwargs["system_prompt"])
    )
