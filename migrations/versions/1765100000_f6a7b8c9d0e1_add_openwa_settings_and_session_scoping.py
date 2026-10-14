"""add openwa connection/session tables and scope groups and messages to a session

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-10-13

Existing rows are backfilled onto one session. Its OpenWA session id comes
from the OPENWA_SESSION_ID environment variable, falling back to Settings
(which also reads .env); without it the session is created as a disabled
'default' placeholder (only when rows exist).

"""

import os
from typing import Sequence, Union
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCOPED_TABLES = ("group", "message")


def _legacy_session_id() -> str | None:
    """OPENWA_SESSION_ID from the process env, else from Settings (.env)."""
    if value := os.environ.get("OPENWA_SESSION_ID"):
        return value
    try:
        from config import Settings

        return Settings.model_validate({}).openwa_session_id or None
    except Exception:
        return None  # missing/invalid settings must never break the migration


def upgrade() -> None:
    op.create_table(
        "openwa_connection",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("base_url", sa.String(), nullable=False),
        sa.Column("api_key_enc", sa.String(), nullable=False),
        sa.Column("webhook_secret_enc", sa.String(), nullable=False),
        sa.Column("webhook_url", sa.String(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "openwa_session",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("openwa_session_id", sa.String(length=255), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("status_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("openwa_session_id"),
    )
    for table in SCOPED_TABLES:
        op.add_column(
            table, sa.Column("session_id", sa.String(length=64), nullable=True)
        )

    env_session = _legacy_session_id()
    conn = op.get_bind()
    has_rows = any(
        conn.execute(sa.text(f'SELECT EXISTS (SELECT 1 FROM "{table}")')).scalar()
        for table in SCOPED_TABLES
    )
    if env_session or has_rows:
        session_id = uuid4().hex
        conn.execute(
            sa.text(
                "INSERT INTO openwa_session (id, label, openwa_session_id, enabled) "
                "VALUES (:id, 'default', :openwa_session_id, :enabled)"
            ),
            {
                "id": session_id,
                "openwa_session_id": env_session or "default",
                "enabled": bool(env_session),
            },
        )
        for table in SCOPED_TABLES:
            conn.execute(
                sa.text(f'UPDATE "{table}" SET session_id = :id'),
                {"id": session_id},
            )

    for table in SCOPED_TABLES:
        op.alter_column(table, "session_id", nullable=False)
        op.create_foreign_key(
            f"{table}_session_id_fkey",
            table,
            "openwa_session",
            ["session_id"],
            ["id"],
        )
        op.create_index(f"ix_{table}_session_id", table, ["session_id"], unique=False)


def downgrade() -> None:
    for table in reversed(SCOPED_TABLES):
        op.drop_index(f"ix_{table}_session_id", table_name=table)
        op.drop_constraint(f"{table}_session_id_fkey", table, type_="foreignkey")
        op.drop_column(table, "session_id")
    op.drop_table("openwa_session")
    op.drop_table("openwa_connection")
