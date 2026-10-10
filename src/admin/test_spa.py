from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

from admin import spa
from config import get_settings


def enabled():
    return SimpleNamespace(admin_password="pw", admin_session_secret="s" * 32)


@pytest.fixture
def dist(tmp_path, monkeypatch):
    root = tmp_path / "dist"
    root.mkdir()
    (root / "assets").mkdir()
    (root / "index.html").write_text("<html>spa</html>")
    (root / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path / "secret.txt").write_text("top secret")
    monkeypatch.setattr(spa, "STATIC_DIR", root)
    return root


def make_client(settings=None, instrument=False):
    app = FastAPI()
    app.include_router(spa.router)
    if instrument:  # production runs logfire/OTel FastAPI instrumentation
        FastAPIInstrumentor.instrument_app(app)
    app.dependency_overrides[get_settings] = lambda: settings or enabled()
    return TestClient(app)


def test_serves_index_for_root_and_unknown_client_routes(dist):
    client = make_client()
    for path in ("/admin", "/admin/", "/admin/groups", "/admin/groups/deep/link"):
        resp = client.get(path)
        assert resp.status_code == 200 and "spa" in resp.text


def test_serves_real_asset_files(dist):
    resp = make_client().get("/admin/assets/app.js")
    assert resp.status_code == 200 and "console.log" in resp.text


def test_missing_asset_files_do_not_fall_back_to_index(dist):
    assert make_client().get("/admin/assets/missing.js").status_code == 404


@pytest.mark.parametrize(
    "path",
    [
        "/admin/../secret.txt",
        "/admin/%2e%2e/secret.txt",
        "/admin/..%2fsecret.txt",
        "/admin/assets/../../secret.txt",
        "/admin//etc/passwd",
    ],
)
def test_path_traversal_never_leaks_files(dist, path):
    resp = make_client().get(path)
    assert "top secret" not in resp.text
    assert resp.status_code in (200, 404)
    if resp.status_code == 200:
        assert "spa" in resp.text  # only ever the index page


@pytest.mark.parametrize(
    "path",
    [
        "../secret.txt",
        "assets/../../secret.txt",
        "..%2fsecret.txt",
        "/etc/passwd",
        "//etc/passwd",
        "assets/app.js\x00.png",
        "\x00",
    ],
)
def test_handler_rejects_hostile_paths_directly(dist, path):
    try:
        resp = spa._file_or_index(path)
    except HTTPException as exc:
        assert exc.status_code == 404
        return
    assert Path(resp.path) == dist.resolve() / "index.html"


def test_absolute_path_cannot_escape_root(dist, tmp_path):
    target = tmp_path / "secret.txt"
    with pytest.raises(HTTPException) as exc:
        spa._file_or_index(str(target))
    assert exc.value.status_code == 404


def test_symlink_escaping_static_dir_is_not_served(dist, tmp_path):
    (dist / "leak.txt").symlink_to(tmp_path / "secret.txt")
    (dist / "leakdir").symlink_to(tmp_path)
    with pytest.raises(HTTPException) as exc:
        spa._file_or_index("leak.txt")
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        spa._file_or_index("leakdir/secret.txt")
    assert exc.value.status_code == 404
    client = make_client()
    assert "top secret" not in client.get("/admin/leak.txt").text
    assert "top secret" not in client.get("/admin/leakdir/secret.txt").text


def test_symlink_inside_static_dir_is_served(dist):
    (dist / "alias.js").symlink_to(dist / "assets" / "app.js")
    resp = make_client().get("/admin/alias.js")
    assert resp.status_code == 200 and "console.log" in resp.text


def test_404_when_admin_disabled_or_not_built(dist, monkeypatch, tmp_path):
    disabled = SimpleNamespace(admin_password=None, admin_session_secret=None)
    assert make_client(disabled).get("/admin").status_code == 404
    assert make_client(disabled).get("/admin/assets/app.js").status_code == 404
    empty = tmp_path / "empty"
    empty.mkdir()
    monkeypatch.setattr(spa, "STATIC_DIR", empty)
    assert make_client().get("/admin").status_code == 404


SECURITY = {
    "x-frame-options": "DENY",
    "content-security-policy": "frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
}


def test_index_and_fallback_are_no_cache(dist):
    client = make_client()
    for path in ("/admin", "/admin/groups/deep"):
        assert client.get(path).headers["cache-control"] == "no-cache"


def test_assets_are_not_no_cache(dist):
    resp = make_client().get("/admin/assets/app.js")
    assert "no-cache" not in resp.headers.get("cache-control", "")


def test_all_spa_responses_carry_security_headers(dist):
    client = make_client()
    for path in ("/admin", "/admin/groups", "/admin/assets/app.js"):
        resp = client.get(path)
        for name, value in SECURITY.items():
            assert resp.headers[name] == value, (path, name)


def test_404s_do_not_get_spa_headers(dist):
    resp = make_client().get("/admin/assets/missing.js")
    assert resp.status_code == 404 and "cache-control" not in resp.headers


@pytest.mark.parametrize(
    ("name", "content_type"),
    [
        ("font.woff2", "font/woff2"),
        ("font.woff", "font/woff"),
        ("app.js", "text/javascript"),
        ("app.css", "text/css"),
        ("icon.svg", "image/svg+xml"),
        ("data.json", "application/json"),
        ("site.webmanifest", "application/manifest+json"),
        ("favicon.ico", "image/x-icon"),
        ("app.js.map", "application/json"),
    ],
)
def test_asset_content_types_do_not_depend_on_system_mime_db(
    dist, monkeypatch, name, content_type
):
    # Simulate python:slim, whose mimetypes knows none of these.
    monkeypatch.setattr(spa.mimetypes, "guess_type", lambda *a, **k: (None, None))
    (dist / "assets" / name).write_bytes(b"x")
    resp = make_client().get(f"/admin/assets/{name}")
    assert resp.status_code == 200
    assert resp.headers["content-type"].split(";")[0] == content_type
    assert resp.headers["x-content-type-options"] == "nosniff"


def test_wrong_system_type_is_overridden(dist, monkeypatch):
    monkeypatch.setattr(
        spa.mimetypes, "guess_type", lambda *a, **k: ("text/plain", None)
    )
    (dist / "assets" / "font.woff2").write_bytes(b"x")
    resp = make_client().get("/admin/assets/font.woff2")
    assert resp.headers["content-type"] == "font/woff2"


def test_unknown_extension_falls_back_to_system_guess(dist):
    (dist / "assets" / "page.html").write_text("<p>x</p>")
    resp = make_client().get("/admin/assets/page.html")
    assert resp.headers["content-type"].startswith("text/html")


@pytest.mark.parametrize("instrument", [False, True])
def test_head_matches_get_headers_with_empty_body(dist, instrument):
    client = make_client(instrument=instrument)
    for path in ("/admin/assets/app.js", "/admin", "/admin/", "/admin/groups"):
        got, head = client.get(path), client.head(path)
        assert head.status_code == 200, path
        assert head.content == b""
        for name in ("content-type", "content-length", "cache-control", *SECURITY):
            assert head.headers.get(name) == got.headers.get(name), (path, name)
        for name, value in SECURITY.items():
            assert head.headers[name] == value


@pytest.mark.parametrize("instrument", [False, True])
@pytest.mark.parametrize(
    "path",
    [
        "/admin/assets/missing.js",
        "/admin/assets/missing.woff2",
        "/admin/..%2f..%2fetc/passwd",
        "/admin/assets/app.js%00.png",
        "/admin/%00",
        "/admin/..%2fsecret.txt",
    ],
)
def test_head_missing_or_hostile_paths_are_not_500(dist, instrument, path):
    resp = make_client(instrument=instrument).head(path)
    assert resp.status_code in (200, 404)
    assert resp.content == b""
    if resp.status_code == 200:  # only ever the SPA index
        assert resp.headers["cache-control"] == "no-cache"


def test_head_dotted_missing_path_has_no_spa_fallback(dist):
    assert make_client().head("/admin/assets/missing.js").status_code == 404
    assert make_client().head("/admin/some.thing").status_code == 404


def test_head_404_when_admin_disabled(dist):
    disabled = SimpleNamespace(admin_password=None, admin_session_secret=None)
    for path in ("/admin", "/admin/assets/app.js"):
        assert make_client(disabled, instrument=True).head(path).status_code == 404
