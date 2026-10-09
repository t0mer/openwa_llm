from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from scheduling.due import latest_due

TZ = ZoneInfo("Asia/Jerusalem")
UTC = timezone.utc
GRACE = timedelta(minutes=60)
ALL = [0, 1, 2, 3, 4, 5, 6]


def local(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=TZ)


def due(now, weekdays, hour, minute, grace=GRACE):
    return latest_due(now, weekdays, hour, minute, TZ, grace)


def test_exact_minute_is_due_and_returns_aware_utc():
    got = due(local(2026, 10, 7, 9, 0), ALL, 9, 0)  # Wed
    assert got == local(2026, 10, 7, 9, 0)
    assert got is not None and got.utcoffset() == timedelta(0)


def test_before_slot_is_not_due():
    assert due(local(2026, 10, 7, 8, 59), ALL, 9, 0) is None


def test_within_grace_is_due_beyond_is_not():
    assert due(local(2026, 10, 7, 9, 59), ALL, 9, 0) == local(2026, 10, 7, 9, 0)
    assert due(local(2026, 10, 7, 10, 0), ALL, 9, 0) is None


def test_weekday_filter_uses_sunday_zero():
    # 2026-10-07 is a Wednesday (3); 2026-10-04 is a Sunday (0)
    assert due(local(2026, 10, 7, 9, 0), [3], 9, 0) is not None
    assert due(local(2026, 10, 7, 9, 0), [0, 1, 2, 4, 5, 6], 9, 0) is None
    assert due(local(2026, 10, 4, 9, 0), [0], 9, 0) is not None
    assert due(local(2026, 10, 10, 9, 0), [6], 9, 0) is not None  # Saturday


@pytest.mark.parametrize("hour,label", [(0, "12 AM"), (12, "12 PM")])
def test_midnight_and_noon_boundaries(hour, label):
    assert due(local(2026, 10, 7, hour, 0), [3], hour, 0) == local(
        2026, 10, 7, hour, 0
    ), label
    assert due(local(2026, 10, 7, hour, 0) - timedelta(minutes=1), [3], hour, 0) is None


def test_2359_slot_rolls_over_to_next_day_within_grace():
    # Tuesday 23:59 slot, now is Wednesday 00:20 and only Tuesday is selected.
    now = local(2026, 10, 7, 0, 20)
    assert due(now, [2], 23, 59) == local(2026, 10, 6, 23, 59)
    # Wednesday-only selection: the Tuesday slot must not fire.
    assert due(now, [3], 23, 59) is None


def test_larger_grace_looks_back_several_days():
    got = due(local(2026, 10, 9, 12, 0), [3], 9, 0, grace=timedelta(days=3))
    assert got == local(2026, 10, 7, 9, 0)


def test_naive_now_is_rejected():
    with pytest.raises(ValueError):
        due(datetime(2026, 10, 7, 9, 0), ALL, 9, 0)


# Israel DST 2026: starts Fri 2026-03-27 at 02:00 (clocks 02:00 -> 03:00),
# ends Sun 2026-10-25 at 02:00 (clocks 02:00 -> 01:00).
def test_spring_forward_gap_runs_at_first_valid_minute():
    slot = (2, 30)
    first_valid = datetime(2026, 3, 27, 0, 0, tzinfo=UTC)  # == 03:00 IDT
    assert first_valid == local(2026, 3, 27, 3, 0)
    just_before = first_valid - timedelta(minutes=1)
    assert due(just_before, ALL, *slot) is None
    assert due(first_valid, ALL, *slot) == first_valid
    assert due(first_valid + timedelta(minutes=30), ALL, *slot) == first_valid
    assert due(first_valid + timedelta(minutes=61), ALL, *slot) is None


def test_gap_slot_respects_weekday_of_the_day():
    # 2026-03-27 is a Friday (5): not selected -> never due.
    assert due(local(2026, 3, 27, 3, 5), [0, 1, 2, 3, 4, 6], 2, 30) is None


def test_gap_slot_on_normal_day_is_unaffected():
    assert due(local(2026, 3, 28, 2, 30), ALL, 2, 30) == local(2026, 3, 28, 2, 30)


def test_fall_back_ambiguous_time_uses_first_occurrence():
    first = datetime(2026, 10, 24, 22, 30, tzinfo=UTC)  # 01:30 IDT (+3)
    second = first + timedelta(hours=1)  # 01:30 IST (+2)
    assert first.astimezone(TZ).hour == 1 and second.astimezone(TZ).hour == 1
    assert due(first, ALL, 1, 30) == first
    # Second occurrence still resolves to the same (first) instant, so the
    # last_run_at >= due check suppresses a second run.
    assert due(second, ALL, 1, 30, grace=timedelta(hours=2)) == first
    assert due(first + timedelta(minutes=61), ALL, 1, 30) is None


def test_slot_after_fall_back_is_normal():
    assert due(local(2026, 10, 25, 9, 0), ALL, 9, 0) == local(2026, 10, 25, 9, 0)
