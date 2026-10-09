from __future__ import annotations

import hashlib
import hmac
import logging
import re
from datetime import datetime, timezone
from typing import Any

from .jid import DefaultUserServer, HiddenUserServer, normalize_jid, to_canonical_jid
from .types import GroupEvent, InboundMessage, InboundReaction

logger = logging.getLogger(__name__)

EVENT_MESSAGE = "message.received"
EVENT_REACTION = "message.reaction"
GROUP_EVENT_PREFIX = "group."

_MEDIA_LABELS = {
    "image": "Image",
    "video": "Video",
    "audio": "Audio",
    "voice": "Audio",
    "ptt": "Audio",
    "document": "Document",
    "sticker": "Sticker",
}


def verify_signature(secret: str, body: bytes, header: str | None) -> bool:
    """Check `X-OpenWA-Signature: sha256=<hex>` (HMAC-SHA256 of the raw body)."""
    if not secret or not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    try:
        sig_bytes = header[len("sha256=") :].encode("ascii")
        expected_bytes = expected.encode("ascii")
        return hmac.compare_digest(expected_bytes, sig_bytes)
    except (UnicodeEncodeError, TypeError):
        return False


def _parse_ts(value: Any, fallback: datetime) -> datetime:
    if isinstance(value, bool):
        return fallback
    if isinstance(value, (int, float)):
        # Handle millisecond epochs (> 1e11)
        ts = value / 1000 if value > 1e11 else value
        try:
            return datetime.fromtimestamp(ts, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return fallback
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return fallback
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return fallback


def _str(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


_RICH_KINDS = {
    "vcard": "Contact",
    "multi_vcard": "Contact",
    "contact": "Contact",
    "location": "Location",
    "poll": "Poll",
    "poll_creation": "Poll",
    "list": "List",
    "order": "Order",
}


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _first_str(source: dict[str, Any], *keys: str) -> str | None:
    return next((v for v in (_str(source.get(k)) for k in keys) if v), None)


def _num(value: Any) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return f"{value:g}" if abs(value) < 1e6 else None


def _contact_detail(data: dict[str, Any]) -> str | None:
    cards: list[Any] = []
    for key in ("vCards", "vcards"):
        if isinstance(data.get(key), list):
            cards.extend(data[key])
    cards.append(data.get("vcard"))
    names = []
    for card in cards:
        if not isinstance(card, str):
            continue
        match = re.search(r"^FN[;:][^\r\n]*?:?([^:\r\n]+)$", card, re.M)
        if match and match.group(1).strip():
            names.append(match.group(1).strip())
    return ", ".join(names) or None


def _location_detail(data: dict[str, Any]) -> str | None:
    loc = _dict(data.get("location")) or data
    lat = _num(loc.get("latitude", loc.get("lat")))
    lng = _num(loc.get("longitude", loc.get("lng", loc.get("lon"))))
    parts = []
    if lat and lng:
        parts.append(f"{lat},{lng}")
    place = _first_str(loc, "name", "address", "description") or _str(data.get("body"))
    if place:
        parts.append(place)
    return " ".join(parts) or None


def _poll_detail(data: dict[str, Any]) -> str | None:
    poll = _dict(data.get("poll"))
    return _first_str(poll, "name", "question", "title") or _first_str(
        data, "pollName", "question", "body"
    )


def _list_or_order_detail(data: dict[str, Any], kind: str) -> str | None:
    nested = _dict(data.get(kind.lower()))
    return _first_str(nested, "title", "name", "message") or _first_str(
        data, "title", "orderTitle", "body"
    )


def _rich_detail(kind: str, data: dict[str, Any]) -> str | None:
    if kind == "Contact":
        return _contact_detail(data)
    if kind == "Location":
        return _location_detail(data)
    if kind == "Poll":
        return _poll_detail(data)
    return _list_or_order_detail(data, kind)


def _message_text(data: dict[str, Any]) -> str | None:
    """Text for a message. Rich-kind field names (vCards, location, poll, list,
    order) are guesses from the OpenWA docs, not verified against live payloads;
    anything unexpected degrades to the bare `[[Attached <kind>]]` label."""
    body = _str(data.get("body"))
    type_ = str(data.get("type") or "").lower()
    rich = _RICH_KINDS.get(type_)
    if rich is not None:
        try:
            detail = _rich_detail(rich, data)
        except (TypeError, ValueError, AttributeError):
            detail = None
        return f"[[Attached {rich}]] {detail}" if detail else f"[[Attached {rich}]]"
    label = _MEDIA_LABELS.get(type_)
    if label is None:
        return body
    media = _dict(data.get("media"))
    caption = body or (_str(media.get("filename")) if type_ == "document" else None)
    return f"[[Attached {label}]] {caption}" if caption else f"[[Attached {label}]]"


def _media_ref(data: dict[str, Any], chat_id: str, message_id: str) -> str | None:
    """Reference (not a download) for media messages: `openwa-media:<chat>/<id>` (raw OpenWA chat id).

    Media is detected from `data.media` being truthy or a media `type`. Both are
    from the OpenWA docs, not verified against a live payload.
    """
    type_ = str(data.get("type") or "").lower()
    if data.get("media") or type_ in _MEDIA_LABELS:
        return f"openwa-media:{chat_id}/{message_id}"
    return None


def _resolve_jid(raw: str | None, phone: Any) -> str | None:
    """Canonicalize a JID, mapping an `@lid` to the sender's phone JID if known."""
    if not raw:
        return None
    if raw.endswith(f"@{HiddenUserServer}"):
        digits = re.sub(r"\D", "", phone) if isinstance(phone, str) else ""
        if digits:
            return f"{digits}@{DefaultUserServer}"
    return to_canonical_jid(raw)


def _sender(data: dict[str, Any]) -> str | None:
    is_group = bool(data.get("isGroup"))
    # If isGroup is not set, check if chatId ends with @g.us
    if not is_group:
        chat_id = _str(data.get("chatId"))
        if chat_id and chat_id.endswith("@g.us"):
            is_group = True
    if is_group:
        # In a group `from` is the group JID: never accept it as the sender.
        candidates = (data.get("author"), data.get("participant"), data.get("from"))
        raw = next(
            (c for c in map(_str, candidates) if c and not c.endswith("@g.us")),
            None,
        )
    else:
        raw = _str(data.get("from"))
    return _resolve_jid(raw, data.get("senderPhone"))


_IGNORED_CHAT_SUFFIXES = ("@broadcast", "@newsletter")


def _parse_message(
    data: dict[str, Any], envelope_ts: datetime
) -> InboundMessage | None:
    for key in ("chatId", "from", "to"):
        value = _str(data.get(key))
        if value and value.endswith(_IGNORED_CHAT_SUFFIXES):
            return None  # status/broadcast lists and channels: nothing to store
    sender = _sender(data)
    # For our own outgoing messages `from` is the bot itself; the chat is `to`.
    fallback_chat = data.get("to") if data.get("fromMe") else data.get("from")
    chat = _str(data.get("chatId")) or _str(fallback_chat)
    if not sender or not chat:
        logger.warning("Ignoring message without sender/chat: %s", data.get("id"))
        return None
    timestamp = _parse_ts(data.get("timestamp"), envelope_ts)
    raw_contact = data.get("contact")
    contact: dict[str, Any] = raw_contact if isinstance(raw_contact, dict) else {}
    raw_quoted = data.get("quotedMessage")
    quoted: dict[str, Any] = raw_quoted if isinstance(raw_quoted, dict) else {}
    mentions = (
        data.get("mentionedIds") if isinstance(data.get("mentionedIds"), list) else None
    )
    message_id = _str(data.get("id")) or f"na-{timestamp.timestamp()}"
    chat_jid = to_canonical_jid(chat)
    return InboundMessage(
        id=message_id,
        chat_jid=chat_jid,
        sender_jid=sender,
        timestamp=timestamp,
        text=_message_text(data),
        sender_name=_str(contact.get("pushName")),
        reply_to_id=_str(quoted.get("id")),
        media_url=_media_ref(data, chat, message_id),
        from_me=bool(data.get("fromMe")),
        mentioned_jids=tuple(
            normalize_jid(to_canonical_jid(m))
            for m in (mentions or [])
            if isinstance(m, str)
        ),
    )


def _parse_reaction(
    data: dict[str, Any], envelope_ts: datetime
) -> InboundReaction | None:
    message_id = _str(data.get("messageId"))
    sender = _resolve_jid(_str(data.get("senderId")), data.get("senderPhone"))
    if not message_id or not sender:
        logger.warning("Ignoring reaction without messageId/senderId")
        return None
    emoji = data.get("reaction")
    return InboundReaction(
        message_id=message_id,
        sender_jid=sender,
        emoji=emoji if isinstance(emoji, str) else "",
        timestamp=envelope_ts,
    )


def parse_event(
    envelope: dict[str, Any],
) -> InboundMessage | InboundReaction | GroupEvent | None:
    """Translate an OpenWA webhook envelope; None means 'nothing to do'."""
    event = envelope.get("event")
    if not isinstance(event, str):
        return None
    event = event.lower()
    envelope_ts = _parse_ts(envelope.get("timestamp"), datetime.now(timezone.utc))
    data = envelope.get("data")

    if event.startswith(GROUP_EVENT_PREFIX):
        return GroupEvent(name=event)
    if not isinstance(data, dict):
        return None
    if event == EVENT_MESSAGE:
        return _parse_message(data, envelope_ts)
    if event == EVENT_REACTION:
        return _parse_reaction(data, envelope_ts)
    return None
