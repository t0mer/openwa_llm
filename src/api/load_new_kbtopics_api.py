import logging
from typing import Annotated, Any, Dict

from fastapi import APIRouter, Depends, Request
from sqlmodel.ext.asyncio.session import AsyncSession
from voyageai.client_async import AsyncClient

from load_new_kbtopics import topicsLoader
from whatsapp import WhatsAppGateway
from .deps import get_requested_session_ids, get_text_embebedding, run_for_sessions

router = APIRouter()

# Configure logger for this module
logger = logging.getLogger(__name__)


@router.post("/load_new_kbtopics")
async def load_new_kbtopics_api(
    request: Request,
    session_ids: Annotated[list[str], Depends(get_requested_session_ids)],
    embedding_client: Annotated[AsyncClient, Depends(get_text_embebedding)],
) -> Dict[str, Any]:
    """
    Trigger load new kbtopics for managed groups.

    Runs for the session given by `?session_id=` (404 when not active), or for
    every active session when omitted; one failing session does not stop the
    others. 500 only when every session failed.
    """
    logger.info("Starting load new kbtopics sync via API")

    async def job(db: AsyncSession, whatsapp: WhatsAppGateway, session_id: str):
        await topicsLoader().load_topics_for_all_groups(
            db, embedding_client, whatsapp, session_id
        )

    sessions = await run_for_sessions(request, session_ids, job)
    logger.info("load new kbtopics sync completed: %s", sessions)
    return {
        "status": "success",
        "message": "load new kbtopics sync completed successfully",
        "sessions": sessions,
    }
