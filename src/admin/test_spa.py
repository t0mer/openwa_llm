from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

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


def make_client(settings=None):
    app = FastAPI()
    app.include_router(spa.router)
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
