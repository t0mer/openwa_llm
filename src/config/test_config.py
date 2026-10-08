import pytest

from config import Settings


def test_qa_testers_are_canonicalized_to_s_whatsapp_net():
    assert Settings.validate_qa_testers(
        ["972501234567@c.us", "972509999999@s.whatsapp.net"]
    ) == ["972501234567@s.whatsapp.net", "972509999999@s.whatsapp.net"]


def test_qa_testers_reject_group_jids():
    with pytest.raises(ValueError):
        Settings.validate_qa_testers(["1203@g.us"])
