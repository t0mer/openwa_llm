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
    s = Settings.model_validate(REQUIRED)
    assert s.timezone == "Asia/Jerusalem"
    assert s.scheduler_enabled is True


def test_timezone_accepts_valid_iana_name():
    assert Settings.model_validate({**REQUIRED, "timezone": "UTC"}).timezone == "UTC"


def test_invalid_timezone_is_rejected_readably_without_secrets():
    with pytest.raises(ValidationError) as exc:
        Settings.model_validate({**REQUIRED, "timezone": "Mars/Olympus"})
    text = str(exc.value)
    assert "timezone" in text and "Mars/Olympus" in text
    assert "w" * 16 not in text  # webhook secret is not echoed


def test_scheduler_can_be_disabled():
    s = Settings.model_validate({**REQUIRED, "scheduler_enabled": False})
    assert s.scheduler_enabled is False
