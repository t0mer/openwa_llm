"""Every non-auth admin route must be protected by the admin dependencies."""

import re
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from admin.auth import CSRF_HEADER, CSRF_VALUE, SESSION_COOKIE, create_session_token
from admin.router import build_admin_router
from api.deps import get_db_async_session
from config import get_settings

SECRET = "s" * 32
PREFIX = "/api/v1/admin"
EXPECTED_PREFIXES = {
    "/groups",
    "/contacts",
    "/opt-outs",
    "/messages",
    "/actions",
    "/stats",
}
MIN_ROUTES = 12


def _enabled_settings():
    return SimpleNamespace(
        admin_password="pw", admin_session_secret=SECRET, admin_cookie_secure=False
    )


def _disabled_settings():
    return SimpleNamespace(
        admin_password=None, admin_session_secret=None, admin_cookie_secure=False
    )


async def _unreachable_db():
    raise AssertionError("handler dependencies must not run before admin guards")
    yield  # pragma: no cover


def _protected_endpoints() -> list[tuple[str, str]]:
    # router.routes only holds lazily-included sub-routers, so enumerate the
    # flattened route table through the app's OpenAPI schema instead.
    app = FastAPI()
    app.include_router(build_admin_router())
    endpoints: list[tuple[str, str]] = []
    prefixes: set[str] = set()
    for path, operations in app.openapi()["paths"].items():
        assert path.startswith(PREFIX + "/"), path
        if path.startswith(f"{PREFIX}/auth/"):
            continue
        prefixes.add("/" + path[len(PREFIX) + 1 :].split("/")[0])
        dummy = re.sub(r"\{[^}]+\}", "x", path)
        for method in operations:
            endpoints.append((method.upper(), dummy))
    assert len(endpoints) >= MIN_ROUTES, f"too few routes found: {endpoints}"
    assert EXPECTED_PREFIXES <= prefixes, f"missing prefixes: {prefixes}"
    return sorted(endpoints)


ENDPOINTS = _protected_endpoints()


def _app(settings) -> FastAPI:
    app = FastAPI()
    app.include_router(build_admin_router())
    app.dependency_overrides[get_settings] = settings
    app.dependency_overrides[get_db_async_session] = _unreachable_db
    return app


def _client(settings, *, cookie: bool, csrf: bool) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=_app(settings)),
        base_url="http://test",
        headers={CSRF_HEADER: CSRF_VALUE} if csrf else {},
        cookies={SESSION_COOKIE: create_session_token(SECRET)} if cookie else {},
    )


def test_route_enumeration_is_substantial():
    assert {m for m, _ in ENDPOINTS} >= {"GET", "POST"}


@pytest.mark.parametrize(("method", "path"), ENDPOINTS)
async def test_no_cookie_is_401(method, path):
    async with _client(_enabled_settings, cookie=False, csrf=True) as c:
        assert (await c.request(method, path)).status_code == 401


@pytest.mark.parametrize(
    ("method", "path"), [(m, p) for m, p in ENDPOINTS if m not in ("GET",)]
)
async def test_missing_csrf_header_is_403(method, path):
    async with _client(_enabled_settings, cookie=True, csrf=False) as c:
        assert (await c.request(method, path)).status_code == 403


@pytest.mark.parametrize(("method", "path"), ENDPOINTS)
async def test_admin_disabled_is_404(method, path):
    async with _client(_disabled_settings, cookie=True, csrf=True) as c:
        assert (await c.request(method, path)).status_code == 404
