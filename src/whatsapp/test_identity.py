from unittest.mock import AsyncMock

from whatsapp.identity import BotIdentity, get_bot_identity
from whatsapp.jid import JID

PHONE = JID(user="972559661780", server="s.whatsapp.net")
LID = JID(user="209878492672151", server="lid")


def gateway(lid):
    client = AsyncMock()
    client.get_my_jid = AsyncMock(return_value=PHONE)
    client.get_my_lid = AsyncMock(return_value=lid)
    return client


async def test_phone_only_when_no_lid():
    identity = await get_bot_identity(gateway(None))
    assert identity == BotIdentity(phone=PHONE, lid=None)
    assert identity.users() == ("972559661780",)
    assert identity.normalized() == frozenset({"972559661780@s.whatsapp.net"})


async def test_both_identities_when_lid_known():
    identity = await get_bot_identity(gateway(LID))
    assert identity.users() == ("972559661780", "209878492672151")
    assert identity.normalized() == frozenset(
        {"972559661780@s.whatsapp.net", "209878492672151@lid"}
    )


async def test_lid_lookup_error_degrades_to_phone_only():
    client = gateway(None)
    client.get_my_lid = AsyncMock(side_effect=RuntimeError("boom"))
    identity = await get_bot_identity(client)
    assert identity.lid is None
    assert identity.users() == ("972559661780",)
