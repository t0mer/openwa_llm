from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from api.deps import get_db_async_session
from models import OptOut, Sender

from .jid_input import parse_user_jid
from .schemas import OptOutCreate, OptOutOut

router = APIRouter(tags=["admin-opt-outs"])


def _normalize_or_422(raw: str) -> str:
    try:
        return parse_user_jid(raw)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@router.get("", response_model=list[OptOutOut])
async def list_opt_outs(
    session: Annotated[AsyncSession, Depends(get_db_async_session)],
) -> list[OptOutOut]:
    stmt = (
        select(OptOut, Sender.push_name)
        .outerjoin(Sender, col(Sender.jid) == col(OptOut.jid))
        .order_by(col(OptOut.created_at).desc(), col(OptOut.jid))
    )
    rows = (await session.execute(stmt)).all()
    return [
        OptOutOut(jid=o.jid, push_name=name, created_at=o.created_at)
        for o, name in rows
    ]


@router.post("", response_model=OptOutOut, status_code=201)
async def add_opt_out(
    body: OptOutCreate,
    response: Response,
    session: Annotated[AsyncSession, Depends(get_db_async_session)],
) -> OptOutOut:
    jid = _normalize_or_422(body.jid)
    existing = await session.get(OptOut, jid)
    if existing is not None:
        response.status_code = 200
        sender = await session.get(Sender, jid)
        return OptOutOut(
            jid=existing.jid,
            push_name=sender.push_name if sender else None,
            created_at=existing.created_at,
        )
    entry = OptOut(jid=jid)
    session.add(entry)
    await session.flush()
    sender = await session.get(Sender, jid)
    return OptOutOut(
        jid=entry.jid,
        push_name=sender.push_name if sender else None,
        created_at=entry.created_at,
    )


@router.delete("/{jid}", status_code=204)
async def remove_opt_out(
    jid: str,
    session: Annotated[AsyncSession, Depends(get_db_async_session)],
) -> None:
    normalized = _normalize_or_422(jid)
    existing = await session.get(OptOut, normalized)
    if existing is not None:
        await session.delete(existing)
