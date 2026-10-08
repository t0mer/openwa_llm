from __future__ import annotations

import base64
import json
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, literal, tuple_
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from api.deps import get_db_async_session
from models import Message, Reaction
from whatsapp.jid import normalize_jid

from .schemas import MessageOut, MessagePage

router = APIRouter(tags=["admin-messages"])


def encode_cursor(timestamp: datetime, message_id: str) -> str:
    raw = json.dumps([timestamp.isoformat(), message_id]).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii")


def decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        ts_text, message_id = json.loads(
            base64.urlsafe_b64decode(cursor.encode("ascii"))
        )
        if not isinstance(ts_text, str) or not isinstance(message_id, str):
            raise ValueError
        return datetime.fromisoformat(ts_text), message_id
    except (ValueError, TypeError, UnicodeError) as e:
        raise ValueError("invalid cursor") from e


@router.get("", response_model=MessagePage)
async def list_messages(
    session: Annotated[AsyncSession, Depends(get_db_async_session)],
    group_jid: Annotated[str | None, Query(max_length=255)] = None,
    sender_jid: Annotated[str | None, Query(max_length=255)] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    from_: Annotated[datetime | None, Query(alias="from")] = None,
    to: datetime | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    before: Annotated[str | None, Query(max_length=600)] = None,
) -> MessagePage:
    stmt = select(Message)
    if group_jid:
        stmt = stmt.where(Message.group_jid == normalize_jid(group_jid))
    if sender_jid:
        stmt = stmt.where(Message.sender_jid == normalize_jid(sender_jid))
    if from_ is not None:
        stmt = stmt.where(col(Message.timestamp) >= from_)
    if to is not None:
        stmt = stmt.where(col(Message.timestamp) <= to)
    term = (q or "").strip()
    if term:
        stmt = stmt.where(
            func.to_tsvector("simple", func.coalesce(Message.text, "")).op("@@")(
                func.plainto_tsquery("simple", term)
            )
        )
    if before:
        try:
            cursor_ts, cursor_id = decode_cursor(before)
        except ValueError as e:
            raise HTTPException(status_code=422, detail="invalid cursor") from e
        stmt = stmt.where(
            tuple_(col(Message.timestamp), col(Message.message_id))
            < tuple_(literal(cursor_ts), literal(cursor_id))
        )
    stmt = stmt.order_by(
        col(Message.timestamp).desc(), col(Message.message_id).desc()
    ).limit(limit + 1)

    fetched = list((await session.execute(stmt)).scalars().all())
    page = fetched[:limit]
    has_more = len(fetched) > limit

    counts: dict[str, int] = {}
    if page:
        ids = [m.message_id for m in page]
        count_rows = await session.execute(
            select(Reaction.message_id, func.count())
            .where(col(Reaction.message_id).in_(ids))
            .group_by(Reaction.message_id)
        )
        counts = {mid: int(n) for mid, n in count_rows.all()}

    items = [
        MessageOut(
            message_id=m.message_id,
            timestamp=m.timestamp,
            text=m.text,
            sender_jid=m.sender_jid,
            sender_name=m.sender.push_name if m.sender else None,
            group_jid=m.group_jid,
            chat_jid=m.chat_jid,
            reply_to_id=m.reply_to_id,
            reaction_count=counts.get(m.message_id, 0),
            has_media=m.media_url is not None,
        )
        for m in page
    ]
    next_cursor = (
        encode_cursor(page[-1].timestamp, page[-1].message_id)
        if has_more and page
        else None
    )
    return MessagePage(items=items, next_cursor=next_cursor)
