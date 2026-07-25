"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-07-25
"""
import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("discord_id", sa.String(255), unique=True),
        sa.Column("discord_username", sa.String(255)),
        sa.Column("discord_nickname", sa.String(255)),
        sa.Column("avatar_url", sa.Text),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "characters",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("account_id", sa.Integer, sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("dofus_pseudo", sa.String(255), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index("idx_characters_account", "characters", ["account_id"])

    op.create_table(
        "seasons",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=False),
        sa.Column("start_date", sa.Date, nullable=False),
        sa.Column("end_date", sa.Date, nullable=False),
    )

    op.create_table(
        "season_stats",
        sa.Column("account_id", sa.Integer, sa.ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("season_id", sa.Integer, sa.ForeignKey("seasons.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("points", sa.Integer, server_default="0"),
        sa.Column("wins", sa.Integer, server_default="0"),
        sa.Column("losses", sa.Integer, server_default="0"),
        sa.Column("previous_rank", sa.Integer),
        sa.Column("nuggets", sa.Integer, server_default="0"),
        sa.Column("atk_points", sa.Integer, server_default="0"),
        sa.Column("def_points", sa.Integer, server_default="0"),
    )
    op.create_index("idx_season_stats_season", "season_stats", ["season_id"])

    op.create_table(
        "matches",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("season_id", sa.Integer, sa.ForeignKey("seasons.id")),
        sa.Column("alliance_tier", sa.String(50)),
        sa.Column("points_awarded", sa.Integer, server_default="0"),
        sa.Column("context", sa.Text, server_default="attack"),
        sa.Column("has_won", sa.Boolean, server_default=sa.true()),
        sa.Column("cancelled", sa.Boolean, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "match_participants",
        sa.Column("match_id", sa.Integer, sa.ForeignKey("matches.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("character_id", sa.Integer, sa.ForeignKey("characters.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("is_winner", sa.Boolean, nullable=False),
    )
    op.create_index("idx_match_participants_character", "match_participants", ["character_id"])

    op.create_table(
        "settings",
        sa.Column("key", sa.Text, primary_key=True),
        sa.Column("value", sa.Text),
    )

    op.create_table(
        "nuggets",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("discord_id", sa.Text),
        sa.Column("amount", sa.Integer),
        sa.Column("image_hash", sa.Text),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "prism_requests",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("player_name", sa.String(255)),
        sa.Column("discord_user_id", sa.Text),
        sa.Column("discord_message_id", sa.Text),
        sa.Column("image_url", sa.Text),
        sa.Column("total_kamas", sa.Integer),
        sa.Column("status", sa.String(20), server_default="pending"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("validated_at", sa.DateTime),
        sa.Column("validated_by", sa.String(255)),
    )


def downgrade() -> None:
    op.drop_table("prism_requests")
    op.drop_table("nuggets")
    op.drop_table("settings")
    op.drop_table("match_participants")
    op.drop_table("matches")
    op.drop_table("season_stats")
    op.drop_table("seasons")
    op.drop_table("characters")
    op.drop_table("accounts")
