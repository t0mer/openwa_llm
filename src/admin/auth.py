from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from typing import Annotated, Callable

from fastapi import Depends, HTTPException, Request

from config import Settings, get_settings

SESSION_COOKIE = "admin_session"
SESSION_TTL_SECONDS = 12 * 60 * 60
CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "admin-ui"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
LOGIN_MAX_FAILURES = 5
LOGIN_WINDOW_SECONDS = 60
_CLOCK_SKEW_SECONDS = 30


def admin_enabled(settings: Settings) -> bool:
    return bool(settings.admin_password and settings.admin_session_secret)


def admin_config_warning(settings: Settings) -> str | None:
    """Warning text when only one of the two admin settings is set, else None."""
    has_password = bool(settings.admin_password)
    has_secret = bool(settings.admin_session_secret)
    if has_password == has_secret:
        return None
    missing = "ADMIN_SESSION_SECRET" if has_password else "ADMIN_PASSWORD"
    return (
        f"Admin UI is disabled: {missing} is not set. "
        "Set both ADMIN_PASSWORD and ADMIN_SESSION_SECRET to enable it."
    )


def _sign(secret: str, payload: str) -> str:
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def create_session_token(secret: str, now: float | None = None) -> str:
    issued = int(time.time() if now is None else now)
    payload = f"{issued}.{secrets.token_urlsafe(16)}"
    return f"{payload}.{_sign(secret, payload)}"


def verify_session_token(
    secret: str | None, token: str | None, now: float | None = None
) -> bool:
    """True only for a token we signed that has not expired. Fails closed."""
    if not secret or not token:
        return False
    payload, sep, signature = token.rpartition(".")
    if not sep or not payload:
        return False
    try:
        expected = _sign(secret, payload).encode("utf-8")
        provided = signature.encode("utf-8")
    except UnicodeEncodeError:  # e.g. lone surrogates in a hostile cookie
        return False
    if not hmac.compare_digest(expected, provided):
        return False
    issued_text, dot, _nonce = payload.partition(".")
    if not dot:
        return False
    try:
        issued = int(issued_text)
    except ValueError:
        return False
    age = (time.time() if now is None else now) - issued
    return -_CLOCK_SKEW_SECONDS <= age <= SESSION_TTL_SECONDS


class LoginRateLimiter:
    """In-memory failed-login limiter keyed by client IP."""

    _MAX_KEYS = 10_000

    def __init__(
        self,
        max_failures: int = LOGIN_MAX_FAILURES,
        window: float = LOGIN_WINDOW_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._max = max_failures
        self._window = window
        self._clock = clock
        self._failures: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, key: str) -> deque[float]:
        failures = self._failures[key]
        cutoff = self._clock() - self._window
        while failures and failures[0] <= cutoff:
            failures.popleft()
        if not failures:
            self._failures.pop(key, None)
            return deque()
        return failures

    def allowed(self, key: str) -> bool:
        return len(self._prune(key)) < self._max

    def record_failure(self, key: str) -> None:
        if len(self._failures) >= self._MAX_KEYS:
            self._failures.clear()
        self._prune(key)
        self._failures[key].append(self._clock())

    def reset(self, key: str) -> None:
        self._failures.pop(key, None)

    def reset_all(self) -> None:
        self._failures.clear()


login_limiter = LoginRateLimiter()


def require_enabled(
    settings: Annotated[Settings, Depends(get_settings)],
) -> Settings:
    if not admin_enabled(settings):
        raise HTTPException(status_code=404, detail="Not Found")
    return settings


def require_csrf(request: Request) -> None:
    if (
        request.method not in SAFE_METHODS
        and request.headers.get(CSRF_HEADER) != CSRF_VALUE
    ):
        raise HTTPException(status_code=403, detail="missing CSRF header")


def is_authenticated(request: Request, settings: Settings) -> bool:
    return verify_session_token(
        settings.admin_session_secret, request.cookies.get(SESSION_COOKIE)
    )


def require_admin(
    request: Request,
    settings: Annotated[Settings, Depends(require_enabled)],
) -> None:
    if not is_authenticated(request, settings):
        raise HTTPException(status_code=401, detail="not authenticated")
    require_csrf(request)
