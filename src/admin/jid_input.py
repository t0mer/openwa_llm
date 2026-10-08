from __future__ import annotations

import re

from whatsapp.jid import (
    DefaultUserServer,
    HiddenUserServer,
    JIDParseError,
    normalize_jid,
    parse_jid,
    to_canonical_jid,
)

_MAX_LEN = 255
_PHONE_CHARS = re.compile(r"^[+\d\s().-]+$")


def parse_user_jid(raw: str) -> str:
    """Normalize a user-entered phone number or JID to the form stored in the DB."""
    text = (raw or "").strip()
    if not text or len(text) > _MAX_LEN:
        raise ValueError("enter a phone number or JID")
    if "@" not in text:
        if not _PHONE_CHARS.match(text):
            raise ValueError("not a phone number")
        digits = re.sub(r"\D", "", text)
        if not digits:
            raise ValueError("not a phone number")
        return f"{digits}@{DefaultUserServer}"
    try:
        jid = parse_jid(to_canonical_jid(text))
    except JIDParseError as e:
        raise ValueError(str(e)) from e
    if not jid.user or jid.server not in (DefaultUserServer, HiddenUserServer):
        raise ValueError("expected a user JID (@s.whatsapp.net, @c.us or @lid)")
    if text.count("@") != 1:
        raise ValueError("invalid JID")
    return normalize_jid(jid)
