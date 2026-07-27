from datetime import datetime

from pydantic import BaseModel


class SeasonOut(BaseModel):
    id: int
    label: str
    isCurrent: bool


class SeasonsResponse(BaseModel):
    seasons: list[SeasonOut]
    currentSeason: int


class PoolOut(BaseModel):
    id: str
    name: str
    bonus: float


class ConfigResponse(BaseModel):
    pools: list[PoolOut]
    defaultWinratePool: str | None


class SeasonInfoResponse(BaseModel):
    totalCombats: int


class LeaderboardPlayerOut(BaseModel):
    dofus_pseudo: str
    avatar_url: str | None
    total_points: int
    atk_points: int
    def_points: int
    wins: int
    losses: int
    winrate: int
    rank_change: int


class MatchParticipantOut(BaseModel):
    name: str
    is_winner: bool


class MatchOut(BaseModel):
    id: int
    alliance: str
    points: int
    context: str
    has_won: bool
    created_at: datetime | None
    winners: list[str]
    losers: list[str]


class PoolStatsOut(BaseModel):
    name: str
    total: int
    wins: int
    losses: int
    winrate: int
    total_points: int
    attacks: int
    defenses: int
    atk_winrate: int
    def_winrate: int
    top_players: list[dict]


class StatsResponse(BaseModel):
    pools: list[PoolStatsOut]
    hours: list[int]
