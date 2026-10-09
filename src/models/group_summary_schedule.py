from datetime import datetime, timezone
from typing import List, Optional
from uuid import uuid4

from sqlmodel import ARRAY, Column, DateTime, Field, Integer, SQLModel


class GroupSummarySchedule(SQLModel, table=True):
    """A recurring summary slot for a group.

    `weekdays` uses 0 = Sunday .. 6 = Saturday; `hour`/`minute` are stored in
    24-hour form and interpreted in the configured `Settings.timezone`.
    """

    __tablename__: str = "group_summary_schedule"

    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True)
    group_jid: str = Field(
        foreign_key="group.group_jid",
        ondelete="CASCADE",
        max_length=255,
        index=True,
    )
    weekdays: List[int] = Field(sa_column=Column(ARRAY(Integer), nullable=False))
    hour: int
    minute: int
    enabled: bool = Field(default=True)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    last_run_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    last_status: Optional[str] = Field(default=None, max_length=16)
    last_reason: Optional[str] = Field(default=None, max_length=64)
    last_message_count: Optional[int] = Field(default=None)
