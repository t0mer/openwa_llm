from fastapi import APIRouter, Depends

from . import auth_routes, groups
from .auth import require_admin


def build_admin_router() -> APIRouter:
    """Build the /api/v1/admin router. Later tasks add their routers where marked."""
    protected = APIRouter(dependencies=[Depends(require_admin)])
    protected.include_router(groups.router, prefix="/groups")
    # later tasks: protected.include_router(<module>.router, prefix="/<name>")
    router = APIRouter(prefix="/api/v1/admin", tags=["admin"])
    router.include_router(auth_routes.router)
    router.include_router(protected)
    return router


admin_router = build_admin_router()
