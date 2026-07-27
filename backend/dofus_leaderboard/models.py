from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Account(Base):
    """L'entité "joueur" au sens humain : un compte Discord (ou, à défaut de lien,
    un compte autonome créé pour un seul personnage). Toujours l'unité d'agrégation
    pour les stats — plus jamais de COALESCE(discord_id, dofus_pseudo) à la volée."""

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    discord_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    discord_username: Mapped[str | None] = mapped_column(String(255))
    discord_nickname: Mapped[str | None] = mapped_column(String(255))
    avatar_url: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    characters: Mapped[list["Character"]] = relationship(back_populates="account")
    season_stats: Mapped[list["SeasonStat"]] = relationship(back_populates="account")


class Character(Base):
    """Un personnage Dofus. Rattaché à un compte dès sa création (account_id n'est
    jamais NULL) — élimine la classe de bug "personnage orphelin jamais lié"."""

    __tablename__ = "characters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    dofus_pseudo: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    account: Mapped["Account"] = relationship(back_populates="characters")

    __table_args__ = (Index("idx_characters_account", "account_id"),)


class Season(Base):
    __tablename__ = "seasons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)


class SeasonStat(Base):
    __tablename__ = "season_stats"

    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id", ondelete="CASCADE"), primary_key=True)
    points: Mapped[int] = mapped_column(Integer, default=0)
    wins: Mapped[int] = mapped_column(Integer, default=0)
    losses: Mapped[int] = mapped_column(Integer, default=0)
    previous_rank: Mapped[int | None] = mapped_column(Integer)
    nuggets: Mapped[int] = mapped_column(Integer, default=0)
    atk_points: Mapped[int] = mapped_column(Integer, default=0)
    def_points: Mapped[int] = mapped_column(Integer, default=0)

    account: Mapped["Account"] = relationship(back_populates="season_stats")

    __table_args__ = (Index("idx_season_stats_season", "season_id"),)


class Match(Base):
    __tablename__ = "matches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    season_id: Mapped[int | None] = mapped_column(ForeignKey("seasons.id"))
    alliance_tier: Mapped[str | None] = mapped_column(String(50))
    points_awarded: Mapped[int] = mapped_column(Integer, default=0)
    context: Mapped[str] = mapped_column(Text, default="attack")
    has_won: Mapped[bool] = mapped_column(Boolean, default=True)
    cancelled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    participants: Mapped[list["MatchParticipant"]] = relationship(back_populates="match")


class MatchParticipant(Base):
    """Jointure match <-> personnage. On garde le grain "personnage" (pas "compte")
    ici parce que c'est ce qui apparaît réellement dans le screenshot de combat ;
    l'agrégation par compte se fait via characters.account_id au moment de la lecture."""

    __tablename__ = "match_participants"

    match_id: Mapped[int] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), primary_key=True)
    character_id: Mapped[int] = mapped_column(ForeignKey("characters.id", ondelete="CASCADE"), primary_key=True)
    is_winner: Mapped[bool] = mapped_column(Boolean, nullable=False)

    match: Mapped["Match"] = relationship(back_populates="participants")
    character: Mapped["Character"] = relationship()

    # Index dédié : la PK est (match_id, character_id), donc une recherche par seul
    # character_id (ex: "tous les matchs de ce perso") ne peut pas s'appuyer dessus.
    __table_args__ = (Index("idx_match_participants_character", "character_id"),)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[str | None] = mapped_column(Text)


class Nugget(Base):
    __tablename__ = "nuggets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    discord_id: Mapped[str | None] = mapped_column(Text)
    amount: Mapped[int | None] = mapped_column(Integer)
    image_hash: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
