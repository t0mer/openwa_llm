import hashlib
import hmac
from datetime import datetime, timezone

from whatsapp.openwa_webhook import parse_event, verify_signature
from whatsapp.types import GroupEvent, InboundMessage, InboundReaction

SECRET = "s" * 16


def _sig(body: bytes, secret: str = SECRET) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def test_verify_signature_valid():
    body = b'{"a":1}'
    assert verify_signature(SECRET, body, _sig(body))


def test_verify_signature_rejects_bad_missing_or_unconfigured():
    body = b'{"a":1}'
    assert not verify_signature(SECRET, body, _sig(body, "x" * 16))
    assert not verify_signature(SECRET, body, "deadbeef")
    assert not verify_signature(SECRET, body, None)
    assert not verify_signature("", body, _sig(body, ""))


def _envelope(event: str, data: dict) -> dict:
    return {
        "event": event,
        "timestamp": "2026-10-08T10:00:00.000Z",
        "sessionId": "s1",
        "data": data,
    }


def test_parse_group_message():
    ev = parse_event(
        _envelope(
            "message.received",
            {
                "id": "true_1203@g.us_ABC_972@c.us",
                "from": "1203@g.us",
                "chatId": "1203@g.us",
                "author": "972501234567@c.us",
                "body": "hello @972599999999",
                "type": "chat",
                "timestamp": 1790000000,
                "fromMe": False,
                "isGroup": True,
                "mentionedIds": ["972599999999@c.us"],
                "contact": {"pushName": "Dana"},
                "quotedMessage": {"id": "q1", "body": "old"},
            },
        )
    )
    assert ev == InboundMessage(
        id="true_1203@g.us_ABC_972@c.us",
        chat_jid="1203@g.us",
        sender_jid="972501234567@s.whatsapp.net",
        timestamp=datetime.fromtimestamp(1790000000, tz=timezone.utc),
        text="hello @972599999999",
        sender_name="Dana",
        reply_to_id="q1",
        media_url=None,
        from_me=False,
        mentioned_jids=("972599999999@s.whatsapp.net",),
    )


def test_parse_dm_uses_from_as_sender():
    ev = parse_event(
        _envelope(
            "message.received",
            {
                "id": "m1",
                "from": "972501234567@c.us",
                "chatId": "972501234567@c.us",
                "body": "opt-out",
                "type": "chat",
                "timestamp": 1790000000,
                "isGroup": False,
            },
        )
    )
    assert isinstance(ev, InboundMessage)
    assert ev.sender_jid == "972501234567@s.whatsapp.net"
    assert ev.chat_jid == "972501234567@s.whatsapp.net"


def test_parse_group_message_without_author_or_user_from_is_ignored():
    ev = parse_event(
        _envelope(
            "message.received",
            {
                "id": "m1",
                "from": "1203@g.us",
                "chatId": "1203@g.us",
                "body": "x",
                "type": "chat",
                "timestamp": 1790000000,
                "isGroup": True,
            },
        )
    )
    assert ev is None


def test_parse_group_message_uses_participant_when_no_author():
    ev = parse_event(
        _envelope(
            "message.received",
            {
                "id": "m1",
                "from": "1203@g.us",
                "participant": "972501234567@c.us",
                "chatId": "1203@g.us",
                "body": "x",
                "type": "chat",
                "timestamp": 1790000000,
                "isGroup": True,
            },
        )
    )
    assert isinstance(ev, InboundMessage)
    assert ev.sender_jid == "972501234567@s.whatsapp.net"


def test_parse_non_group_message_falls_back_to_from():
    ev = parse_event(
        _envelope(
            "message.received",
            {
                "id": "m1",
                "from": "972501234567@c.us",
                "chatId": "972501234567@c.us",
                "body": "x",
                "type": "chat",
                "timestamp": 1790000000,
                "isGroup": False,
            },
        )
    )
    assert isinstance(ev, InboundMessage)
    assert ev.sender_jid == "972501234567@s.whatsapp.net"


def test_parse_lid_sender_uses_sender_phone_when_present():
    base = {
        "id": "m1",
        "from": "1203@g.us",
        "chatId": "1203@g.us",
        "author": "55512345@lid",
        "body": "x",
        "type": "chat",
        "timestamp": 1790000000,
        "isGroup": True,
    }
    with_phone = parse_event(
        _envelope("message.received", {**base, "senderPhone": "+972 50 123 4567"})
    )
    without_phone = parse_event(_envelope("message.received", base))
    assert isinstance(with_phone, InboundMessage)
    assert with_phone.sender_jid == "972501234567@s.whatsapp.net"
    assert isinstance(without_phone, InboundMessage)
    assert without_phone.sender_jid == "55512345@lid"


def test_parse_media_caption_and_document_filename():
    image = parse_event(
        _envelope(
            "message.received",
            {
                "id": "m1",
                "from": "9725@c.us",
                "chatId": "9725@c.us",
                "body": "look at this",
                "type": "image",
                "timestamp": 1790000000,
                "media": {"mimetype": "image/jpeg", "omitted": True},
            },
        )
    )
    doc = parse_event(
        _envelope(
            "message.received",
            {
                "id": "m2",
                "from": "9725@c.us",
                "chatId": "9725@c.us",
                "body": "",
                "type": "document",
                "timestamp": 1790000000,
                "media": {"mimetype": "application/pdf", "filename": "plan.pdf"},
            },
        )
    )
    empty_image = parse_event(
        _envelope(
            "message.received",
            {
                "id": "m3",
                "from": "9725@c.us",
                "chatId": "9725@c.us",
                "type": "image",
                "timestamp": 1790000000,
            },
        )
    )
    assert isinstance(image, InboundMessage)
    assert isinstance(doc, InboundMessage)
    assert isinstance(empty_image, InboundMessage)
    assert image.text == "[[Attached Image]] look at this"
    assert doc.text == "[[Attached Document]] plan.pdf"
    assert empty_image.text is None


def test_parse_message_without_id_gets_fallback_id():
    ev = parse_event(
        _envelope(
            "message.received",
            {
                "from": "9725@c.us",
                "chatId": "9725@c.us",
                "body": "x",
                "type": "chat",
                "timestamp": 1790000000,
            },
        )
    )
    assert isinstance(ev, InboundMessage)
    assert ev.id.startswith("na-")


def test_parse_message_without_sender_or_chat_is_ignored():
    assert parse_event(_envelope("message.received", {"id": "m1", "body": "x"})) is None


def test_parse_reaction_uses_envelope_timestamp():
    ev = parse_event(
        _envelope(
            "message.reaction",
            {
                "messageId": "m1",
                "chatId": "1203@g.us",
                "reaction": "👍",
                "senderId": "972501234567@c.us",
            },
        )
    )
    assert ev == InboundReaction(
        message_id="m1",
        sender_jid="972501234567@s.whatsapp.net",
        emoji="👍",
        timestamp=datetime(2026, 10, 8, 10, 0, tzinfo=timezone.utc),
    )


def test_parse_reaction_removal_has_empty_emoji():
    ev = parse_event(
        _envelope(
            "message.reaction",
            {"messageId": "m1", "reaction": "", "senderId": "9725@c.us"},
        )
    )
    assert isinstance(ev, InboundReaction)
    assert ev.emoji == ""


def test_parse_reaction_missing_ids_is_ignored():
    assert parse_event(_envelope("message.reaction", {"reaction": "👍"})) is None


def test_parse_group_events_case_insensitive():
    assert parse_event(_envelope("group.join", {})) == GroupEvent(name="group.join")
    assert parse_event(_envelope("Group.Update", {})) == GroupEvent(name="group.update")


def test_parse_other_events_and_garbage_return_none():
    assert parse_event(_envelope("message.sent", {"id": "m1"})) is None
    assert parse_event(_envelope("session.status", {})) is None
    assert parse_event({"event": 5}) is None
    assert parse_event({"event": "message.received", "data": "nope"}) is None


def test_verify_signature_non_ascii_header_fails_safely():
    """Non-ASCII header must not raise, must return False."""
    body = b'{"a":1}'
    # Header with non-ASCII character
    assert verify_signature(SECRET, body, "sha256=é") is False


def test_parse_message_millisecond_epoch():
    """Millisecond epoch (> 1e11) should be divided by 1000 and parsed correctly."""
    ms_epoch = 1790000000000  # milliseconds
    sec_epoch = 1790000000  # seconds
    expected_dt = datetime.fromtimestamp(sec_epoch, tz=timezone.utc)

    msg_ms = parse_event(
        _envelope(
            "message.received",
            {
                "id": "m1",
                "from": "9725@c.us",
                "chatId": "9725@c.us",
                "body": "x",
                "type": "chat",
                "timestamp": ms_epoch,
            },
        )
    )
    msg_sec = parse_event(
        _envelope(
            "message.received",
            {
                "id": "m1",
                "from": "9725@c.us",
                "chatId": "9725@c.us",
                "body": "x",
                "type": "chat",
                "timestamp": sec_epoch,
            },
        )
    )
    assert isinstance(msg_ms, InboundMessage)
    assert isinstance(msg_sec, InboundMessage)
    assert msg_ms.timestamp == expected_dt
    assert msg_sec.timestamp == expected_dt


def test_parse_message_out_of_range_timestamp_falls_back():
    """Out-of-range numeric timestamp (inf, nan, huge) should fall back to envelope timestamp."""
    envelope_ts = datetime(2026, 10, 8, 10, 0, tzinfo=timezone.utc)

    for bad_ts in [float("inf"), float("nan"), 9e20, -9e20]:
        msg = parse_event(
            {
                "event": "message.received",
                "timestamp": "2026-10-08T10:00:00.000Z",
                "sessionId": "s1",
                "data": {
                    "id": "m1",
                    "from": "9725@c.us",
                    "chatId": "9725@c.us",
                    "body": "x",
                    "type": "chat",
                    "timestamp": bad_ts,
                },
            }
        )
        assert isinstance(msg, InboundMessage)
        assert msg.timestamp == envelope_ts


def test_parse_message_mentioned_ids_not_a_list():
    """mentionedIds that is not a list should be safely ignored."""
    ev = parse_event(
        _envelope(
            "message.received",
            {
                "id": "m1",
                "from": "9725@c.us",
                "chatId": "9725@c.us",
                "body": "hello",
                "type": "chat",
                "timestamp": 1790000000,
                "mentionedIds": "not_a_list",
            },
        )
    )
    assert isinstance(ev, InboundMessage)
    assert ev.mentioned_jids == ()


def test_parse_message_group_detection_via_chat_id():
    """If isGroup is absent but chatId ends with @g.us, still treat as group (use author)."""
    ev = parse_event(
        _envelope(
            "message.received",
            {
                "id": "m1",
                "from": "1203@g.us",
                "chatId": "1203@g.us",
                "author": "972501234567@c.us",
                "body": "hello",
                "type": "chat",
                "timestamp": 1790000000,
                # Note: isGroup is absent, but chatId ends with @g.us
            },
        )
    )
    assert isinstance(ev, InboundMessage)
    # Should use author (not from) because chatId is a group
    assert ev.sender_jid == "972501234567@s.whatsapp.net"
