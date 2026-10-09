from utils.mentions import extract_mentions

LID = "227912345678901@lid"
PHONE = "972501234567@s.whatsapp.net"


def test_extracts_known_senders_in_order_deduped():
    text = "@972501234567 and @227912345678901, again @972501234567"
    assert extract_mentions(text, [LID, PHONE]) == [PHONE, LID]


def test_hebrew_and_punctuation_adjacent_tokens():
    assert extract_mentions(
        "שלום (@227912345678901) ו-@972501234567.", [LID, PHONE]
    ) == [
        LID,
        PHONE,
    ]
    assert extract_mentions("היי @227912345678901, מה", [LID]) == [LID]


def test_unknown_digits_ignored():
    assert extract_mentions("@111222333 @1234", [LID, PHONE]) == []


def test_opted_out_never_mentioned():
    out = extract_mentions(
        "@972501234567 @227912345678901", [LID, PHONE], {"972501234567": "Dan"}
    )
    assert out == [LID]


def test_no_tokens():
    assert extract_mentions("nothing here", [LID]) == []
