import logging
from collections.abc import Sequence

from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import insert
from sqlmodel import col, select
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
        session_id: str,
    ):
        self.session = session
        self.whatsapp = whatsapp
        self.embedding_client = embedding_client
        self.session_id = session_id

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
            message = Message.from_inbound(message, self.session_id)

        if isinstance(message, BaseMessage):
            message = Message(**message.model_dump())

        if not message.text:
            return message  # Don't store messages without text

        if await self._foreign_group(message.group_jid):
            return None  # Another session owns this group: not ours to store

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

            if message.group_jid and not await self._claim_group(message.group_jid):
                return None  # Another session created the group meanwhile

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
            message = await self.session.get(Message, reaction.message_id)
            if message is None:
                logger.warning(f"Message {reaction.message_id} not found for reaction")
            elif await self._foreign_group(message.group_jid):
                return None  # Reaction in a group another session owns

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
            session_id=self.session_id,
        )
        stored_message = await self.store_message(Message(**new_message.model_dump()))
        assert stored_message, "Failed to store message"
        return stored_message

    async def _foreign_group(self, group_jid: str | None) -> bool:
        """True when the group exists and belongs to another session."""
        if not group_jid:
            return False
        group = await self.session.get(Group, group_jid)
        return group is not None and group.session_id != self.session_id

    async def _claim_group(self, group_jid: str) -> bool:
        """Create the group for this session unless it exists; True if it is ours.

        ON CONFLICT DO NOTHING never overwrites a row another session created
        concurrently; the re-read decides who owns it.
        """
        group = Group(
            **BaseGroup(group_jid=group_jid, session_id=self.session_id).model_dump()
        )
        await self.session.execute(
            insert(Group)
            .values(**{c.name: getattr(group, c.name) for c in inspect(Group).columns})
            .on_conflict_do_nothing(index_elements=["group_jid"])
        )
        owner = await self.session.scalar(
            select(Group.session_id).where(col(Group.group_jid) == group_jid)
        )
        return owner == self.session_id

    async def upsert(self, model):
        return await upsert(self.session, model)
