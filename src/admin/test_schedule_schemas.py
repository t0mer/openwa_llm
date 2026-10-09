import pytest
from pydantic import ValidationError

from admin.schemas import (
    ScheduleCreate,
    SchedulePatch,
    hour12_to_hour,
    hour_to_hour12,
)


@pytest.mark.parametrize(
    "hour,hour12,meridiem",
    [
        (0, 12, "AM"),
        (1, 1, "AM"),
        (11, 11, "AM"),
        (12, 12, "PM"),
        (13, 1, "PM"),
        (23, 11, "PM"),
    ],
)
def test_conversion_round_trip(hour, hour12, meridiem):
    assert hour_to_hour12(hour) == (hour12, meridiem)
    assert hour12_to_hour(hour12, meridiem) == hour


def test_create_24h_and_12h_forms():
    a = ScheduleCreate(weekdays=[1], hour=0, minute=0)
    assert (a.resolved_hour(), a.minute) == (0, 0)
    b = ScheduleCreate(weekdays=[1], hour12=12, meridiem="AM", minute=0)
    assert b.resolved_hour() == 0
    c = ScheduleCreate(weekdays=[1], hour12=12, meridiem="PM", minute=0)
    assert c.resolved_hour() == 12
    d = ScheduleCreate(weekdays=[1], hour12=11, meridiem="PM", minute=59)
    assert (d.resolved_hour(), d.minute) == (23, 59)


def test_weekdays_collapsed_and_sorted():
    s = ScheduleCreate(weekdays=[6, 0, 6, 3, 0], hour=1, minute=1)
    assert s.weekdays == [0, 3, 6]


@pytest.mark.parametrize(
    "body",
    [
        {"weekdays": [], "hour": 1, "minute": 0},
        {"weekdays": [7], "hour": 1, "minute": 0},
        {"weekdays": [-1], "hour": 1, "minute": 0},
        {"weekdays": ["1"], "hour": 1, "minute": 0},
        {"weekdays": [True], "hour": 1, "minute": 0},
        {"weekdays": [1.5], "hour": 1, "minute": 0},
        {"weekdays": None, "hour": 1, "minute": 0},
        {"hour": 1, "minute": 0},
        {"weekdays": [1], "hour": 24, "minute": 0},
        {"weekdays": [1], "hour": -1, "minute": 0},
        {"weekdays": [1], "hour": 1, "minute": 60},
        {"weekdays": [1], "hour": 1, "minute": -1},
        {"weekdays": [1], "hour": 1},
        {"weekdays": [1], "minute": 0},
        {"weekdays": [1], "hour12": 13, "meridiem": "PM", "minute": 0},
        {"weekdays": [1], "hour12": 0, "meridiem": "AM", "minute": 0},
        {"weekdays": [1], "hour12": 1, "meridiem": "pm", "minute": 0},
        {"weekdays": [1], "hour12": 1, "minute": 0},
        {"weekdays": [1], "meridiem": "AM", "minute": 0},
        {"weekdays": [1], "hour": 1, "hour12": 1, "meridiem": "AM", "minute": 0},
        {"weekdays": [1], "hour": 13, "meridiem": "PM", "minute": 0},
        {"weekdays": [1], "hour": "9", "minute": 0},
        {"weekdays": [1], "hour": True, "minute": 0},
        {"weekdays": [1], "hour": 1, "minute": 0, "enabled": None},
        {"weekdays": [1], "hour": 1, "minute": 0, "bogus": 1},
    ],
)
def test_create_rejects_invalid(body):
    with pytest.raises(ValidationError):
        ScheduleCreate(**body)


def test_create_rejects_too_many_weekdays():
    with pytest.raises(ValidationError):
        ScheduleCreate(weekdays=[1] * 100, hour=1, minute=0)


def test_patch_only_sent_fields():
    p = SchedulePatch()
    assert p.model_fields_set == set()
    assert p.resolved_hour() is None
    assert SchedulePatch(minute=5).model_fields_set == {"minute"}
    assert SchedulePatch(hour=0).resolved_hour() == 0
    assert SchedulePatch(hour12=12, meridiem="PM").resolved_hour() == 12
    assert SchedulePatch(hour=0).resolve_hour(15) == 0


@pytest.mark.parametrize(
    "current,body,expected",
    [
        (9, {"meridiem": "PM"}, 21),
        (21, {"meridiem": "AM"}, 9),
        (15, {"hour12": 5}, 17),
        (9, {"hour12": 5}, 5),
        (0, {"meridiem": "PM"}, 12),
        (12, {"meridiem": "AM"}, 0),
        (0, {"hour12": 11}, 11),
        (0, {"hour12": 12}, 0),
        (12, {"hour12": 12}, 12),
        (23, {"hour12": 12}, 12),
        (13, {"meridiem": "PM"}, 13),
        (11, {"hour12": 12, "meridiem": "PM"}, 12),
        (5, {"minute": 3}, None),
    ],
)
def test_patch_partial_12h_uses_stored_hour(current, body, expected):
    assert SchedulePatch(**body).resolve_hour(current) == expected


@pytest.mark.parametrize(
    "body",
    [
        {"weekdays": []},
        {"weekdays": None},
        {"enabled": None},
        {"hour": None},
        {"minute": None},
        {"hour": 1, "hour12": 1, "meridiem": "AM"},
        {"hour": 13, "meridiem": "PM"},
        {"hour": 24},
        {"minute": 60},
    ],
)
def test_patch_rejects_invalid(body):
    with pytest.raises(ValidationError):
        SchedulePatch(**body)
