from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from admin.schemas import StatsOut
from admin.stats import localize, pick_bucket

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
SECOND = timedelta(seconds=1)


@pytest.mark.parametrize(
    ("span", "bucket"),
    [
        (timedelta(0), "hour"),
        (timedelta(hours=48), "hour"),
        (timedelta(hours=48) + SECOND, "day"),
        (timedelta(days=92), "day"),
        (timedelta(days=92) + SECOND, "week"),
        (timedelta(days=730), "week"),
        (timedelta(days=730) + SECOND, "month"),
        (timedelta(days=365 * 130), "month"),
    ],
)
def test_pick_bucket_boundaries(span, bucket):
    assert pick_bucket(T0, T0 + span) == bucket


def test_localize_reads_naive_values_in_the_configured_zone():
    zone = ZoneInfo("Asia/Jerusalem")
    naive = datetime(2026, 7, 1, 9, 0)
    assert localize(naive, zone) == datetime(2026, 7, 1, 6, 0, tzinfo=timezone.utc)
    aware = datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)
    assert localize(aware, zone) == aware


def test_stats_out_serializes_from_under_its_alias():
    out = StatsOut.model_validate(
        {
            "from_": T0,
            "to": T0,
            "timezone": "Asia/Jerusalem",
            "bucket": "hour",
            "bot_excluded": True,
            "groups": {"total": 0, "managed": 0},
            "chats": 0,
            "messages": 0,
            "active_senders": 0,
            "reactions": 0,
            "kb_topics": 0,
            "split": {"text": 0, "media": 0, "other": 0},
            "series": [{"start": T0, "count": 0}],
            "top_groups": [{"group_jid": "1@g.us", "name": None, "count": 1}],
            "top_senders": [
                {"sender_jid": "a@s.whatsapp.net", "name": "א", "count": 1}
            ],
            "by_hour": [0] * 24,
            "by_weekday": [0] * 7,
        }
    )
    dumped = out.model_dump(by_alias=True)
    assert dumped["from"] == T0 and "from_" not in dumped
    assert out.from_ == T0
