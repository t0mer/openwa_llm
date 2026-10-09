from __future__ import annotations

from datetime import datetime
from typing import Annotated, Generic, Literal, TypeVar

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    field_validator,
    model_validator,
)

T = TypeVar("T")

MAX_KEYS = 50
MAX_KEY_LEN = 100
MAX_OFFSET = 1_000_000
SUMMARY_LANGUAGES = ("he", "en", "ru")


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
    summary_language: Literal["he", "en", "ru"] | None
    group_topic: str | None
    owner_jid: str | None
    managed: bool
    notify_on_spam: bool
    community_keys: list[str]
    last_summary_sync: datetime
    last_ingest: datetime
    message_count: int
    schedule_count: int = 0

    @classmethod
    def from_group(
        cls, group, message_count: int, schedule_count: int = 0
    ) -> "GroupOut":
        return cls(
            group_jid=group.group_jid,
            group_name=group.group_name,
            display_name=group.display_name,
            summary_language=group.summary_language,
            group_topic=group.group_topic,
            owner_jid=group.owner_jid,
            managed=group.managed,
            notify_on_spam=group.notify_on_spam,
            community_keys=list(group.community_keys or []),
            last_summary_sync=group.last_summary_sync,
            last_ingest=group.last_ingest,
            message_count=int(message_count or 0),
            schedule_count=int(schedule_count or 0),
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
    summary_language: str | None = None

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

    @field_validator("summary_language")
    @classmethod
    def _normalise_summary_language(cls, value):
        if value is None:
            return None
        value = value.strip().lower()
        if value in ("", "auto"):
            return None
        if value not in SUMMARY_LANGUAGES:
            raise ValueError("summary_language must be one of he, en, ru, auto")
        return value

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


MAX_SCHEDULES_PER_GROUP = 20
MAX_WEEKDAYS_INPUT = 64


def hour12_to_hour(hour12: int, meridiem: str) -> int:
    """12 AM -> 0, 12 PM -> 12, 1-11 PM -> 13-23."""
    return hour12 % 12 + (12 if meridiem == "PM" else 0)


def hour_to_hour12(hour: int) -> tuple[int, Literal["AM", "PM"]]:
    return (hour % 12 or 12), ("AM" if hour < 12 else "PM")


WeekdayList = Annotated[list[StrictInt], Field(max_length=MAX_WEEKDAYS_INPUT)]


def _clean_weekdays(value):
    if value is None:
        raise ValueError("weekdays cannot be null")
    if not value:
        raise ValueError("weekdays must not be empty")
    if any(day < 0 or day > 6 for day in value):
        raise ValueError("weekdays must be integers 0 (Sunday) to 6 (Saturday)")
    return sorted(set(value))


class _ScheduleTime(BaseModel):
    """Shared time fields: exactly one of (hour) or (hour12 + meridiem)."""

    model_config = ConfigDict(extra="forbid")

    hour: StrictInt | None = Field(default=None, ge=0, le=23)
    hour12: StrictInt | None = Field(default=None, ge=1, le=12)
    meridiem: Literal["AM", "PM"] | None = None
    minute: StrictInt | None = Field(default=None, ge=0, le=59)

    def _check_time_form(self) -> None:
        sent = self.model_fields_set
        for name in ("hour", "hour12", "meridiem", "minute"):
            if name in sent and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        twelve = bool({"hour12", "meridiem"} & sent)
        if "hour" in sent and twelve:
            raise ValueError("send either hour or hour12 with meridiem, not both")
        if twelve and not {"hour12", "meridiem"} <= sent:
            raise ValueError("hour12 and meridiem must be sent together")

    def resolved_hour(self) -> int | None:
        """The 24-hour hour, or None when no time form was sent."""
        if self.hour is not None:
            return self.hour
        if self.hour12 is not None and self.meridiem is not None:
            return hour12_to_hour(self.hour12, self.meridiem)
        return None


class ScheduleCreate(_ScheduleTime):
    weekdays: WeekdayList
    enabled: bool = True

    @field_validator("weekdays", mode="after")
    @classmethod
    def _weekdays(cls, value):
        return _clean_weekdays(value)

    @model_validator(mode="after")
    def _time(self):
        self._check_time_form()
        if self.resolved_hour() is None:
            raise ValueError("send hour or hour12 with meridiem")
        if self.minute is None:
            raise ValueError("minute is required")
        return self


class SchedulePatch(_ScheduleTime):
    weekdays: WeekdayList | None = None
    enabled: bool | None = None

    @field_validator("weekdays", mode="after")
    @classmethod
    def _weekdays(cls, value):
        return _clean_weekdays(value)

    @model_validator(mode="after")
    def _time(self):
        self._check_time_form()
        if "enabled" in self.model_fields_set and self.enabled is None:
            raise ValueError("enabled cannot be null")
        return self


class ScheduleOut(BaseModel):
    id: str
    weekdays: list[int]
    hour: int
    minute: int
    hour12: int
    meridiem: Literal["AM", "PM"]
    enabled: bool
    last_run_at: datetime | None
    last_status: str | None
    last_reason: str | None
    last_message_count: int | None

    @classmethod
    def from_schedule(cls, schedule) -> "ScheduleOut":
        hour12, meridiem = hour_to_hour12(schedule.hour)
        return cls(
            id=schedule.id,
            weekdays=sorted(set(schedule.weekdays)),
            hour=schedule.hour,
            minute=schedule.minute,
            hour12=hour12,
            meridiem=meridiem,
            enabled=schedule.enabled,
            last_run_at=schedule.last_run_at,
            last_status=schedule.last_status,
            last_reason=schedule.last_reason,
            last_message_count=schedule.last_message_count,
        )


class ScheduleList(BaseModel):
    timezone: str
    items: list[ScheduleOut]
