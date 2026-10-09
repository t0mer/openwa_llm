"""Per-group async locks shared by every code path that summarizes a group."""

import asyncio
from weakref import WeakKeyDictionary, WeakValueDictionary

# One registry per running event loop: an asyncio.Lock binds to the loop that
# first contends it, so a lock must never be handed to a different loop (tests,
# reloads). Entries vanish with the loop / when nobody uses the lock any more.
_locks: WeakKeyDictionary[
    asyncio.AbstractEventLoop, WeakValueDictionary[str, asyncio.Lock]
] = WeakKeyDictionary()


def group_lock(group_jid: str) -> asyncio.Lock:
    """Return the lock for `group_jid` on the running loop (same object while in use)."""
    registry = _locks.setdefault(asyncio.get_running_loop(), WeakValueDictionary())
    lock = registry.get(group_jid)
    if lock is None:
        lock = asyncio.Lock()
        registry[group_jid] = lock
    return lock
