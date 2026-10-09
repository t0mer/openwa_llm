import pytest
from pydantic import ValidationError

from config import Settings


def test_qa_testers_are_canonicalized_to_s_whatsapp_net():
    assert Settings.validate_qa_testers(
        ["972501234567@c.us", "972509999999@s.whatsapp.net"]
    ) == ["972501234567@s.whatsapp.net", "972509999999@s.whatsapp.net"]


def test_qa_testers_reject_group_jids():
    with pytest.raises(ValueError):
        Settings.validate_qa_testers(["1203@g.us"])


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


def test_admin_disabled_by_default_and_blank_values_are_unset():
    s = Settings.model_validate(
        {**REQUIRED, "admin_password": "", "admin_session_secret": ""}
    )
    assert s.admin_password is None and s.admin_session_secret is None


def test_admin_session_secret_must_be_long_enough():
    with pytest.raises(ValidationError):
        Settings.model_validate({**REQUIRED, "admin_session_secret": "short"})
    ok = Settings.model_validate({**REQUIRED, "admin_session_secret": "x" * 32})
    assert ok.admin_session_secret == "x" * 32


def test_timezone_defaults_to_jerusalem_and_scheduler_enabled(monkeypatch):
    monkeypatch.delenv("TIMEZONE", raising=False)
    monkeypatch.delenv("SCHEDULER_ENABLED", raising=False)
    s = Settings(_env_file=None, **REQUIRED)  # pyright: ignore[reportCallIssue]
    assert s.timezone == "Asia/Jerusalem"
    assert s.scheduler_enabled is True


@pytest.mark.parametrize("name", ["UTC", "Europe/London", "Asia/Jerusalem", "EST5EDT"])
def test_timezone_accepts_listed_iana_names(name):
    assert Settings.model_validate({**REQUIRED, "timezone": name}).timezone == name


@pytest.mark.parametrize(
    "name",
    ["", " ", "Asia/Jerusalem ", " UTC", "utc", "localtime", "posixrules", "Mars/X"],
)
def test_invalid_timezone_is_rejected(name):
    with pytest.raises(ValidationError) as exc:
        Settings.model_validate({**REQUIRED, "timezone": name})
    assert "TIMEZONE" in str(exc.value)


def test_invalid_timezone_error_does_not_echo_other_settings():
    secrets = {
        **REQUIRED,
        "openwa_api_key": "SECRET-API-KEY-123",
        "anthropic_api_key": "SECRET-ANTHROPIC-456",
        "db_uri": "postgresql+asyncpg://user:SECRET-PW-789@h/db",
        "timezone": "Mars/Olympus",
    }
    with pytest.raises(ValidationError) as exc:
        Settings.model_validate(secrets)
    text = str(exc.value)
    assert "Mars/Olympus" in text
    assert "SECRET" not in text


def test_default_timezone_is_validated(monkeypatch):
    monkeypatch.setattr("config.available_timezones", lambda: {"UTC"})
    with pytest.raises(ValidationError) as exc:
        Settings.model_validate(REQUIRED)
    assert "Asia/Jerusalem" in str(exc.value)


def test_scheduler_can_be_disabled():
    s = Settings.model_validate({**REQUIRED, "scheduler_enabled": False})
    assert s.scheduler_enabled is False
