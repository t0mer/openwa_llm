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


def test_hebrew_question_naming_an_english_term():
    assert is_hebrew("מה זה Kubernetes?")


def test_tie_goes_to_hebrew():
    assert is_hebrew("איך מתקינים Docker על Ubuntu?")


def test_english_question_with_one_hebrew_word():
    assert not is_hebrew("Can you explain קוברנטס please")


def test_non_numeric_tag_is_stripped():
    assert is_hebrew("@TomerKlein מה")
    assert not is_hebrew("@TomerKlein @123")


def test_punctuation_only():
    assert not is_hebrew("?")


def test_other_scripts_are_not_hebrew():
    assert not is_hebrew("مرحبا بالعالم")
    assert not is_hebrew("привет мир")


def test_niqqud_word_ties_with_latin():
    assert is_hebrew("שָׁלוֹם hello")


def test_marks_alone_are_not_a_hebrew_word():
    assert not is_hebrew("ְֱ hello")
