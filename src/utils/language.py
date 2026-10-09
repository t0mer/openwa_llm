import re

_MENTION = re.compile(r"@\d+")
_URL = re.compile(r"https?://\S+|www\.\S+")
_HEBREW = re.compile(r"[֐-׿]")
_LATIN = re.compile(r"[A-Za-z]")


def is_hebrew(text: str) -> bool:
    """Return True if Hebrew letters outnumber (or equal) Latin letters in text.

    Mention tags (@123...) and URLs are ignored. Text with no letters is False.
    """
    cleaned = _URL.sub(" ", _MENTION.sub(" ", text or ""))
    hebrew = len(_HEBREW.findall(cleaned))
    latin = len(_LATIN.findall(cleaned))
    return hebrew > 0 and hebrew >= latin
