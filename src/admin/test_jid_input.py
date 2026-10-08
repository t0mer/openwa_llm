import pytest

from admin.jid_input import parse_user_jid


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("972501234567", "972501234567@s.whatsapp.net"),
        ("+972 50-123-4567", "972501234567@s.whatsapp.net"),
        ("  (972) 501234567 ", "972501234567@s.whatsapp.net"),
        ("972501234567@c.us", "972501234567@s.whatsapp.net"),
        ("972501234567@s.whatsapp.net", "972501234567@s.whatsapp.net"),
        ("972501234567:12@s.whatsapp.net", "972501234567@s.whatsapp.net"),
        ("55512345@lid", "55512345@lid"),
    ],
)
def test_valid_inputs(raw, expected):
    assert parse_user_jid(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "abc",
        "1203@g.us",
        "@c.us",
        "972@",
        "a@b@c",
        "+",
        "x" * 300,
        "972501234567@broadcast",
    ],
)
def test_invalid_inputs(raw):
    with pytest.raises(ValueError):
        parse_user_jid(raw)
