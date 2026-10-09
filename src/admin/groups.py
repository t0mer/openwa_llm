from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from api.deps import get_db_async_session
from models import Group, Message
from whatsapp.jid import normalize_jid

from .schemas import MAX_OFFSET, GroupOut, GroupPatch, Page, clean_keys, clean_text

router = APIRouter(tags=["admin-groups"])

SortKey = Literal[
    "name",
    "-name",
    "last_summary_sync",
    "-last_summary_sync",
    "message_count",
    "-message_count",
    "created_at",
    "-created_at",
]


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def group_filters(search: str | None, managed: bool | None) -> list:
    conditions: list = []
    term = (search or "").strip()
    if term:
        pattern = f"%{_escape_like(term)}%"
        conditions.append(
            or_(
                col(Group.group_name).ilike(pattern, escape="\\"),
                col(Group.display_name).ilike(pattern, escape="\\"),
                col(Group.group_topic).ilike(pattern, escape="\\"),
                col(Group.group_jid).ilike(pattern, escape="\\"),
            )
        )
    if managed is not None:
        conditions.append(col(Group.managed) == managed)
    return conditions


def _order_by(sort: str, message_count):
    descending = sort.startswith("-")
    key = sort.lstrip("-")
    expressions = {
        "name": func.lower(
            func.coalesce(Group.display_name, Group.group_name, Group.group_jid)
        ),
        "last_summary_sync": col(Group.last_summary_sync),
        "message_count": message_count,
        "created_at": col(Group.created_at),
    }
    expr = expressions[key]
    return (expr.desc() if descending else expr.asc(), col(Group.group_jid).asc())


async def _message_count(session: AsyncSession, group_jid: str) -> int:
    result = await session.execute(
        select(func.count()).select_from(Message).where(Message.group_jid == group_jid)
    )
    return int(result.scalar_one())


@router.get("", response_model=Page[GroupOut])
async def list_groups(
    session: Annotated[AsyncSession, Depends(get_db_async_session)],
    search: Annotated[str | None, Query(max_length=100)] = None,
    managed: bool | None = None,
    sort: SortKey = "name",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=MAX_OFFSET)] = 0,
) -> Page[GroupOut]:
    counts = (
        select(col(Message.group_jid).label("group_jid"), func.count().label("n"))
        .where(col(Message.group_jid).is_not(None))
        .group_by(col(Message.group_jid))
        .subquery()
    )
    message_count = func.coalesce(counts.c.n, 0)
    rows_stmt = (
        select(Group, message_count.label("message_count"))
        .outerjoin(counts, counts.c.group_jid == Group.group_jid)
        .where(*group_filters(search, managed))
        .order_by(*_order_by(sort, message_count))
        .limit(limit)
        .offset(offset)
    )
    rows = (await session.execute(rows_stmt)).all()
    total_stmt = (
        select(func.count()).select_from(Group).where(*group_filters(search, managed))
    )
    total = (await session.execute(total_stmt)).scalar_one()
    return Page(
        items=[GroupOut.from_group(group, count) for group, count in rows],
        total=int(total),
    )


@router.get("/{group_jid}", response_model=GroupOut)
async def get_group(
    group_jid: str,
    session: Annotated[AsyncSession, Depends(get_db_async_session)],
) -> GroupOut:
    jid = normalize_jid(group_jid)
    group = await session.get(Group, jid)
    if group is None:
        raise HTTPException(status_code=404, detail="group not found")
    return GroupOut.from_group(group, await _message_count(session, jid))


@router.patch("/{group_jid}", response_model=GroupOut)
async def patch_group(
    group_jid: str,
    patch: GroupPatch,
    session: Annotated[AsyncSession, Depends(get_db_async_session)],
) -> GroupOut:
    jid = normalize_jid(group_jid)
    group = await session.get(Group, jid)
    if group is None:
        raise HTTPException(status_code=404, detail="group not found")
    sent = patch.model_fields_set
    if "managed" in sent:
        group.managed = bool(patch.managed)
    if "notify_on_spam" in sent:
        group.notify_on_spam = bool(patch.notify_on_spam)
    if "community_keys" in sent:
        group.community_keys = clean_keys(patch.community_keys)
    if "display_name" in sent:
        group.display_name = clean_text(patch.display_name)
    if "summary_language" in sent:
        group.summary_language = patch.summary_language
    session.add(group)
    await session.flush()
    return GroupOut.from_group(group, await _message_count(session, jid))
