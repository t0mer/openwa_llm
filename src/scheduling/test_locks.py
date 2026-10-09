import asyncio

from scheduling.locks import group_lock


def _contend(jid: str) -> asyncio.Lock:
    """Make `jid`'s lock contended inside a fresh event loop (binds it to it)."""

    async def main() -> asyncio.Lock:
        lock = group_lock(jid)
        await lock.acquire()
        waiter = asyncio.create_task(lock.acquire())
        await asyncio.sleep(0)  # let the waiter queue up
        lock.release()
        await waiter
        lock.release()
        return lock

    return asyncio.run(main())


def test_same_loop_gets_the_same_lock_while_in_use():
    async def main():
        a = group_lock("x@g.us")
        assert group_lock("x@g.us") is a
        assert group_lock("y@g.us") is not a

    asyncio.run(main())


def test_lock_from_another_event_loop_is_never_reused():
    # A strong reference to a lock bound to a finished loop must not leak into
    # the next loop (RuntimeError "is bound to a different event loop").
    stale = _contend("loop@g.us")

    async def main():
        lock = group_lock("loop@g.us")
        assert lock is not stale
        await lock.acquire()
        waiter = asyncio.create_task(lock.acquire())
        await asyncio.sleep(0)
        lock.release()
        await asyncio.wait_for(waiter, 1)
        lock.release()

    asyncio.run(main())
