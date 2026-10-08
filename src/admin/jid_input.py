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
_PHONE_CHARS = re.compile(r"^[+0-9\s().-]+$", re.ASCII)
_USER_DIGITS = re.compile(r"^[0-9]{5,20}$")


def parse_user_jid(raw: str) -> str:
    """Normalize a user-entered phone number or JID to the form stored in the DB."""
    text = (raw or "").strip()
    if not text or len(text) > _MAX_LEN:
        raise ValueError("enter a phone number or JID")
    if "@" not in text:
        if not _PHONE_CHARS.match(text):
            raise ValueError("not a phone number")
        digits = re.sub(r"[^0-9]", "", text)
        if not _USER_DIGITS.match(digits):
            raise ValueError("not a phone number")
        return f"{digits}@{DefaultUserServer}"
    if text.count("@") != 1 or any(ord(ch) < 32 or ch.isspace() for ch in text):
        raise ValueError("invalid JID")
    try:
        jid = parse_jid(to_canonical_jid(text))
    except JIDParseError as e:
        raise ValueError(str(e)) from e
    if jid.server not in (DefaultUserServer, HiddenUserServer):
        raise ValueError("expected a user JID (@s.whatsapp.net, @c.us or @lid)")
    user = normalize_jid(jid).split("@", 1)[0]
    if jid.server == HiddenUserServer:
        user = user.split(":", 1)[0]
    if not _USER_DIGITS.match(user):
        raise ValueError("invalid JID user")
    return f"{user}@{jid.server}"
