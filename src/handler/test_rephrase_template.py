from services.prompt_manager import prompt_manager


def test_rephrase_names_phone_and_lid():
    text = prompt_manager.render("rephrase.j2", my_jid="972559661780", my_lid="2098")
    assert "@972559661780" in text
    assert "@2098" in text


def test_rephrase_without_lid_keeps_old_wording():
    text = prompt_manager.render("rephrase.j2", my_jid="972559661780", my_lid=None)
    assert "- Your name is @972559661780\n" in text
    assert "also be tagged" not in text
