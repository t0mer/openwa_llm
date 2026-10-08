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
