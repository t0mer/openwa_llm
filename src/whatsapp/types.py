from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class InboundMessage:
    id: str
    chat_jid: str
    sender_jid: str
    timestamp: datetime
    text: str | None
    sender_name: str | None = None
    reply_to_id: str | None = None
    media_url: str | None = None
    from_me: bool = False
    mentioned_jids: tuple[str, ...] = ()


@dataclass(frozen=True)
class InboundReaction:
    message_id: str
    sender_jid: str
    emoji: str
    timestamp: datetime
    sender_name: str | None = None


@dataclass(frozen=True)
class GroupEvent:
    name: str


@dataclass(frozen=True)
class GroupInfo:
    jid: str
    name: str | None = None
    topic: str | None = None
    owner_jid: str | None = None


@dataclass(frozen=True)
class SessionStatus:
    status: str
    phone: str | None = None
