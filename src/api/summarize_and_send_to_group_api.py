import logging
from typing import Annotated, Any, Dict

from fastapi import APIRouter, Depends, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from config import Settings
from summarize_and_send_to_groups import summarize_and_send_to_groups
from whatsapp import WhatsAppGateway
from .deps import get_requested_session_ids, get_settings, run_for_sessions

# Create router for send summaries to groups endpoints
router = APIRouter()

# Configure logger for this module
logger = logging.getLogger(__name__)


@router.post("/summarize_and_send_to_groups")
async def trigger_summarize_and_send_to_groups(
    request: Request,
    session_ids: Annotated[list[str], Depends(get_requested_session_ids)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Dict[str, Any]:
    """
    Trigger a send summaries to groups sync for managed groups.

    Runs for the session given by `?session_id=` (404 when not active), or for
    every active session when omitted. For each session it will:
    1. Find the session's managed groups
    2. Check for new messages since last summary
    3. Generate AI summaries for groups with enough new messages
    4. Send summaries to the groups and related community groups
    5. Update the last_summary_sync timestamp

    One failing session does not stop the others; the response lists each
    session's outcome ("ok" / "failed"). 500 only when every session failed.
    """
    logger.info("Starting manual send summaries to groups sync via API")

    async def job(db: AsyncSession, whatsapp: WhatsAppGateway, session_id: str):
        await summarize_and_send_to_groups(settings, db, whatsapp, session_id)

    sessions = await run_for_sessions(request, session_ids, job)
    logger.info("send summaries to groups sync completed: %s", sessions)
    return {
        "status": "success",
        "message": "send summaries to groups sync completed successfully",
        "sessions": sessions,
    }
