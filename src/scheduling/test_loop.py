import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from scheduling import runner


class _Registry:
    def __init__(self, ids):
        self._ids = ids

    def ids(self):
        return list(self._ids)

    def get(self, pk):
        return MagicMock(name=pk)


def _app(enabled=True, ids=("s1",)):
    return SimpleNamespace(
        state=SimpleNamespace(
            settings=SimpleNamespace(scheduler_enabled=enabled),
            async_session=MagicMock(),
            registry=_Registry(ids),
        )
    )


async def test_loop_survives_tick_failures_and_keeps_ticking(monkeypatch):
    calls = 0
    done = asyncio.Event()

    async def fake_run_due(settings, factory, registry, now=None):
        nonlocal calls
        calls += 1
        if calls >= 3:
            done.set()
        if calls == 1:
            raise RuntimeError("tick boom")
        return []

    monkeypatch.setattr(runner, "run_due", fake_run_due)
    task = asyncio.create_task(runner.scheduler_loop(_app(), interval=0.001))
    await asyncio.wait_for(done.wait(), 2)
    assert not task.done()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


async def test_loop_cancels_promptly_during_a_tick(monkeypatch):
    started = asyncio.Event()

    async def slow(*a, **k):
        started.set()
        await asyncio.sleep(60)

    monkeypatch.setattr(runner, "run_due", slow)
    task = asyncio.create_task(runner.scheduler_loop(_app(), interval=60))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(task, 1)


async def test_start_scheduler_disabled_starts_nothing(monkeypatch):
    loop = AsyncMock()
    monkeypatch.setattr(runner, "scheduler_loop", loop)
    assert runner.start_scheduler(_app(enabled=False)) is None
    loop.assert_not_called()


async def test_start_scheduler_enabled_returns_running_task(monkeypatch):
    monkeypatch.setattr(runner, "run_due", AsyncMock(return_value=[]))
    task = runner.start_scheduler(_app(), interval=0.001)
    assert task is not None
    await asyncio.sleep(0.01)
    assert not task.done()
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)


async def test_loop_skips_ticks_without_an_active_session(monkeypatch, caplog):
    run_due = AsyncMock()
    monkeypatch.setattr(runner, "run_due", run_due)
    task = asyncio.create_task(runner.scheduler_loop(_app(ids=()), interval=0.001))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    run_due.assert_not_awaited()
    assert "no active OpenWA session" in caplog.text


async def test_loop_passes_the_registry(monkeypatch):
    seen = asyncio.Event()
    app = _app()

    async def fake_run_due(settings, factory, registry, now=None):
        assert registry is app.state.registry
        seen.set()
        return []

    monkeypatch.setattr(runner, "run_due", fake_run_due)
    task = asyncio.create_task(runner.scheduler_loop(app, interval=0.001))
    await asyncio.wait_for(seen.wait(), 2)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)


async def _run_ticks(app, ticks: int) -> None:
    """Run the loop until it has checked for sessions `ticks` times, then cancel."""
    registry = app.state.registry
    real_ids = registry.ids
    calls = 0

    def counting_ids():
        nonlocal calls
        calls += 1
        return real_ids()

    registry.ids = counting_ids
    task = asyncio.create_task(runner.scheduler_loop(app, interval=0))
    try:
        for _ in range(1000):
            if calls >= ticks:
                break
            await asyncio.sleep(0)
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    assert calls >= ticks


async def test_no_session_warning_is_logged_once_then_debug(monkeypatch, caplog):
    import logging

    monkeypatch.setattr(runner, "run_due", AsyncMock())
    app = _app(ids=())
    caplog.set_level(logging.DEBUG, logger=runner.logger.name)
    await _run_ticks(app, 3)
    skips = [r for r in caplog.records if "no active OpenWA session" in r.message]
    assert [r.levelno for r in skips[:3]] == [
        logging.WARNING,
        logging.DEBUG,
        logging.DEBUG,
    ]


async def test_no_session_warning_repeats_after_a_session_was_active(
    monkeypatch, caplog
):
    import logging

    monkeypatch.setattr(runner, "run_due", AsyncMock())

    class Flapping:
        """No session, then one, then none again."""

        states = iter([(), ("s1",), (), ()])

        def ids(self):
            return list(next(self.states, ()))

    app = _app()
    app.state.registry = Flapping()
    caplog.set_level(logging.DEBUG, logger=runner.logger.name)
    await _run_ticks(app, 4)
    skips = [r for r in caplog.records if "no active OpenWA session" in r.message]
    assert [r.levelno for r in skips[:3]] == [
        logging.WARNING,
        logging.WARNING,
        logging.DEBUG,
    ]
