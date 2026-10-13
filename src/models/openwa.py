from datetime import datetime
from typing import Optional

from sqlmodel import Column, DateTime, Field, SQLModel


class OpenWAConnection(SQLModel, table=True):
    """The single OpenWA server connection (row id is always 1)."""

    __tablename__: str = "openwa_connection"

    id: int = Field(default=1, primary_key=True)
    base_url: str
    api_key_enc: str
    webhook_secret_enc: str
    webhook_url: str = ""
    updated_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )


class OpenWASession(SQLModel, table=True):
    """A WhatsApp session hosted on the OpenWA server."""

    __tablename__: str = "openwa_session"

    id: str = Field(primary_key=True, max_length=64)
    label: str = Field(max_length=100)
    openwa_session_id: str = Field(unique=True, max_length=255)
    enabled: bool = True
    status: Optional[str] = None
    status_checked_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
