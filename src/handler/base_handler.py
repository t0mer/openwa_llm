import logging
from collections.abc import Sequence

from sqlmodel.ext.asyncio.session import AsyncSession
from voyageai.client_async import AsyncClient

from models import (
    BaseGroup,
    BaseSender,
    Message,
    Sender,
    Group,
    BaseMessage,
    Reaction,
    upsert,
)
from whatsapp import InboundMessage, InboundReaction, WhatsAppGateway
from whatsapp.jid import normalize_jid

logger = logging.getLogger(__name__)


class BaseHandler:
    def __init__(
        self,
        session: AsyncSession,
        whatsapp: WhatsAppGateway,
        embedding_client: AsyncClient,
    ):
        self.session = session
        self.whatsapp = whatsapp
        self.embedding_client = embedding_client

    async def store_message(
        self,
        message: Message | BaseMessage | InboundMessage,
        sender_pushname: str | None = None,
    ) -> Message | None:
        """
        Store a message in the database
        :param message: Message to store - a Message, BaseMessage or InboundMessage
        :param sender_pushname: Pushname of the sender [Optional]
        :return: The stored message
        """
        if isinstance(message, InboundMessage):
            sender_pushname = message.sender_name
            message = Message.from_inbound(message)

        if isinstance(message, BaseMessage):
            message = Message(**message.model_dump())

        if not message.text:
            return message  # Don't store messages without text

        async with self.session.begin_nested():
            # Ensure sender exists and is committed
            sender = await self.session.get(Sender, message.sender_jid)
            if sender is None:
                sender = Sender(
                    **BaseSender(
                        jid=message.sender_jid,  # Use normalized JID from message
                        push_name=sender_pushname,
                    ).model_dump()
                )
                await self.upsert(sender)
                await (
                    self.session.flush()
                )  # Ensure sender is visible in this transaction

            if message.group_jid:
                group = await self.session.get(Group, message.group_jid)
                if group is None:
                    group = Group(**BaseGroup(group_jid=message.group_jid).model_dump())
                    await self.upsert(group)
                    await self.session.flush()

            # Finally add the message
            stored_message = await self.upsert(message)
            return stored_message if isinstance(stored_message, Message) else message

    async def store_reaction(self, event: InboundReaction) -> Reaction | None:
        """
        Store a reaction from an inbound gateway event
        :return: The stored reaction, or None if ignored/failed
        """
        if not event.emoji:
            logger.info("Ignoring empty reaction (removal) on %s", event.message_id)
            return None

        try:
            reaction = Reaction.from_inbound(event)

            async with self.session.begin_nested():
                # Ensure sender exists
                sender = await self.session.get(Sender, reaction.sender_jid)
                if sender is None:
                    sender = Sender(
                        **BaseSender(
                            jid=reaction.sender_jid,
                            push_name=event.sender_name,
                        ).model_dump()
                    )
                    await self.upsert(sender)
                    await self.session.flush()

                # Ensure the message being reacted to exists
                message = await self.session.get(Message, reaction.message_id)
                if message is None:
                    logger.warning(
                        f"Message {reaction.message_id} not found for reaction"
                    )

                stored_reaction = await Reaction.upsert_reaction(self.session, reaction)
                logger.info(
                    f"Stored/updated reaction from {reaction.sender_jid} on message {reaction.message_id}"
                )
                return stored_reaction

        except Exception as e:
            logger.error(f"Error storing reaction: {e}")
            return None

    async def send_message(
        self,
        to_jid: str,
        message: str,
        in_reply_to: str | None = None,
        mentions: Sequence[str] = (),
    ) -> Message:
        """
        Send a message to a JID over WhatsApp, and store the message in the database
        :param to_jid: The JID to send the message to
        :param message: The message text to send
        :param in_reply_to: The JID of the message to reply to [Optional]
        :param mentions: JIDs tagged in the message text as @<number> [Optional]
        :return: The stored message
        """
        assert to_jid, "to_jid is required"
        assert message, "message is required"
        to_jid = normalize_jid(to_jid)

        if mentions:
            sent_message_id = await self.whatsapp.send_text(
                to_jid, message, in_reply_to, mentions=mentions
            )
        else:
            sent_message_id = await self.whatsapp.send_text(
                to_jid, message, in_reply_to
            )
        assert sent_message_id, "Failed to get sent message ID"
        my_number = await self.whatsapp.get_my_jid()
        new_message = BaseMessage(
            message_id=sent_message_id,
            text=message,
            sender_jid=str(my_number),
            chat_jid=to_jid,
            reply_to_id=in_reply_to,
        )
        stored_message = await self.store_message(Message(**new_message.model_dump()))
        assert stored_message, "Failed to store message"
        return stored_message

    async def upsert(self, model):
        return await upsert(self.session, model)
