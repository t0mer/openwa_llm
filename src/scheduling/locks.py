"""Per-group async locks shared by every code path that summarizes a group."""

import asyncio
from weakref import WeakValueDictionary

_locks: WeakValueDictionary[str, asyncio.Lock] = WeakValueDictionary()


def group_lock(group_jid: str) -> asyncio.Lock:
    """Return the process-wide lock for `group_jid` (same object while in use)."""
    lock = _locks.get(group_jid)
    if lock is None:
        lock = asyncio.Lock()
        _locks[group_jid] = lock
    return lock
