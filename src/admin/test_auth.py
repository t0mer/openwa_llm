from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from fastapi import APIRouter, Depends

from admin import auth
from admin.router import build_admin_router
from config import get_settings

SECRET = "s" * 32
HDR = {"X-Requested-With": "admin-ui"}


def make_settings(**overrides):
    base = dict(
        admin_password="pw", admin_session_secret=SECRET, admin_cookie_secure=False
    )
    base.update(overrides)
    return SimpleNamespace(**base)


@pytest.fixture(autouse=True)
def _reset_limiter():
    auth.login_limiter.reset_all()


def _probe_router() -> APIRouter:
    probe = APIRouter(dependencies=[Depends(auth.require_admin)])

    async def ok() -> dict:
        return {"ok": True}

    probe.add_api_route("/_probe", ok, methods=["GET", "POST"])
    return probe


@pytest.fixture
def make_client():
    def _make(settings=None):
        router = build_admin_router()
        router.include_router(_probe_router())  # a stand-in protected route
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_settings] = lambda: settings or make_settings()
        return TestClient(app)

    return _make


# --- token ---------------------------------------------------------------


def test_token_roundtrip_and_expiry():
    token = auth.create_session_token(SECRET, now=1000)
    assert auth.verify_session_token(SECRET, token, now=1000)
    assert auth.verify_session_token(SECRET, token, now=1000 + auth.SESSION_TTL_SECONDS)
    assert not auth.verify_session_token(
        SECRET, token, now=1000 + auth.SESSION_TTL_SECONDS + 1
    )


def test_token_rejects_tampering_wrong_secret_and_garbage():
    token = auth.create_session_token(SECRET, now=1000)
    payload, _, sig = token.rpartition(".")
    assert not auth.verify_session_token("x" * 32, token, now=1000)
    assert not auth.verify_session_token(
        SECRET, payload + "." + "0" * len(sig), now=1000
    )
    assert not auth.verify_session_token(
        SECRET, "9999." + token.split(".", 1)[1], now=1000
    )
    for bad in ("", "nodots", ".", "a.b", "é.é.é", None):
        assert not auth.verify_session_token(SECRET, bad, now=1000)
    assert not auth.verify_session_token("", token, now=1000)
    assert not auth.verify_session_token(None, token, now=1000)


def test_token_issued_in_the_future_is_rejected():
    token = auth.create_session_token(SECRET, now=10_000)
    assert not auth.verify_session_token(SECRET, token, now=1000)


# --- rate limiter -----------------------------------------------------------


def test_rate_limiter_blocks_after_max_failures_and_recovers():
    clock = {"t": 0.0}
    limiter = auth.LoginRateLimiter(max_failures=3, window=60, clock=lambda: clock["t"])
    for _ in range(3):
        assert limiter.allowed("ip")
        limiter.record_failure("ip")
    assert not limiter.allowed("ip")
    assert limiter.allowed("other")
    clock["t"] = 61
    assert limiter.allowed("ip")
    limiter.record_failure("ip")
    limiter.reset("ip")
    assert limiter.allowed("ip")


# --- routes -----------------------------------------------------------------


def test_disabled_admin_returns_404_everywhere(make_client):
    client = make_client(make_settings(admin_password=None))
    assert (
        client.post(
            "/api/v1/admin/auth/login", json={"password": "pw"}, headers=HDR
        ).status_code
        == 404
    )
    assert client.get("/api/v1/admin/auth/session").status_code == 404
    client = make_client(make_settings(admin_session_secret=""))
    assert client.get("/api/v1/admin/auth/session").status_code == 404


def test_login_success_sets_hardened_cookie(make_client):
    client = make_client(make_settings(admin_cookie_secure=True))
    resp = client.post("/api/v1/admin/auth/login", json={"password": "pw"}, headers=HDR)
    assert resp.status_code == 204
    cookie = resp.headers["set-cookie"].lower()
    assert "admin_session=" in cookie
    assert "httponly" in cookie and "samesite=strict" in cookie and "secure" in cookie
    assert "path=/" in cookie
    assert f"max-age={auth.SESSION_TTL_SECONDS}" in cookie


def test_login_wrong_password_401_without_cookie(make_client):
    client = make_client()
    resp = client.post(
        "/api/v1/admin/auth/login", json={"password": "nope"}, headers=HDR
    )
    assert resp.status_code == 401
    assert "set-cookie" not in resp.headers


def test_login_requires_csrf_header(make_client):
    client = make_client()
    resp = client.post("/api/v1/admin/auth/login", json={"password": "pw"})
    assert resp.status_code == 403


def test_login_is_rate_limited(make_client):
    client = make_client()
    for _ in range(auth.LOGIN_MAX_FAILURES):
        assert (
            client.post(
                "/api/v1/admin/auth/login", json={"password": "x"}, headers=HDR
            ).status_code
            == 401
        )
    resp = client.post("/api/v1/admin/auth/login", json={"password": "pw"}, headers=HDR)
    assert resp.status_code == 429
    assert resp.headers["retry-after"] == str(auth.LOGIN_WINDOW_SECONDS)


def test_successful_login_resets_failure_count(make_client):
    client = make_client()
    for _ in range(auth.LOGIN_MAX_FAILURES - 1):
        client.post("/api/v1/admin/auth/login", json={"password": "x"}, headers=HDR)
    assert (
        client.post(
            "/api/v1/admin/auth/login", json={"password": "pw"}, headers=HDR
        ).status_code
        == 204
    )
    for _ in range(auth.LOGIN_MAX_FAILURES - 1):
        assert (
            client.post(
                "/api/v1/admin/auth/login", json={"password": "x"}, headers=HDR
            ).status_code
            == 401
        )


def test_non_ascii_and_oversized_passwords_do_not_crash(make_client):
    client = make_client()
    assert (
        client.post(
            "/api/v1/admin/auth/login", json={"password": "pé"}, headers=HDR
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/v1/admin/auth/login", json={"password": "x" * 5000}, headers=HDR
        ).status_code
        == 422
    )


def test_session_endpoint_reports_authentication(make_client):
    client = make_client()
    assert client.get("/api/v1/admin/auth/session").json() == {"authenticated": False}
    client.post("/api/v1/admin/auth/login", json={"password": "pw"}, headers=HDR)
    assert client.get("/api/v1/admin/auth/session").json() == {"authenticated": True}
    client.cookies.set("admin_session", "tampered")
    assert client.get("/api/v1/admin/auth/session").json() == {"authenticated": False}


def test_logout_clears_cookie_and_needs_csrf(make_client):
    client = make_client()
    client.post("/api/v1/admin/auth/login", json={"password": "pw"}, headers=HDR)
    assert client.post("/api/v1/admin/auth/logout").status_code == 403
    resp = client.post("/api/v1/admin/auth/logout", headers=HDR)
    assert resp.status_code == 204
    assert "admin_session=" in resp.headers["set-cookie"]
    assert client.get("/api/v1/admin/auth/session").json() == {"authenticated": False}


# --- protected routes -------------------------------------------------------


def test_protected_routes_need_valid_session_then_csrf(make_client):
    client = make_client()
    assert client.get("/api/v1/admin/_probe").status_code == 401
    client.cookies.set(
        "admin_session", auth.create_session_token(SECRET, now=1)
    )  # long expired
    assert client.get("/api/v1/admin/_probe").status_code == 401
    client.post("/api/v1/admin/auth/login", json={"password": "pw"}, headers=HDR)
    assert client.get("/api/v1/admin/_probe").status_code == 200
    assert client.post("/api/v1/admin/_probe").status_code == 403
    assert client.post("/api/v1/admin/_probe", headers=HDR).status_code == 200


def test_protected_routes_404_when_disabled(make_client):
    client = make_client(make_settings(admin_password=None))
    assert client.get("/api/v1/admin/_probe").status_code == 404
