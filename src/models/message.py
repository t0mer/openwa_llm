from datetime import datetime, timezone
from typing import TYPE_CHECKING, List, Optional

from pydantic import field_validator, model_validator
from sqlmodel import Field, Relationship, SQLModel, Column, DateTime


from whatsapp.jid import normalize_jid, parse_jid, JID
from whatsapp.types import InboundMessage
from .kb_topic_message import KBTopicMessage

if TYPE_CHECKING:
    from .group import Group
    from .sender import Sender
    from .reaction import Reaction
    from .knowledge_base_topic import KBTopic


class BaseMessage(SQLModel):
    message_id: str = Field(primary_key=True, max_length=255)
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    text: Optional[str] = Field(default=None)
    media_url: Optional[str] = Field(default=None)
    chat_jid: str = Field(max_length=255)
    sender_jid: str = Field(max_length=255, foreign_key="sender.jid")
    group_jid: Optional[str] = Field(
        max_length=255,
        foreign_key="group.group_jid",
        nullable=True,
        default=None,
    )
    reply_to_id: Optional[str] = Field(default=None, nullable=True)

    @model_validator(mode="before")
    @classmethod
    def validate_chat_jid(cls, data) -> dict:
        if "chat_jid" not in data:
            return data

        jid = parse_jid(data["chat_jid"])

        if jid.is_group():
            data["group_jid"] = str(jid.to_non_ad())

        data["chat_jid"] = str(jid.to_non_ad())
        return data

    @field_validator("group_jid", "sender_jid", mode="before")
    @classmethod
    def normalize(cls, value: Optional[str]) -> str | None:
        return normalize_jid(value) if value else None

    def has_mentioned(self, jid: str | JID) -> bool:
        if isinstance(jid, str):
            jid = parse_jid(jid)

        if not self.text:
            return False
        return f"@{jid.user}" in self.text


class Message(BaseMessage, table=True):
    sender: Optional["Sender"] = Relationship(
        back_populates="messages", sa_relationship_kwargs={"lazy": "selectin"}
    )
    group: Optional["Group"] = Relationship(
        back_populates="messages", sa_relationship_kwargs={"lazy": "selectin"}
    )
    replies: List["Message"] = Relationship(
        sa_relationship_kwargs={
            "primaryjoin": "Message.message_id==foreign(Message.reply_to_id)",
            "remote_side": "Message.message_id",  # Add this to clarify direction
            "backref": "replied_to",
        }
    )
    # Reactions relationship - one message can have many reactions
    reactions: List["Reaction"] = Relationship(
        back_populates="message", sa_relationship_kwargs={"lazy": "selectin"}
    )

    kb_topics: List["KBTopic"] = Relationship(
        back_populates="messages", link_model=KBTopicMessage
    )

    @classmethod
    def from_inbound(cls, m: InboundMessage) -> "Message":
        """Create a Message from a gateway-neutral inbound message."""
        return cls(
            **BaseMessage(
                message_id=m.id,
                text=m.text,
                chat_jid=m.chat_jid,
                sender_jid=normalize_jid(m.sender_jid),
                timestamp=m.timestamp,
                reply_to_id=m.reply_to_id,
                media_url=m.media_url,
            ).model_dump()
        )


Message.model_rebuild()
