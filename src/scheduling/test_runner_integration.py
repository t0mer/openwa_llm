import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, MagicMock
from zoneinfo import ZoneInfo

import pytest

from config import Settings
from models import Group, GroupSummarySchedule
from scheduling import runner
from scheduling.runner import claim, run_due
from summarize_and_send_to_groups import GroupSummaryResult

TZ = ZoneInfo("Asia/Jerusalem")
SETTINGS = cast(Settings, SimpleNamespace(timezone="Asia/Jerusalem"))
# Wednesday 2026-10-07 09:00 Asia/Jerusalem (UTC+3)
NOW = datetime(2026, 10, 7, 9, 0, tzinfo=TZ)


def local(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=TZ)


async def seed(
    sm, *, managed=True, enabled=True, weekdays=(3,), hour=9, minute=0, last_run=None
):
    async with sm() as s:
        if await s.get(Group, "1@g.us") is None:
            s.add(Group(group_jid="1@g.us", group_name="G", managed=managed))
            await s.flush()
        sched = GroupSummarySchedule(
            group_jid="1@g.us",
            weekdays=list(weekdays),
            hour=hour,
            minute=minute,
            enabled=enabled,
            last_run_at=last_run,
        )
        s.add(sched)
        await s.commit()
        return sched.id


async def load(sm, sid):
    async with sm() as s:
        row = await s.get(GroupSummarySchedule, sid)
        assert row is not None
        return row


@pytest.fixture
def summarize(monkeypatch):
    mock = AsyncMock(return_value=GroupSummaryResult(status="sent", message_count=20))
    monkeypatch.setattr(runner, "summarize_and_send_to_group", mock)
    return mock


async def test_due_schedule_runs_once_and_records_result(db_sessionmaker, summarize):
    sid = await seed(db_sessionmaker)
    wa = MagicMock()
    recs = await run_due(SETTINGS, db_sessionmaker, wa, now=NOW)
    assert [(r.schedule_id, r.status, r.message_count) for r in recs] == [
        (sid, "sent", 20)
    ]
    summarize.assert_awaited_once()
    row = await load(db_sessionmaker, sid)
    assert row.last_status == "sent" and row.last_message_count == 20
    assert row.last_run_at == NOW.astimezone(timezone.utc)

    # second tick in the same minute and a later tick in the grace window: no rerun
    assert await run_due(SETTINGS, db_sessionmaker, wa, now=NOW) == []
    assert (
        await run_due(SETTINGS, db_sessionmaker, wa, now=NOW + timedelta(minutes=30))
        == []
    )
    summarize.assert_awaited_once()


async def test_restart_right_after_run_does_not_rerun(db_sessionmaker, summarize):
    # last_run_at persisted by an earlier process just after the due instant
    await seed(db_sessionmaker, last_run=NOW + timedelta(seconds=5))
    assert (
        await run_due(
            SETTINGS, db_sessionmaker, MagicMock(), now=NOW + timedelta(minutes=2)
        )
        == []
    )
    summarize.assert_not_awaited()


async def test_previous_occurrence_run_does_not_block_next(db_sessionmaker, summarize):
    await seed(db_sessionmaker, last_run=NOW - timedelta(days=7))
    recs = await run_due(SETTINGS, db_sessionmaker, MagicMock(), now=NOW)
    assert len(recs) == 1


async def test_not_due_outside_grace_or_wrong_day(db_sessionmaker, summarize):
    await seed(db_sessionmaker)
    wa = MagicMock()
    assert (
        await run_due(SETTINGS, db_sessionmaker, wa, now=NOW - timedelta(minutes=1))
        == []
    )
    assert (
        await run_due(SETTINGS, db_sessionmaker, wa, now=NOW + timedelta(minutes=61))
        == []
    )
    assert (
        await run_due(SETTINGS, db_sessionmaker, wa, now=NOW + timedelta(days=1)) == []
    )
    summarize.assert_not_awaited()


async def test_midnight_and_noon_slots_fire(db_sessionmaker, summarize):
    await seed(db_sessionmaker, hour=0)
    await seed(db_sessionmaker, hour=12)
    wa = MagicMock()
    assert (
        len(await run_due(SETTINGS, db_sessionmaker, wa, now=local(2026, 10, 7, 0, 0)))
        == 1
    )
    assert (
        len(await run_due(SETTINGS, db_sessionmaker, wa, now=local(2026, 10, 7, 12, 0)))
        == 1
    )


async def test_2359_slot_fires_after_midnight_on_its_own_weekday(
    db_sessionmaker, summarize
):
    await seed(db_sessionmaker, weekdays=(2,), hour=23, minute=59)  # Tuesday
    now = local(2026, 10, 7, 0, 10)  # already Wednesday
    assert len(await run_due(SETTINGS, db_sessionmaker, MagicMock(), now=now)) == 1


async def test_dst_gap_slot_runs_once_at_first_valid_minute(db_sessionmaker, summarize):
    await seed(db_sessionmaker, weekdays=(5,), hour=2, minute=30)  # Fri 2026-03-27
    wa = MagicMock()
    first_valid = datetime(2026, 3, 27, 0, 0, tzinfo=timezone.utc)  # 03:00 local
    assert (
        await run_due(
            SETTINGS, db_sessionmaker, wa, now=first_valid - timedelta(minutes=1)
        )
        == []
    )
    assert len(await run_due(SETTINGS, db_sessionmaker, wa, now=first_valid)) == 1
    assert (
        await run_due(
            SETTINGS, db_sessionmaker, wa, now=first_valid + timedelta(minutes=5)
        )
        == []
    )
    summarize.assert_awaited_once()


async def test_dst_overlap_slot_runs_once(db_sessionmaker, summarize):
    await seed(db_sessionmaker, weekdays=(0,), hour=1, minute=30)  # Sun 2026-10-25
    wa = MagicMock()
    first = datetime(2026, 10, 24, 22, 30, tzinfo=timezone.utc)
    ticks = [first + timedelta(minutes=m) for m in (0, 1, 30, 60, 61, 90)]
    total = 0
    for t in ticks:
        total += len(await run_due(SETTINGS, db_sessionmaker, wa, now=t))
    assert total == 1


async def test_claim_race_has_exactly_one_winner(db_sessionmaker):
    sid = await seed(db_sessionmaker)
    due = NOW.astimezone(timezone.utc)

    async def claimant():
        async with db_sessionmaker() as s:
            return await claim(s, sid, due, due + timedelta(seconds=1))

    results = await asyncio.gather(*(claimant() for _ in range(8)))
    assert results.count(True) == 1


async def test_concurrent_ticks_run_exactly_once(db_sessionmaker, summarize):
    await seed(db_sessionmaker)
    wa = MagicMock()
    batches = await asyncio.gather(
        *(run_due(SETTINGS, db_sessionmaker, wa, now=NOW) for _ in range(4))
    )
    assert sum(len(b) for b in batches) == 1
    summarize.assert_awaited_once()


async def test_disabled_unmanaged_and_deleted_never_run(db_sessionmaker, summarize):
    await seed(db_sessionmaker, enabled=False)
    wa = MagicMock()
    assert await run_due(SETTINGS, db_sessionmaker, wa, now=NOW) == []

    async with db_sessionmaker() as s:
        g = await s.get(Group, "1@g.us")
        assert g is not None
        g.managed = False
        await s.commit()
    await seed(db_sessionmaker)  # enabled schedule, unmanaged group
    assert await run_due(SETTINGS, db_sessionmaker, wa, now=NOW) == []

    async with db_sessionmaker() as s:
        g = await s.get(Group, "1@g.us")
        assert g is not None
        await s.delete(g)
        await s.commit()
    assert await run_due(SETTINGS, db_sessionmaker, wa, now=NOW) == []
    summarize.assert_not_awaited()


async def test_group_unmanaged_after_selection_is_skipped(db_sessionmaker, summarize):
    sid = await seed(db_sessionmaker, managed=False)
    rec = await runner._run_claimed(
        SETTINGS, db_sessionmaker, MagicMock(), sid, "1@g.us"
    )
    assert (rec.status, rec.reason) == ("skipped", "group_not_managed")
    summarize.assert_not_awaited()
    assert (await load(db_sessionmaker, sid)).last_reason == "group_not_managed"


async def test_exception_is_recorded_without_text_and_other_schedules_still_run(
    db_sessionmaker, summarize
):
    s1 = await seed(db_sessionmaker)
    s2 = await seed(db_sessionmaker)
    summarize.side_effect = [
        RuntimeError("secret sk-ant-123 leaked"),
        GroupSummaryResult(status="sent", message_count=16),
    ]
    recs = await run_due(SETTINGS, db_sessionmaker, MagicMock(), now=NOW)
    assert sorted(r.status for r in recs) == ["failed", "sent"]
    failed = [r for r in recs if r.status == "failed"][0]
    assert failed.reason == "unexpected_error"
    row = await load(db_sessionmaker, failed.schedule_id)
    assert row.last_status == "failed" and row.last_reason == "unexpected_error"
    assert "secret" not in repr(recs)
    assert {s1, s2} == {r.schedule_id for r in recs}


async def test_schedule_deleted_during_run_does_not_error(db_sessionmaker, summarize):
    sid = await seed(db_sessionmaker)

    async def delete_then_return(*a, **k):
        async with db_sessionmaker() as s:
            row = await s.get(GroupSummarySchedule, sid)
            assert row is not None
            await s.delete(row)
            await s.commit()
        return GroupSummaryResult(status="sent", message_count=15)

    summarize.side_effect = delete_then_return
    recs = await run_due(SETTINGS, db_sessionmaker, MagicMock(), now=NOW)
    assert len(recs) == 1


async def test_run_holds_the_group_lock(db_sessionmaker, monkeypatch):
    from scheduling.locks import group_lock

    await seed(db_sessionmaker)
    held = []

    async def fake(settings, session, whatsapp, group):
        held.append(group_lock(group.group_jid).locked())
        return GroupSummaryResult(status="sent", message_count=15)

    monkeypatch.setattr(runner, "summarize_and_send_to_group", fake)
    await run_due(SETTINGS, db_sessionmaker, MagicMock(), now=NOW)
    assert held == [True]


async def test_hung_summary_times_out_releases_lock_and_next_schedule_runs(
    db_sessionmaker, monkeypatch
):
    from scheduling.locks import group_lock

    monkeypatch.setattr(runner, "SCHEDULED_RUN_TIMEOUT", 0.2)
    s1 = await seed(db_sessionmaker)
    s2 = await seed(db_sessionmaker)
    calls = 0

    async def fake(settings, session, whatsapp, group):
        nonlocal calls
        calls += 1
        if calls == 1:
            await asyncio.sleep(3600)
        return GroupSummaryResult(status="sent", message_count=16)

    monkeypatch.setattr(runner, "summarize_and_send_to_group", fake)
    recs = await asyncio.wait_for(
        run_due(SETTINGS, db_sessionmaker, MagicMock(), now=NOW), 5
    )
    assert sorted(r.status for r in recs) == ["failed", "sent"]
    failed = [r for r in recs if r.status == "failed"][0]
    assert failed.reason == "timeout"
    row = await load(db_sessionmaker, failed.schedule_id)
    assert (row.last_status, row.last_reason) == ("failed", "timeout")
    assert {s1, s2} == {r.schedule_id for r in recs}
    lock = group_lock("1@g.us")
    await asyncio.wait_for(lock.acquire(), 0.5)
    lock.release()


async def test_cancellation_still_propagates_through_timeout(
    db_sessionmaker, monkeypatch
):
    monkeypatch.setattr(runner, "SCHEDULED_RUN_TIMEOUT", 60)
    sid = await seed(db_sessionmaker)
    started = asyncio.Event()

    async def hang(*a, **k):
        started.set()
        await asyncio.sleep(3600)

    monkeypatch.setattr(runner, "summarize_and_send_to_group", hang)
    task = asyncio.create_task(
        runner._run_claimed(SETTINGS, db_sessionmaker, MagicMock(), sid, "1@g.us")
    )
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(task, 2)


async def test_plain_timeout_error_is_unexpected_not_timeout(
    db_sessionmaker, monkeypatch
):
    monkeypatch.setattr(runner, "SCHEDULED_RUN_TIMEOUT", 60)
    sid = await seed(db_sessionmaker)

    async def boom(*a, **k):
        raise TimeoutError("db connect")

    monkeypatch.setattr(runner, "summarize_and_send_to_group", boom)
    rec = await runner._run_claimed(
        SETTINGS, db_sessionmaker, MagicMock(), sid, "1@g.us"
    )
    assert (rec.status, rec.reason) == ("failed", "unexpected_error")
    assert "db connect" not in repr(rec)


async def test_lock_wait_timeout_records_lock_timeout_and_next_runs(
    db_sessionmaker, monkeypatch, summarize
):
    from scheduling.locks import group_lock

    monkeypatch.setattr(runner, "GROUP_LOCK_WAIT_TIMEOUT", 0.2)
    sid = await seed(db_sessionmaker)
    lock = group_lock("1@g.us")
    await lock.acquire()
    try:
        rec = await asyncio.wait_for(
            runner._run_claimed(SETTINGS, db_sessionmaker, MagicMock(), sid, "1@g.us"),
            5,
        )
        assert (rec.status, rec.reason) == ("failed", "lock_timeout")
        summarize.assert_not_awaited()
        assert lock.locked()  # the holder's lock is untouched
    finally:
        lock.release()
    # a later run proceeds normally
    rec = await runner._run_claimed(
        SETTINGS, db_sessionmaker, MagicMock(), sid, "1@g.us"
    )
    assert rec.status == "sent"


async def test_lock_wait_does_not_consume_run_budget(
    db_sessionmaker, monkeypatch, summarize
):
    from scheduling.locks import group_lock

    monkeypatch.setattr(runner, "GROUP_LOCK_WAIT_TIMEOUT", 5)
    monkeypatch.setattr(runner, "SCHEDULED_RUN_TIMEOUT", 0.5)
    sid = await seed(db_sessionmaker)
    lock = group_lock("1@g.us")
    await lock.acquire()
    task = asyncio.create_task(
        runner._run_claimed(SETTINGS, db_sessionmaker, MagicMock(), sid, "1@g.us")
    )
    await asyncio.sleep(0.8)  # longer than the run budget
    lock.release()
    rec = await asyncio.wait_for(task, 5)
    assert rec.status == "sent"
