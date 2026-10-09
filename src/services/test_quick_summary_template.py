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
