from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from api.deps import get_db_async_session
from models import OptOut, Sender
from whatsapp.jid import normalize_jid

from .groups import _escape_like
from .schemas import ContactOut, ContactPatch, Page, clean_text

router = APIRouter(tags=["admin-contacts"])


def _filters(search: str | None, opted_out: bool | None) -> list:
    conditions: list = []
    term = (search or "").strip()
    if term:
        pattern = f"%{_escape_like(term)}%"
        conditions.append(
            or_(
                col(Sender.jid).ilike(pattern, escape="\\"),
                col(Sender.push_name).ilike(pattern, escape="\\"),
            )
        )
    if opted_out is True:
        conditions.append(col(OptOut.jid).is_not(None))
    elif opted_out is False:
        conditions.append(col(OptOut.jid).is_(None))
    return conditions


@router.get("", response_model=Page[ContactOut])
async def list_contacts(
    session: Annotated[AsyncSession, Depends(get_db_async_session)],
    search: Annotated[str | None, Query(max_length=100)] = None,
    opted_out: bool | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ContactOut]:
    flag = col(OptOut.jid).is_not(None)
    rows_stmt = (
        select(Sender, flag.label("opted_out"))
        .outerjoin(OptOut, col(OptOut.jid) == col(Sender.jid))
        .where(*_filters(search, opted_out))
        .order_by(
            func.lower(func.coalesce(Sender.push_name, Sender.jid)), col(Sender.jid)
        )
        .limit(limit)
        .offset(offset)
    )
    rows = (await session.execute(rows_stmt)).all()
    total_stmt = (
        select(func.count())
        .select_from(Sender)
        .outerjoin(OptOut, col(OptOut.jid) == col(Sender.jid))
        .where(*_filters(search, opted_out))
    )
    total = (await session.execute(total_stmt)).scalar_one()
    return Page(
        items=[
            ContactOut(jid=s.jid, push_name=s.push_name, opted_out=bool(o))
            for s, o in rows
        ],
        total=int(total),
    )


@router.patch("/{jid}", response_model=ContactOut)
async def patch_contact(
    jid: str,
    patch: ContactPatch,
    session: Annotated[AsyncSession, Depends(get_db_async_session)],
) -> ContactOut:
    normalized = normalize_jid(jid)
    sender = await session.get(Sender, normalized)
    if sender is None:
        raise HTTPException(status_code=404, detail="contact not found")
    if "push_name" in patch.model_fields_set:
        sender.push_name = clean_text(patch.push_name)
    session.add(sender)
    await session.flush()
    opted = (
        await session.execute(
            select(func.count()).select_from(OptOut).where(OptOut.jid == normalized)
        )
    ).scalar_one()
    return ContactOut(jid=sender.jid, push_name=sender.push_name, opted_out=bool(opted))
