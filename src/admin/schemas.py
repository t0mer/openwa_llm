from __future__ import annotations

from datetime import datetime
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, Field, field_validator, model_validator

T = TypeVar("T")

MAX_KEYS = 50
MAX_KEY_LEN = 100
MAX_OFFSET = 1_000_000


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int


def clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def clean_keys(value: list[str] | None) -> list[str] | None:
    """Trim, drop empties, de-duplicate (keep order). Empty result -> None."""
    if not value:
        return None
    seen: dict[str, None] = {}
    for key in value:
        key = key.strip()
        if key and key not in seen:
            seen[key] = None
    keys = list(seen)
    return keys or None


class GroupOut(BaseModel):
    group_jid: str
    group_name: str | None
    display_name: str | None
    group_topic: str | None
    owner_jid: str | None
    managed: bool
    notify_on_spam: bool
    community_keys: list[str]
    last_summary_sync: datetime
    last_ingest: datetime
    message_count: int

    @classmethod
    def from_group(cls, group, message_count: int) -> "GroupOut":
        return cls(
            group_jid=group.group_jid,
            group_name=group.group_name,
            display_name=group.display_name,
            group_topic=group.group_topic,
            owner_jid=group.owner_jid,
            managed=group.managed,
            notify_on_spam=group.notify_on_spam,
            community_keys=list(group.community_keys or []),
            last_summary_sync=group.last_summary_sync,
            last_ingest=group.last_ingest,
            message_count=int(message_count or 0),
        )


def _no_nul(value):
    if isinstance(value, str) and "\x00" in value:
        raise ValueError("NUL characters are not allowed")
    return value


class GroupPatch(BaseModel):
    managed: bool | None = None
    notify_on_spam: bool | None = None
    community_keys: list[str] | None = None
    display_name: str | None = Field(default=None, max_length=255)

    @field_validator("community_keys", mode="before")
    @classmethod
    def _keys(cls, value):
        if value is None:
            return None
        if not isinstance(value, list):
            raise ValueError("community_keys must be a list")
        for key in value:
            _no_nul(key)
            if not isinstance(key, str) or len(key.strip()) > MAX_KEY_LEN:
                raise ValueError(f"each key must be a string of <= {MAX_KEY_LEN} chars")
        return clean_keys(value) or []

    @field_validator("display_name")
    @classmethod
    def _display_name_no_nul(cls, value):
        return _no_nul(value)

    @field_validator("community_keys")
    @classmethod
    def _key_count(cls, value):
        if value is not None and len(value) > MAX_KEYS:
            raise ValueError(f"at most {MAX_KEYS} community keys")
        return value

    @model_validator(mode="after")
    def _no_null_flags(self):
        for name in ("managed", "notify_on_spam"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class ContactOut(BaseModel):
    jid: str
    push_name: str | None
    opted_out: bool


class ContactPatch(BaseModel):
    push_name: str | None = Field(default=None, max_length=255)

    @field_validator("push_name")
    @classmethod
    def _push_name_no_nul(cls, value):
        return _no_nul(value)


class OptOutOut(BaseModel):
    jid: str
    push_name: str | None
    created_at: datetime


class OptOutCreate(BaseModel):
    jid: str = Field(max_length=300)


class MessageOut(BaseModel):
    message_id: str
    timestamp: datetime
    text: str | None
    sender_jid: str
    sender_name: str | None
    group_jid: str | None
    chat_jid: str
    reply_to_id: str | None
    reaction_count: int
    has_media: bool


class MessagePage(BaseModel):
    items: list[MessageOut]
    next_cursor: str | None


class GroupActionResult(BaseModel):
    group_name: str
    group_jid: str
    status: Literal["sent", "skipped", "failed"]
    reason: str | None = None
    message_count: int | None = None
    required: int | None = None


class ActionSummary(BaseModel):
    managed_groups: int
    message: str | None = None


class ActionStatus(BaseModel):
    state: Literal["idle", "running", "succeeded", "failed"]
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    summary: ActionSummary | None = None
    results: list[GroupActionResult] = []


class ActionStarted(BaseModel):
    job_id: str
