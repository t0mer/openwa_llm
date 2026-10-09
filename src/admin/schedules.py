from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from api.deps import get_db_async_session
from config import Settings, get_settings
from models import Group, GroupSummarySchedule
from whatsapp.jid import normalize_jid

from .schemas import (
    MAX_SCHEDULES_PER_GROUP,
    ScheduleCreate,
    ScheduleList,
    ScheduleOut,
    SchedulePatch,
)

router = APIRouter(tags=["admin-schedules"])


async def _lock_group(session: AsyncSession, group_jid: str) -> str:
    """Resolve the group (404 if unknown) and lock its row.

    FOR NO KEY UPDATE (key_share) so message inserts, which take FOR KEY
    SHARE on the group row via their foreign key, are not blocked. The row
    lock serialises concurrent creates for one group so the
    per-group limit cannot be overshot by racing requests.
    """
    jid = normalize_jid(group_jid)
    found = await session.execute(
        select(Group.group_jid)
        .where(Group.group_jid == jid)
        .with_for_update(key_share=True)
    )
    if found.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="group not found")
    return jid


async def _get_schedule(
    session: AsyncSession, jid: str, schedule_id: str
) -> GroupSummarySchedule | None:
    schedule = await session.get(GroupSummarySchedule, schedule_id)
    if schedule is None or schedule.group_jid != jid:
        return None
    return schedule


@router.get("/{group_jid}/schedules", response_model=ScheduleList)
async def list_schedules(
    group_jid: str,
    session: Annotated[AsyncSession, Depends(get_db_async_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> ScheduleList:
    jid = normalize_jid(group_jid)
    if await session.get(Group, jid) is None:
        raise HTTPException(status_code=404, detail="group not found")
    rows = await session.execute(
        select(GroupSummarySchedule)
        .where(GroupSummarySchedule.group_jid == jid)
        .order_by(
            col(GroupSummarySchedule.hour),
            col(GroupSummarySchedule.minute),
            col(GroupSummarySchedule.created_at),
            col(GroupSummarySchedule.id),
        )
    )
    return ScheduleList(
        timezone=settings.timezone,
        items=[ScheduleOut.from_schedule(s) for s in rows.scalars().all()],
    )


@router.post("/{group_jid}/schedules", response_model=ScheduleOut, status_code=201)
async def create_schedule(
    group_jid: str,
    body: ScheduleCreate,
    session: Annotated[AsyncSession, Depends(get_db_async_session)],
) -> ScheduleOut:
    jid = await _lock_group(session, group_jid)
    count = (
        await session.execute(
            select(func.count())
            .select_from(GroupSummarySchedule)
            .where(GroupSummarySchedule.group_jid == jid)
        )
    ).scalar_one()
    if int(count) >= MAX_SCHEDULES_PER_GROUP:
        raise HTTPException(
            status_code=409,
            detail=f"at most {MAX_SCHEDULES_PER_GROUP} schedules per group",
        )
    hour = body.resolved_hour()
    assert hour is not None and body.minute is not None  # enforced by ScheduleCreate
    schedule = GroupSummarySchedule(
        group_jid=jid,
        weekdays=list(body.weekdays),
        hour=hour,
        minute=body.minute,
        enabled=body.enabled,
    )
    session.add(schedule)
    await session.flush()
    return ScheduleOut.from_schedule(schedule)


@router.patch("/{group_jid}/schedules/{schedule_id}", response_model=ScheduleOut)
async def patch_schedule(
    group_jid: str,
    schedule_id: str,
    patch: SchedulePatch,
    session: Annotated[AsyncSession, Depends(get_db_async_session)],
) -> ScheduleOut:
    jid = await _lock_group(session, group_jid)
    schedule = await _get_schedule(session, jid, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=404, detail="schedule not found")
    sent = patch.model_fields_set
    if "weekdays" in sent and patch.weekdays is not None:
        schedule.weekdays = list(patch.weekdays)
    hour = patch.resolve_hour(schedule.hour)
    if hour is not None:
        schedule.hour = hour
    if "minute" in sent and patch.minute is not None:
        schedule.minute = patch.minute
    if "enabled" in sent and patch.enabled is not None:
        schedule.enabled = patch.enabled
    session.add(schedule)
    await session.flush()
    return ScheduleOut.from_schedule(schedule)


@router.delete("/{group_jid}/schedules/{schedule_id}", status_code=204)
async def delete_schedule(
    group_jid: str,
    schedule_id: str,
    session: Annotated[AsyncSession, Depends(get_db_async_session)],
) -> Response:
    jid = await _lock_group(session, group_jid)
    schedule = await _get_schedule(session, jid, schedule_id)
    if schedule is not None:
        await session.delete(schedule)
        await session.flush()
    return Response(status_code=204)
