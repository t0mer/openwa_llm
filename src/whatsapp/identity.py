import logging
from dataclasses import dataclass

from .gateway import WhatsAppGateway
from .jid import JID

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class BotIdentity:
    """The bot's own WhatsApp identities: its phone JID and, when known, its @lid."""

    phone: JID
    lid: JID | None = None

    def jids(self) -> tuple[JID, ...]:
        return (self.phone, self.lid) if self.lid else (self.phone,)

    def users(self) -> tuple[str, ...]:
        return tuple(j.user for j in self.jids())

    def normalized(self) -> frozenset[str]:
        return frozenset(j.normalize_str() for j in self.jids())


async def get_bot_identity(whatsapp: WhatsAppGateway) -> BotIdentity:
    """Resolve the bot's identities. A failed @lid lookup never raises."""
    phone = await whatsapp.get_my_jid()
    try:
        lid = await whatsapp.get_my_lid()
    except Exception as e:  # the lookup is best-effort by design
        logger.warning("Bot @lid lookup failed: %s", e)
        lid = None
    return BotIdentity(phone=phone, lid=lid if isinstance(lid, JID) else None)
