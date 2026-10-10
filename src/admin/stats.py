from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Integer, and_, cast, func, literal
from sqlalchemy import select as sa_select
from sqlalchemy.dialects.postgresql import INTERVAL
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from api.deps import get_db_async_session, get_whatsapp
from config import Settings, get_settings
from models import Group, KBTopic, Message, Reaction, Sender
from whatsapp import WhatsAppGateway
from whatsapp.identity import get_bot_identity

from .messages import check_bound
from .schemas import (
    StatsBucket,
    StatsGroups,
    StatsOut,
    StatsPoint,
    StatsSplit,
    StatsTopGroup,
    StatsTopSender,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["admin-stats"])

HOUR_SPAN = timedelta(hours=48)
DAY_SPAN = timedelta(days=92)
WEEK_SPAN = timedelta(days=730)  # two years
DEFAULT_SPAN = timedelta(days=7)
TOP_GROUPS = 5
TOP_SENDERS = 10


def pick_bucket(start: datetime, end: datetime) -> StatsBucket:
    """Series bucket that keeps the slot count small for the given span."""
    span = end - start
    if span <= HOUR_SPAN:
        return "hour"
    if span <= DAY_SPAN:
        return "day"
    if span <= WEEK_SPAN:
        return "week"
    return "month"


def localize(value: datetime, zone: ZoneInfo) -> datetime:
    """Naive datetimes are wall-clock times in the configured zone."""
    return value if value.tzinfo else value.replace(tzinfo=zone)


async def _bot_ids(whatsapp: WhatsAppGateway) -> frozenset[str] | None:
    try:
        return (await get_bot_identity(whatsapp)).normalized()
    except Exception as e:  # stats must still load without a WhatsApp session
        logger.warning("Bot identity lookup failed, bot not excluded: %s", e)
        return None


async def _counts_by(session: AsyncSession, key: Any, where: list) -> dict[Any, int]:
    """Message counts grouped by a computed key (grouped via a subquery so the
    bound time-zone parameters appear only once)."""
    inner = select(key.label("k")).where(*where).subquery()
    rows = await session.execute(select(inner.c.k, func.count()).group_by(inner.c.k))
    return {k: int(n) for k, n in rows.all()}


@router.get("", response_model=StatsOut)
async def get_stats(
    session: Annotated[AsyncSession, Depends(get_db_async_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    whatsapp: Annotated[WhatsAppGateway, Depends(get_whatsapp)],
    from_: Annotated[datetime | None, Query(alias="from")] = None,
    to: datetime | None = None,
) -> StatsOut:
    tz = settings.timezone
    zone = ZoneInfo(tz)
    from_ = localize(from_, zone) if from_ else None
    to = localize(to, zone) if to else None
    check_bound(from_, "from")
    check_bound(to, "to")
    end = to or datetime.now(timezone.utc)

    bot_ids = await _bot_ids(whatsapp)
    msg_where: list = [col(Message.timestamp) <= end]
    reaction_where: list = [col(Reaction.timestamp) <= end]
    if bot_ids:
        msg_where.append(col(Message.sender_jid).not_in(bot_ids))
        reaction_where.append(col(Reaction.sender_jid).not_in(bot_ids))

    if from_ is not None:
        start = from_
    else:
        earliest = await session.scalar(
            select(func.min(Message.timestamp)).where(*msg_where)
        )
        start = earliest or end - DEFAULT_SPAN
    if start > end:
        raise HTTPException(status_code=422, detail="from must not be after to")
    msg_where.append(col(Message.timestamp) >= start)
    reaction_where.append(col(Reaction.timestamp) >= start)
    bucket = pick_bucket(start, end)

    # Separate queries without a shared snapshot: rows arriving meanwhile can
    # make the numbers drift slightly, which is fine for a dashboard.
    totals = (
        await session.execute(
            sa_select(
                func.count(),
                func.count(func.distinct(Message.chat_jid)),
                func.count(func.distinct(Message.sender_jid)),
                func.count().filter(
                    and_(
                        col(Message.text).is_not(None), col(Message.media_url).is_(None)
                    )
                ),
                func.count().filter(col(Message.media_url).is_not(None)),
            ).where(*msg_where)
        )
    ).one()
    messages, chats, senders, text, media = (int(v) for v in totals)

    # Series: zero-filled slots in the configured zone. Postgres
    # date_trunc('week') starts weeks on Monday (ISO), unlike by_weekday where
    # 0 = Sunday, and the first slot can start before `from`.
    slot = func.date_trunc(bucket, Message.timestamp, tz)
    counts = await _counts_by(session, slot, msg_where)
    step = cast(literal(f"1 {bucket}"), INTERVAL)
    if bucket == "hour":
        # Absolute hours: no gaps or duplicates around DST changes.
        slots_stmt = select(
            func.generate_series(
                func.date_trunc(bucket, literal(start), tz),
                func.date_trunc(bucket, literal(end), tz),
                step,
            )
        )
    else:
        # Step through local wall-clock dates, then map each one to an instant
        # the same way date_trunc(..., tz) does, so a DST jump at midnight
        # cannot shift later slots away from the message buckets.
        local = func.generate_series(
            func.date_trunc(bucket, func.timezone(tz, literal(start))),
            func.date_trunc(bucket, func.timezone(tz, literal(end))),
            step,
        ).column_valued("local")
        slots_stmt = select(func.timezone(tz, local))
    slots = await session.scalars(slots_stmt)
    series = [
        StatsPoint(start=s.astimezone(zone), count=counts.get(s, 0)) for s in slots
    ]

    local_ts = func.timezone(tz, Message.timestamp)
    hours = await _counts_by(
        session, cast(func.extract("hour", local_ts), Integer), msg_where
    )
    weekdays = await _counts_by(
        session, cast(func.extract("dow", local_ts), Integer), msg_where
    )

    group_count = func.count().label("n")
    top_groups = await session.execute(
        select(
            Message.group_jid,
            func.coalesce(Group.display_name, Group.group_name),
            group_count,
        )
        .outerjoin(Group, col(Group.group_jid) == col(Message.group_jid))
        .where(*msg_where, col(Message.group_jid).is_not(None))
        .group_by(
            col(Message.group_jid), col(Group.display_name), col(Group.group_name)
        )
        .order_by(group_count.desc(), col(Message.group_jid).asc())
        .limit(TOP_GROUPS)
    )
    sender_count = func.count().label("n")
    top_senders = await session.execute(
        select(Message.sender_jid, Sender.push_name, sender_count)
        .outerjoin(Sender, col(Sender.jid) == col(Message.sender_jid))
        .where(*msg_where)
        .group_by(col(Message.sender_jid), col(Sender.push_name))
        .order_by(sender_count.desc(), col(Message.sender_jid).asc())
        .limit(TOP_SENDERS)
    )

    reactions = await session.scalar(
        select(func.count()).select_from(Reaction).where(*reaction_where)
    )
    kb_topics = await session.scalar(
        select(func.count())
        .select_from(KBTopic)
        .where(col(KBTopic.start_time) >= start, col(KBTopic.start_time) <= end)
    )
    groups_total, groups_managed = (
        await session.execute(
            select(func.count(), func.count().filter(col(Group.managed)))
        )
    ).one()

    return StatsOut(
        from_=start.astimezone(zone),
        to=end.astimezone(zone),
        timezone=tz,
        bucket=bucket,
        bot_excluded=bot_ids is not None,
        groups=StatsGroups(total=int(groups_total), managed=int(groups_managed)),
        chats=chats,
        messages=messages,
        active_senders=senders,
        reactions=int(reactions or 0),
        kb_topics=int(kb_topics or 0),
        split=StatsSplit(text=text, media=media, other=messages - text - media),
        series=series,
        top_groups=[
            StatsTopGroup(group_jid=jid, name=name, count=int(n))
            for jid, name, n in top_groups.all()
        ],
        top_senders=[
            StatsTopSender(sender_jid=jid, name=name, count=int(n))
            for jid, name, n in top_senders.all()
        ],
        by_hour=[hours.get(h, 0) for h in range(24)],
        by_weekday=[weekdays.get(d, 0) for d in range(7)],
    )
