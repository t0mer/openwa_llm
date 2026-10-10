"""Method-mismatch handling under logfire's FastAPI instrumentation.

opentelemetry-instrumentation-fastapi < 0.64b0 raised AttributeError on
`_IncludedRouter` for a path match with the wrong method, turning every 405
into a 500 and recording the raw URL as ``http.route``.
"""

import importlib.util
from pathlib import Path

from unittest.mock import AsyncMock, MagicMock

import logfire
import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient
from api.deps import get_db_async_session, get_whatsapp
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from whatsapp.jid import JID
from whatsapp.types import SessionStatus

MAIN = Path(__file__).resolve().parent.parent / "app" / "main.py"
GET_ONLY = [
    ("HEAD", "/status"),
    ("POST", "/status"),
    ("PUT", "/status"),
    ("DELETE", "/status"),
    ("PATCH", "/status"),
    ("OPTIONS", "/status"),
    ("HEAD", "/api/v1/admin/auth/session"),
]


@pytest.fixture(scope="module")
def exporter():
    return InMemorySpanExporter()


@pytest.fixture(scope="module")
def real_app(exporter):
    """The production app object, instrumented, with spans kept in memory."""
    original = logfire.configure

    def configure(**_kwargs):
        return original(
            send_to_logfire=False,
            console=False,
            metrics=False,
            additional_span_processors=[SimpleSpanProcessor(exporter)],
        )

    logfire.configure = configure
    try:
        spec = importlib.util.spec_from_file_location("otel_test_main", MAIN)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    finally:
        logfire.configure = original
    return module.app


@pytest.fixture
def client(real_app):
    whatsapp = AsyncMock()
    whatsapp.get_status = AsyncMock(
        return_value=SessionStatus(status="ready", phone="972559661780")
    )
    whatsapp.get_my_jid = AsyncMock(
        return_value=JID(user="972559661780", server="s.whatsapp.net")
    )
    whatsapp.get_my_lid = AsyncMock(return_value=None)
    result = MagicMock()
    result.fetchone.return_value = (2,)
    conn = AsyncMock()
    conn.execute = AsyncMock(return_value=result)
    session = AsyncMock()
    session.connection = AsyncMock(return_value=conn)
    real_app.dependency_overrides[get_whatsapp] = lambda: whatsapp
    real_app.dependency_overrides[get_db_async_session] = lambda: session
    # no context manager: skip the lifespan (DB, WhatsApp, scheduler)
    yield TestClient(real_app, raise_server_exceptions=False)
    real_app.dependency_overrides.clear()


def server_spans(exporter, method: str) -> list[ReadableSpan]:
    return [
        s
        for s in exporter.get_finished_spans()
        if (s.attributes or {}).get("http.request.method", "") == method
        or (s.attributes or {}).get("http.method", "") == method
    ]


@pytest.mark.parametrize(("method", "path"), GET_ONLY)
def test_method_mismatch_is_405_not_500(client, method, path):
    resp = client.request(method, path)
    assert resp.status_code == 405
    assert "GET" in resp.headers["allow"]
    if method == "HEAD":
        assert resp.content == b""


def test_get_still_works_and_records_route_template(client, exporter):
    exporter.clear()
    resp = client.get("/status")
    assert resp.status_code == 200
    spans = [
        s
        for s in server_spans(exporter, "GET")
        if (s.attributes or {}).get("http.route") == "/status"
    ]
    assert spans, [dict(s.attributes or {}) for s in exporter.get_finished_spans()]


def test_head_openapi_json_still_200(client):
    assert client.head("/openapi.json").status_code == 200


@pytest.fixture
def items_app(exporter):
    # instrument a fresh app so a parameterised included route is covered
    app = FastAPI()
    router = APIRouter()

    @router.get("/items/{item_id}")
    async def read_item(item_id: int):
        return {"id": item_id}

    app.include_router(router)
    logfire.instrument_fastapi(app)
    return TestClient(app, raise_server_exceptions=False)


def test_parameterised_route_records_template(items_app, exporter, real_app):
    exporter.clear()
    assert items_app.get("/items/7").status_code == 200
    routes = {
        (s.attributes or {}).get("http.route") for s in exporter.get_finished_spans()
    }
    assert "/items/{item_id}" in routes


def test_parameterised_405_is_traced(items_app, exporter, real_app):
    exporter.clear()
    resp = items_app.post("/items/7")
    assert resp.status_code == 405
    spans = [
        s
        for s in exporter.get_finished_spans()
        if (s.attributes or {}).get("http.response.status_code") == 405
        or (s.attributes or {}).get("http.status_code") == 405
    ]
    assert spans
