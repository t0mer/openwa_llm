from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from config import Settings, get_settings

from .auth import admin_enabled

router = APIRouter(include_in_schema=False)

STATIC_DIR = Path(__file__).parent / "static" / "dist"


SECURITY_HEADERS = {
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
}


def _asset(path: Path) -> FileResponse:
    return FileResponse(path, headers=SECURITY_HEADERS)


def _index(path: Path) -> FileResponse:
    return FileResponse(path, headers={**SECURITY_HEADERS, "Cache-Control": "no-cache"})


def _file_or_index(path: str) -> FileResponse:
    root = STATIC_DIR.resolve()
    index = root / "index.html"
    if not index.is_file():
        raise HTTPException(status_code=404, detail="Not Found")
    if path:
        try:
            candidate = (root / path).resolve()
            if candidate.is_relative_to(root) and candidate.is_file():
                return _asset(candidate)
        except (ValueError, OSError):  # e.g. NUL bytes, over-long names
            raise HTTPException(status_code=404, detail="Not Found") from None
        if "." in Path(path).name:  # looks like a file request: no SPA fallback
            raise HTTPException(status_code=404, detail="Not Found")
    return _index(index)


@router.get("/admin")
@router.get("/admin/{path:path}")
async def serve_admin(
    settings: Annotated[Settings, Depends(get_settings)],
    path: str = "",
) -> FileResponse:
    if not admin_enabled(settings):
        raise HTTPException(status_code=404, detail="Not Found")
    return _file_or_index(path)
