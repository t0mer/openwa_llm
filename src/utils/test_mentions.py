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


def test_unparseable_sender_jids_skipped():
    assert extract_mentions("@972501234567", ["garbage", "a:b", PHONE]) == [PHONE]


def test_device_suffix_jid_normalised():
    assert extract_mentions("@972501234567", ["972501234567:4@s.whatsapp.net"]) == [
        PHONE
    ]


def test_left_boundary():
    jids = [PHONE]
    assert extract_mentions("mail bob@972501234567.com", jids) == []
    assert extract_mentions("x1@972501234567", jids) == []
    assert extract_mentions("a.@972501234567", jids) == []
    for text in (
        "(@972501234567)",
        "@972501234567",
        "hi @972501234567",
        "שלום@972501234567",
        "‏@972501234567",
        "‏‎@972501234567",
    ):
        assert extract_mentions(text, jids) == [PHONE], text


def test_safe_extract_mentions_returns_mentions():
    from utils.mentions import safe_extract_mentions

    assert safe_extract_mentions("hi @972501234567", [PHONE], {}, "ctx") == [PHONE]


def test_safe_extract_mentions_falls_back_and_warns(monkeypatch, caplog):
    import utils.mentions as mod

    def boom(*a, **k):
        raise RuntimeError("x")

    monkeypatch.setattr(mod, "extract_mentions", boom)
    with caplog.at_level("WARNING"):
        assert mod.safe_extract_mentions("@1", [PHONE], {}, "grp") == []
    assert "grp" in caplog.text
