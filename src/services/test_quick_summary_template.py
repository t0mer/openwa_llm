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
