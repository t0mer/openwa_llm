from utils.language import is_hebrew


def test_hebrew():
    assert is_hebrew("מה קורה בקבוצה?")


def test_english():
    assert not is_hebrew("what is going on in the group?")


def test_mixed_majority_wins():
    assert is_hebrew("תסכם לי את הדיון על Kubernetes ו Docker בבקשה")
    assert not is_hebrew("please summarize the thread שלום")


def test_no_letters_is_not_hebrew():
    assert not is_hebrew("")
    assert not is_hebrew("@972501234567 123 👍")


def test_hebrew_with_bot_tag_and_url():
    assert is_hebrew("@972501234567 מה זה https://example.com/some/long/english/path")


def test_english_with_bot_tag_and_hebrew_free_url():
    assert not is_hebrew("@972501234567 summarize https://example.com/x")


def test_niqqud():
    assert is_hebrew("שָׁלוֹם")


def test_rtl_marks():
    assert is_hebrew("‏מה נשמע‏")
