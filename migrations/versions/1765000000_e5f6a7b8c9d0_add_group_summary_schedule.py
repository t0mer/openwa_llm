"""add group_summary_schedule table

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-10-09

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "group_summary_schedule",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("group_jid", sa.String(length=255), nullable=False),
        sa.Column("weekdays", sa.ARRAY(sa.Integer()), nullable=False),
        sa.Column("hour", sa.Integer(), nullable=False),
        sa.Column("minute", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(length=16), nullable=True),
        sa.Column("last_reason", sa.String(length=64), nullable=True),
        sa.Column("last_message_count", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["group_jid"], ["group.group_jid"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_group_summary_schedule_group_jid"),
        "group_summary_schedule",
        ["group_jid"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_group_summary_schedule_group_jid"), table_name="group_summary_schedule"
    )
    op.drop_table("group_summary_schedule")
