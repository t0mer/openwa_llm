from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException, Request

from config import Settings, get_settings
from load_new_kbtopics import topicsLoader
from summarize_and_send_to_groups import summarize_and_send_to_groups

from .schemas import ActionStarted, ActionStatus

logger = logging.getLogger(__name__)
router = APIRouter(tags=["admin-actions"])

ACTION_NAMES = ("summarize", "load_kb")
_MAX_ERROR_LEN = 300


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ActionRunner:
    """Runs at most one background job per named action (in memory, per process)."""

    def __init__(self) -> None:
        self._status = {name: ActionStatus(state="idle") for name in ACTION_NAMES}
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def status(self) -> dict[str, ActionStatus]:
        return {name: s.model_copy() for name, s in self._status.items()}

    def start(self, name: str, job: Callable[[], Awaitable[None]]) -> str | None:
        if self._status[name].state == "running":
            return None
        job_id = uuid.uuid4().hex
        self._status[name] = ActionStatus(state="running", started_at=_now())
        self._tasks[name] = asyncio.create_task(self._run(name, job))
        return job_id

    async def _run(self, name: str, job: Callable[[], Awaitable[None]]) -> None:
        started = self._status[name].started_at
        try:
            await job()
        except asyncio.CancelledError:
            self._status[name] = ActionStatus(
                state="failed",
                started_at=started,
                finished_at=_now(),
                error="cancelled",
            )
            raise
        except Exception as e:
            logger.exception("Admin action %s failed", name)
            self._status[name] = ActionStatus(
                state="failed",
                started_at=started,
                finished_at=_now(),
                error=f"{type(e).__name__}: {e}"[:_MAX_ERROR_LEN],
            )
        else:
            self._status[name] = ActionStatus(
                state="succeeded", started_at=started, finished_at=_now()
            )

    async def wait_idle(self) -> None:
        await asyncio.gather(*self._tasks.values(), return_exceptions=True)

    async def shutdown(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        await asyncio.gather(*self._tasks.values(), return_exceptions=True)


runner = ActionRunner()


@router.get("", response_model=dict[str, ActionStatus])
async def get_actions() -> dict[str, ActionStatus]:
    return runner.status()


@router.post("/summarize", response_model=ActionStarted, status_code=202)
async def run_summarize(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> ActionStarted:
    app = request.app

    async def job() -> None:
        async with app.state.async_session() as session:
            await summarize_and_send_to_groups(settings, session, app.state.whatsapp)
            await session.commit()

    job_id = runner.start("summarize", job)
    if job_id is None:
        raise HTTPException(status_code=409, detail="summarize is already running")
    return ActionStarted(job_id=job_id)


@router.post("/load-kb", response_model=ActionStarted, status_code=202)
async def run_load_kb(request: Request) -> ActionStarted:
    app = request.app

    async def job() -> None:
        async with app.state.async_session() as session:
            await topicsLoader().load_topics_for_all_groups(
                session, app.state.embedding_client, app.state.whatsapp
            )
            await session.commit()

    job_id = runner.start("load_kb", job)
    if job_id is None:
        raise HTTPException(status_code=409, detail="load-kb is already running")
    return ActionStarted(job_id=job_id)
