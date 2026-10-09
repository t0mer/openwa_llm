from datetime import datetime, timezone
from typing import List, Optional
from uuid import uuid4

from sqlalchemy import CheckConstraint
from sqlmodel import ARRAY, Column, DateTime, Field, Integer, SQLModel


class GroupSummarySchedule(SQLModel, table=True):
    """A recurring summary slot for a group.

    `weekdays` uses 0 = Sunday .. 6 = Saturday; `hour`/`minute` are stored in
    24-hour form and interpreted in the configured `Settings.timezone`.
    """

    __tablename__: str = "group_summary_schedule"
    __table_args__ = (
        CheckConstraint("hour BETWEEN 0 AND 23", name="ck_group_summary_schedule_hour"),
        CheckConstraint(
            "minute BETWEEN 0 AND 59", name="ck_group_summary_schedule_minute"
        ),
        CheckConstraint(
            "cardinality(weekdays) > 0",
            name="ck_group_summary_schedule_weekdays_not_empty",
        ),
        CheckConstraint(
            "weekdays <@ ARRAY[0,1,2,3,4,5,6]",
            name="ck_group_summary_schedule_weekdays_range",
        ),
    )

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
