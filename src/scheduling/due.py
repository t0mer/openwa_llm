"""Pure due-time computation for summary schedules."""

from collections.abc import Sequence
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

UTC = timezone.utc
_MAX_GAP_MINUTES = 24 * 60


def _scheduled_instant(day: date, hour: int, minute: int, tz: ZoneInfo) -> datetime:
    """Local `hour:minute` on `day` as an aware UTC instant.

    Ambiguous (fall-back) times resolve to the first occurrence; nonexistent
    (spring-forward gap) times resolve to the first valid minute after the gap.
    """
    naive = datetime.combine(day, time(hour, minute))
    for step in range(_MAX_GAP_MINUTES):
        candidate = naive + timedelta(minutes=step)
        instant = candidate.replace(tzinfo=tz, fold=0).astimezone(UTC)
        if instant.astimezone(tz).replace(tzinfo=None) == candidate:
            return instant
    raise ValueError("no valid local time found")  # pragma: no cover


def latest_due(
    now_local: datetime,
    weekdays: Sequence[int],
    hour: int,
    minute: int,
    tz: ZoneInfo,
    grace: timedelta,
) -> datetime | None:
    """Most recent scheduled instant <= now and within `grace`, as aware UTC.

    `weekdays` uses 0 = Sunday .. 6 = Saturday. Returns None when there is none.
    """
    if now_local.tzinfo is None:
        raise ValueError("now_local must be timezone-aware")
    now = now_local.astimezone(UTC)
    today = now.astimezone(tz).date()
    best: datetime | None = None
    for back in range(grace.days + 3):
        day = today - timedelta(days=back)
        if (day.isoweekday() % 7) not in weekdays:
            continue
        instant = _scheduled_instant(day, hour, minute, tz)
        if instant <= now and (best is None or instant > best):
            best = instant
    if best is None or now - best >= grace:
        return None
    return best
