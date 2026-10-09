import asyncio
import logging
from collections.abc import Collection
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Literal

from pydantic_ai import Agent
from pydantic_ai.agent import AgentRunResult
from sqlmodel import col, desc, select
from sqlmodel.ext.asyncio.session import AsyncSession
from tenacity import (
    retry,
    wait_random_exponential,
    stop_after_attempt,
    before_sleep_log,
)

from config import Settings
from models import Group, Message
from services.prompt_manager import prompt_manager
from utils.chat_text import chat2text
from utils.mentions import extract_mentions
from utils.opt_out import get_opt_out_map
from whatsapp import WhatsAppGateway
from whatsapp.identity import get_bot_identity

logger = logging.getLogger(__name__)

MIN_MESSAGES_TO_SUMMARIZE = 15


@dataclass(frozen=True)
class GroupSummaryResult:
    """Outcome of summarizing one group. Identity fields are filled by the caller."""

    status: Literal["sent", "skipped", "failed"]
    reason: str | None = None
    message_count: int | None = None
    required: int = MIN_MESSAGES_TO_SUMMARIZE
    group_jid: str = ""
    group_name: str = ""


@retry(
    wait=wait_random_exponential(min=1, max=30),
    stop=stop_after_attempt(6),
    before_sleep=before_sleep_log(logger, logging.DEBUG),
    reraise=True,
)
async def summarize(
    session: AsyncSession, settings: Settings, group_name: str, messages: list[Message]
) -> AgentRunResult[str]:
    agent = Agent(
        model=settings.model_name,
        # TODO: move to jinja?
        system_prompt=prompt_manager.render("quick_summary.j2", group_name=group_name),
        output_type=str,
    )

    # Get opt-out map for all senders in the history
    all_jids = {m.sender_jid for m in messages}
    opt_out_map = await get_opt_out_map(session, list(all_jids))

    return await agent.run(chat2text(messages, opt_out_map))


def messages_to_summarize_stmt(group: Group, bot_jids: Collection[str]):
    """Group messages since the last summary, excluding the bot's own."""
    return (
        select(Message)
        .where(Message.group_jid == group.group_jid)
        .where(Message.timestamp >= group.last_summary_sync)
        .where(col(Message.sender_jid).not_in(sorted(bot_jids)))
        .order_by(desc(Message.timestamp))
    )


async def summarize_and_send_to_group(
    settings: Settings, session, whatsapp: WhatsAppGateway, group: Group
) -> GroupSummaryResult:
    bot = await get_bot_identity(whatsapp)
    resp = await session.exec(messages_to_summarize_stmt(group, bot.normalized()))
    messages: list[Message] = resp.all()
    count = len(messages)

    if count < MIN_MESSAGES_TO_SUMMARIZE:
        logging.info("Not enough messages to summarize in group %s", group.group_name)
        return GroupSummaryResult(
            status="skipped", reason="not_enough_messages", message_count=count
        )

    try:
        result = await summarize(
            session, settings, group.group_name or "group", messages
        )
    except Exception as e:
        logging.error("Error summarizing group %s: %s", group.group_name, e)
        return GroupSummaryResult(
            status="failed", reason="summarize_error", message_count=count
        )

    outcome = GroupSummaryResult(status="sent", message_count=count)
    # Mentions are best-effort: never let them block sending the text.
    mentions: list[str] = []
    try:
        sender_jids = {m.sender_jid for m in messages}
        opt_out_map = await get_opt_out_map(session, list(sender_jids))
        mentions = extract_mentions(result.output, sender_jids, opt_out_map)
    except Exception as e:
        logging.warning(
            "Could not compute mentions for group %s: %s", group.group_name, e
        )

    try:
        await whatsapp.send_text(group.group_jid, result.output, mentions=mentions)

        # Send the summary to the community groups
        community_groups = await group.get_related_community_groups(session)
        for cg in community_groups:
            await whatsapp.send_text(cg.group_jid, result.output, mentions=mentions)

    except Exception as e:
        logging.error("Error sending message to group %s: %s", group.group_name, e)
        outcome = GroupSummaryResult(
            status="failed", reason="send_error", message_count=count
        )

    finally:
        # Update the group with the new last_summary_sync
        group.last_summary_sync = datetime.now()
        session.add(group)
        await session.commit()

    return outcome


async def summarize_and_send_to_groups(
    settings: Settings, session: AsyncSession, whatsapp: WhatsAppGateway
) -> list[GroupSummaryResult]:
    groups = list(
        (await session.exec(select(Group).where(Group.managed == True))).all()  # noqa: E712 https://stackoverflow.com/a/18998106
    )
    tasks = [
        summarize_and_send_to_group(settings, session, whatsapp, group)
        for group in groups
    ]
    outcomes = await asyncio.gather(*tasks, return_exceptions=True)
    results: list[GroupSummaryResult] = []
    for group, outcome in zip(groups, outcomes):
        if isinstance(outcome, BaseException):
            logging.error("Error syncing group: %s", outcome)
            outcome = GroupSummaryResult(status="failed", reason="unexpected_error")
        results.append(
            replace(
                outcome,
                group_jid=group.group_jid,
                group_name=group.display_name or group.group_name or "",
            )
        )
    return results
