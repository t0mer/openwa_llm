from services.prompt_manager import prompt_manager


def test_quick_summary_tells_model_to_copy_tags_verbatim():
    text = prompt_manager.render("quick_summary.j2", group_name="G")
    assert "exactly as they appear in the chat history" in text
    assert "copying the `@<number>` verbatim" in text
    assert "Never invent" in text


def test_summarize_and_rag_templates_tell_model_to_copy_tags_verbatim():
    for name in ("summarize.j2", "rag.j2"):
        text = prompt_manager.render(name)
        assert "exactly as they appear in the chat history" in text, name
        assert "copying the `@<number>` verbatim" in text, name
        assert "Never invent" in text, name


OLD_LINE = "Write in the same language as the chat group. You MUST use the same language as the chat group!"


def test_quick_summary_auto_keeps_original_language_line():
    for kwargs in ({}, {"summary_language": None}):
        text = prompt_manager.render("quick_summary.j2", group_name="G", **kwargs)
        assert OLD_LINE in text
        assert "regardless of the language" not in text


def test_quick_summary_explicit_language_replaces_original_line():
    for code, name in (("he", "Hebrew"), ("en", "English"), ("ru", "Russian")):
        text = prompt_manager.render(
            "quick_summary.j2", group_name="G", summary_language=code
        )
        assert OLD_LINE not in text
        assert f"Write the entire summary in {name}" in text
        assert "regardless of the language" in text
        assert "copying the `@<number>` verbatim" in text
        assert 'in "G" group' in text


LANGUAGE_RULE = (
    "Reply in the language of the user's request line (labelled `# Request:`). "
    "Ignore the language of the chat history and of the attached topics or "
    "knowledge-base content. A Hebrew question gets a Hebrew answer; an English "
    "question gets an English answer."
)


def test_summarize_and_rag_templates_share_the_explicit_language_rule():
    for name in ("summarize.j2", "rag.j2"):
        assert LANGUAGE_RULE in prompt_manager.render(name), name


def test_quick_summary_keeps_following_the_chat_language():
    assert "# Request:" not in prompt_manager.render("quick_summary.j2", group_name="G")
