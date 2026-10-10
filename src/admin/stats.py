from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .schemas import StatsBucket

HOUR_SPAN = timedelta(hours=48)
DAY_SPAN = timedelta(days=92)
WEEK_SPAN = timedelta(days=730)  # two years


def pick_bucket(start: datetime, end: datetime) -> StatsBucket:
    """Series bucket that keeps the slot count small for the given span."""
    span = end - start
    if span <= HOUR_SPAN:
        return "hour"
    if span <= DAY_SPAN:
        return "day"
    if span <= WEEK_SPAN:
        return "week"
    return "month"


def localize(value: datetime, zone: ZoneInfo) -> datetime:
    """Naive datetimes are wall-clock times in the configured zone."""
    return value if value.tzinfo else value.replace(tzinfo=zone)
