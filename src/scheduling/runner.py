"""One scheduler tick: find due schedules, claim them atomically, run them."""

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import update
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from config import Settings
from models import Group, GroupSummarySchedule
from summarize_and_send_to_groups import GroupSummaryResult, summarize_and_send_to_group
from whatsapp import WhatsAppGateway

from .due import latest_due
from .locks import group_lock

logger = logging.getLogger(__name__)

GRACE = timedelta(minutes=60)
SCHEDULED_RUN_TIMEOUT: float = 20 * 60  # seconds; read at call time (tests patch it)
UNEXPECTED_ERROR = "unexpected_error"
TIMEOUT = "timeout"
GROUP_NOT_MANAGED = "group_not_managed"

SessionFactory = Callable[[], AsyncSession]


@dataclass(frozen=True)
class RunRecord:
    """Outcome of one claimed schedule run."""

    schedule_id: str
    group_jid: str
    status: str
    reason: str | None = None
    message_count: int | None = None


async def claim(
    session: AsyncSession, schedule_id: str, due: datetime, now: datetime
) -> bool:
    """Atomically mark a schedule as run for `due`; True only for the one claimant."""
    result = await session.exec(  # pyright: ignore[reportCallIssue]
        update(GroupSummarySchedule)
        .where(
            col(GroupSummarySchedule.id) == schedule_id,
            col(GroupSummarySchedule.enabled).is_(True),
            (col(GroupSummarySchedule.last_run_at).is_(None))
            | (col(GroupSummarySchedule.last_run_at) < due),
        )
        .values(last_run_at=now)
        .returning(col(GroupSummarySchedule.id))
    )
    claimed = result.first() is not None
    await session.commit()
    return claimed


async def _record(
    session_factory: SessionFactory, schedule_id: str, rec: RunRecord
) -> None:
    async with session_factory() as session:
        await session.exec(  # pyright: ignore[reportCallIssue]
            update(GroupSummarySchedule)
            .where(col(GroupSummarySchedule.id) == schedule_id)
            .values(
                last_status=rec.status,
                last_reason=rec.reason,
                last_message_count=rec.message_count,
            )
        )
        await session.commit()


async def _run_claimed(
    settings: Settings,
    session_factory: SessionFactory,
    whatsapp: WhatsAppGateway,
    schedule_id: str,
    group_jid: str,
) -> RunRecord:
    try:
        async with asyncio.timeout(SCHEDULED_RUN_TIMEOUT):
            async with group_lock(group_jid):
                async with session_factory() as session:
                    group = await session.get(Group, group_jid)
                    if group is None or not group.managed:
                        result = GroupSummaryResult(
                            status="skipped", reason=GROUP_NOT_MANAGED
                        )
                    else:
                        result = await summarize_and_send_to_group(
                            settings, session, whatsapp, group
                        )
        rec = RunRecord(
            schedule_id,
            group_jid,
            result.status,
            result.reason,
            result.message_count,
        )
    except asyncio.CancelledError:
        raise
    except TimeoutError:
        logger.warning("Scheduled summary timed out for group %s", group_jid)
        rec = RunRecord(schedule_id, group_jid, "failed", TIMEOUT)
    except Exception:
        logger.exception("Scheduled summary failed for group %s", group_jid)
        rec = RunRecord(schedule_id, group_jid, "failed", UNEXPECTED_ERROR)
    try:
        await _record(session_factory, schedule_id, rec)
    except Exception:
        logger.exception("Could not record schedule result %s", schedule_id)
    return rec


async def run_due(
    settings: Settings,
    session_factory: SessionFactory,
    whatsapp: WhatsAppGateway,
    now: datetime | None = None,
) -> list[RunRecord]:
    """Run one tick; returns a record for each schedule this call claimed."""
    now = now or datetime.now(timezone.utc)
    tz = ZoneInfo(settings.timezone)
    now_local = now.astimezone(tz)

    async with session_factory() as session:
        rows = (
            await session.exec(
                select(GroupSummarySchedule)
                .join(Group, col(Group.group_jid) == GroupSummarySchedule.group_jid)
                .where(
                    col(GroupSummarySchedule.enabled).is_(True),
                    col(Group.managed).is_(True),
                )
                .order_by(col(GroupSummarySchedule.created_at))
            )
        ).all()
        candidates: list[tuple[str, str, datetime]] = []
        for s in rows:
            due = latest_due(now_local, s.weekdays, s.hour, s.minute, tz, GRACE)
            if due is not None and (s.last_run_at is None or s.last_run_at < due):
                candidates.append((s.id, s.group_jid, due))

    records: list[RunRecord] = []
    for schedule_id, group_jid, due in candidates:
        try:
            async with session_factory() as session:
                if not await claim(session, schedule_id, due, now):
                    continue
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Could not claim schedule %s", schedule_id)
            continue
        records.append(
            await _run_claimed(
                settings, session_factory, whatsapp, schedule_id, group_jid
            )
        )
    return records


async def scheduler_loop(app: Any, interval: float = 60) -> None:
    """Tick forever; a failing tick is logged and never ends the loop."""
    while True:
        try:
            await run_due(
                app.state.settings, app.state.async_session, app.state.whatsapp
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Scheduler tick failed")
        await asyncio.sleep(interval)


def start_scheduler(app: Any, interval: float = 60) -> "asyncio.Task[None] | None":
    """Start the loop unless `SCHEDULER_ENABLED=false`; returns the task."""
    if not app.state.settings.scheduler_enabled:
        logger.info("Summary scheduler disabled (SCHEDULER_ENABLED=false)")
        return None
    return asyncio.create_task(scheduler_loop(app, interval))
