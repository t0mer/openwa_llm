from services.prompt_manager import prompt_manager


def test_quick_summary_tells_model_to_copy_tags_verbatim():
    text = prompt_manager.render("quick_summary.j2", group_name="G")
    assert "exactly as they appear in the chat history" in text
    assert "copying the `@<number>` verbatim" in text
    assert "Never invent" in text
