from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from models import Group, GroupSummarySchedule


async def test_round_trip_with_weekdays_array_and_defaults(db_sessionmaker):
    async with db_sessionmaker() as session:
        session.add(Group(group_jid="1@g.us", managed=True))
        await session.flush()
        schedule = GroupSummarySchedule(
            group_jid="1@g.us", weekdays=[0, 3, 6], hour=0, minute=5
        )
        session.add(schedule)
        await session.commit()
        schedule_id = schedule.id

    async with db_sessionmaker() as session:
        row = await session.get(GroupSummarySchedule, schedule_id)
        assert row is not None
        assert row.weekdays == [0, 3, 6]
        assert (row.hour, row.minute) == (0, 5)
        assert row.enabled is True
        assert row.created_at.tzinfo is not None
        assert row.created_at <= datetime.now(timezone.utc)
        assert row.last_run_at is None
        assert row.last_status is None
        assert row.last_reason is None
        assert row.last_message_count is None


async def test_ids_are_unique_per_schedule(db_sessionmaker):
    a = GroupSummarySchedule(group_jid="1@g.us", weekdays=[1], hour=1, minute=1)
    b = GroupSummarySchedule(group_jid="1@g.us", weekdays=[1], hour=1, minute=1)
    assert a.id != b.id


async def test_last_run_fields_round_trip(db_sessionmaker):
    ran = datetime(2026, 10, 9, 12, 0, tzinfo=timezone.utc)
    async with db_sessionmaker() as session:
        session.add(Group(group_jid="1@g.us"))
        await session.flush()
        schedule = GroupSummarySchedule(
            group_jid="1@g.us",
            weekdays=[2],
            hour=23,
            minute=59,
            enabled=False,
            last_run_at=ran,
            last_status="skipped",
            last_reason="too_few_messages",
            last_message_count=3,
        )
        session.add(schedule)
        await session.commit()
        schedule_id = schedule.id

    async with db_sessionmaker() as session:
        row = await session.get(GroupSummarySchedule, schedule_id)
        assert row is not None
        assert row.last_run_at == ran
        assert row.enabled is False
        assert (row.last_status, row.last_reason, row.last_message_count) == (
            "skipped",
            "too_few_messages",
            3,
        )


async def test_deleting_group_cascades_to_schedules(db_sessionmaker):
    async with db_sessionmaker() as session:
        session.add(Group(group_jid="1@g.us"))
        session.add(Group(group_jid="2@g.us"))
        await session.flush()
        session.add(
            GroupSummarySchedule(group_jid="1@g.us", weekdays=[1], hour=8, minute=0)
        )
        session.add(
            GroupSummarySchedule(group_jid="2@g.us", weekdays=[1], hour=8, minute=0)
        )
        await session.commit()

    async with db_sessionmaker() as session:
        group = await session.get(Group, "1@g.us")
        assert group is not None
        await session.delete(group)
        await session.commit()

    async with db_sessionmaker() as session:
        rows = (await session.exec(select(GroupSummarySchedule))).all()
        assert [r.group_jid for r in rows] == ["2@g.us"]


async def test_schedule_requires_existing_group(db_sessionmaker):
    async with db_sessionmaker() as session:
        session.add(
            GroupSummarySchedule(group_jid="nope@g.us", weekdays=[1], hour=8, minute=0)
        )
        with pytest.raises(IntegrityError):
            await session.commit()
