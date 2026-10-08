from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from config import Settings

from .auth import (
    LOGIN_WINDOW_SECONDS,
    SESSION_COOKIE,
    SESSION_TTL_SECONDS,
    create_session_token,
    is_authenticated,
    login_limiter,
    require_csrf,
    require_enabled,
)

router = APIRouter(prefix="/auth", tags=["admin-auth"])


class LoginRequest(BaseModel):
    password: str = Field(max_length=1024)


class SessionOut(BaseModel):
    authenticated: bool


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/login", status_code=204)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(require_enabled)],
) -> None:
    require_csrf(request)
    ip = _client_ip(request)
    if not login_limiter.allowed(ip):
        raise HTTPException(
            status_code=429,
            detail="too many attempts",
            headers={"Retry-After": str(LOGIN_WINDOW_SECONDS)},
        )
    assert settings.admin_password and settings.admin_session_secret
    if not hmac.compare_digest(
        body.password.encode("utf-8"), settings.admin_password.encode("utf-8")
    ):
        login_limiter.record_failure(ip)
        raise HTTPException(status_code=401, detail="invalid password")
    login_limiter.reset(ip)
    response.set_cookie(
        SESSION_COOKIE,
        create_session_token(settings.admin_session_secret),
        max_age=SESSION_TTL_SECONDS,
        httponly=True,
        samesite="strict",
        secure=settings.admin_cookie_secure,
        path="/",
    )


@router.post("/logout", status_code=204)
async def logout(
    request: Request,
    response: Response,
    _settings: Annotated[Settings, Depends(require_enabled)],
) -> None:
    require_csrf(request)
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/session", response_model=SessionOut)
async def session_status(
    request: Request,
    settings: Annotated[Settings, Depends(require_enabled)],
) -> SessionOut:
    return SessionOut(authenticated=is_authenticated(request, settings))
