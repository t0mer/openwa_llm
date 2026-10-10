from fastapi import APIRouter, Depends

from . import (
    actions,
    auth_routes,
    contacts,
    groups,
    messages,
    optouts,
    schedules,
    stats,
)
from .auth import require_admin
from .guards import reject_nul_chars


def build_admin_router() -> APIRouter:
    """Build the /api/v1/admin router. Later tasks add their routers where marked."""
    protected = APIRouter(
        dependencies=[Depends(require_admin), Depends(reject_nul_chars)]
    )
    protected.include_router(groups.router, prefix="/groups")
    protected.include_router(schedules.router, prefix="/groups")
    protected.include_router(contacts.router, prefix="/contacts")
    protected.include_router(optouts.router, prefix="/opt-outs")
    protected.include_router(messages.router, prefix="/messages")
    protected.include_router(actions.router, prefix="/actions")
    protected.include_router(stats.router, prefix="/stats")
    # later tasks: protected.include_router(<module>.router, prefix="/<name>")
    router = APIRouter(prefix="/api/v1/admin", tags=["admin"])
    router.include_router(auth_routes.router)
    router.include_router(protected)
    return router


admin_router = build_admin_router()
