import logging
import re
from collections.abc import Collection, Iterable

from whatsapp.jid import JIDParseError, parse_jid

# Not preceded by an ASCII letter/digit/dot, so emails like bob@12345678.com are skipped.
_TAG = re.compile(r"(?<![A-Za-z0-9.])@(\d{5,})")


def extract_mentions(
    text: str, sender_jids: Iterable[str], opted_out: Collection[str] = ()
) -> list[str]:
    """JIDs of the known senders tagged as `@<number>` in `text`.

    Only tokens whose digits equal the user part of one of `sender_jids` count,
    and users in `opted_out` (user parts) are never mentioned. Result is
    deduplicated, in order of appearance.
    """
    by_user: dict[str, str] = {}
    for jid in sender_jids:
        try:
            parsed = parse_jid(jid)
        except (JIDParseError, IndexError):
            continue
        if parsed.user not in opted_out:
            by_user.setdefault(parsed.user, str(parsed.to_non_ad()))

    found: dict[str, None] = {}
    for user in _TAG.findall(text):
        if user in by_user:
            found[by_user[user]] = None
    return list(found)


def safe_extract_mentions(
    text: str,
    sender_jids: Iterable[str],
    opted_out: Collection[str],
    context: str,
) -> list[str]:
    """`extract_mentions`, but a failure logs a warning and yields no mentions.

    Mentions are best-effort: they must never block sending the text.
    """
    try:
        return extract_mentions(text, sender_jids, opted_out)
    except Exception as e:
        logging.getLogger(__name__).warning(
            "Could not compute mentions for %s: %s", context, e
        )
        return []
