import re

_TAG = re.compile(r"@\S+")
_URL = re.compile(r"https?://\S+|www\.\S+")
# Runs of Latin letters, Hebrew letters and Hebrew marks (niqqud/cantillation).
_WORD = re.compile(r"[A-Za-zְ-ׇא-ת]+")
_HEBREW_LETTER = re.compile(r"[א-ת]")
_LATIN_LETTER = re.compile(r"[A-Za-z]")


def is_hebrew(text: str) -> bool:
    """Return True if Hebrew words outnumber (or tie with) Latin words in text.

    Mention tags and URLs are ignored. A word is Hebrew if it contains a Hebrew
    letter (U+05D0-U+05EA), Latin if it contains an ASCII letter. Text with no
    such words is False.
    """
    cleaned = _TAG.sub(" ", _URL.sub(" ", text or ""))
    words = _WORD.findall(cleaned)
    hebrew = sum(1 for w in words if _HEBREW_LETTER.search(w))
    latin = sum(1 for w in words if _LATIN_LETTER.search(w))
    return hebrew > 0 and hebrew >= latin
