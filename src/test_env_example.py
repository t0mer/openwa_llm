from pathlib import Path

from dotenv import dotenv_values

from config import Settings

ENV_EXAMPLE = Path(__file__).resolve().parents[1] / ".env.example"

REQUIRED = dict(
    db_uri="postgresql+asyncpg://u:p@h/db",
    whatsapp_host="http://h",
    openwa_api_key="k",
    openwa_session_id="s",
    openwa_webhook_secret="w" * 16,
    anthropic_api_key="a",
    voyage_api_key="v",
    logfire_token="l",
)


def test_admin_credentials_not_active_in_example():
    values = dotenv_values(ENV_EXAMPLE)
    assert "ADMIN_PASSWORD" not in values
    assert "ADMIN_SESSION_SECRET" not in values


def test_admin_cookie_secure_is_false_in_example():
    assert dotenv_values(ENV_EXAMPLE).get("ADMIN_COOKIE_SECURE") == "false"


def test_commented_admin_template_lines_exist():
    lines = ENV_EXAMPLE.read_text().splitlines()
    assert any(line.startswith("# ADMIN_PASSWORD=") for line in lines)
    assert any(line.startswith("# ADMIN_SESSION_SECRET=") for line in lines)


def test_example_leaves_admin_disabled(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)  # no real .env interferes
    for key in ("ADMIN_PASSWORD", "ADMIN_SESSION_SECRET"):
        monkeypatch.delenv(key, raising=False)
    admin = {
        k.lower(): v
        for k, v in dotenv_values(ENV_EXAMPLE).items()
        if k.startswith("ADMIN_") and v is not None
    }
    s = Settings.model_validate({**REQUIRED, **admin})
    assert s.admin_password is None
    assert s.admin_session_secret is None
    assert s.admin_cookie_secure is False
