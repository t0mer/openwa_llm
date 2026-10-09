import re
from collections.abc import Collection, Iterable

from whatsapp.jid import parse_jid

_TAG = re.compile(r"@(\d{5,})")


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
        user = parse_jid(jid).user
        if user not in opted_out:
            by_user.setdefault(user, jid)

    found: dict[str, None] = {}
    for user in _TAG.findall(text):
        if user in by_user:
            found[by_user[user]] = None
    return list(found)
