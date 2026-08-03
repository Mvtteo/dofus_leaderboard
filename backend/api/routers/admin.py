import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from dofus_leaderboard.config import settings
from dofus_leaderboard.database import get_db
from dofus_leaderboard.services import ensure_current_season, get_account_detail, update_season_stats
from dofus_leaderboard.settings_store import live_config, save_setting

from ..deps import (
    ADMIN_TOKENS,
    check_rate_limit,
    client_ip,
    is_admin,
    record_failed_login,
    require_admin,
)

router = APIRouter(prefix="/admin")


# ============================================
# AUTH
# ============================================
class LoginIn(BaseModel):
    password: str


@router.post("/login")
def admin_login(body: LoginIn, request: Request, response: Response):
    ip = client_ip(request)
    if not check_rate_limit(ip):
        raise HTTPException(status_code=429, detail="Trop de tentatives. Réessayez dans 15 minutes.")

    if body.password == settings.ADMIN_PASSWORD:
        token = secrets.token_hex(32)
        ADMIN_TOKENS.add(token)
        response.set_cookie(
            "admin_token", token, path="/admin", httponly=True, samesite="strict", max_age=86400
        )
        return {"ok": True}

    record_failed_login(ip)
    raise HTTPException(status_code=401, detail="Mot de passe incorrect.")


@router.post("/logout")
def admin_logout(request: Request, response: Response):
    token = request.cookies.get("admin_token")
    if token:
        ADMIN_TOKENS.discard(token)
    response.delete_cookie("admin_token", path="/admin")
    return {"ok": True}


@router.get("/api/me")
def admin_me(authed: bool = Depends(is_admin)):
    return {"authenticated": authed}


# ============================================
# SETTINGS / POOLS / POINTS GRID
# ============================================
class PoolIn(BaseModel):
    id: str
    name: str
    bonus: float


class PoolsIn(BaseModel):
    pools: list[PoolIn]


@router.get("/api/settings", dependencies=[Depends(require_admin)])
def admin_settings(db: Session = Depends(get_db)):
    from dofus_leaderboard.seasons import get_seasons

    seasons, current_season = get_seasons(live_config.season_end_override)
    cur_season = next((s for s in seasons if s.id == current_season), None)
    return {
        "pools": live_config.pools,
        "maxPools": 5,
        "seasons": [{"id": s.id, "label": s.label, "isCurrent": s.is_current} for s in seasons],
        "currentSeason": current_season,
        "curSeasonStartRaw": cur_season.start.date().isoformat() if cur_season else None,
        "curSeasonEndRaw": cur_season.end_raw if cur_season else None,
        "ptsAtkWin": live_config.pts_atk_win,
        "ptsAtkLose": live_config.pts_atk_lose,
        "ptsDefWin": live_config.pts_def_win,
        "ptsDefLose": live_config.pts_def_lose,
        "defaultWinratePool": live_config.default_winrate_pool,
    }


@router.post("/api/pools", dependencies=[Depends(require_admin)])
def admin_set_pools(body: PoolsIn, db: Session = Depends(get_db)):
    if len(body.pools) > 5:
        raise HTTPException(status_code=400, detail="Maximum 5 pools.")
    import json

    save_setting(db, "pools", json.dumps([p.model_dump() for p in body.pools]))
    return {"ok": True, "pools": live_config.pools}


class PointsGridIn(BaseModel):
    pts_atk_win: list[list[float]]
    pts_atk_lose: list[list[float]]
    pts_def_win: list[list[float]]
    pts_def_lose: list[list[float]]


@router.post("/api/points-grid", dependencies=[Depends(require_admin)])
def admin_points_grid(body: PointsGridIn, db: Session = Depends(get_db)):
    import json

    for name, grid in body.model_dump().items():
        if len(grid) != 5 or any(len(row) != 5 for row in grid):
            raise HTTPException(status_code=400, detail=f"Grille {name} invalide (5x5 attendu).")
    save_setting(db, "pts_atk_win", json.dumps(body.pts_atk_win))
    save_setting(db, "pts_atk_lose", json.dumps(body.pts_atk_lose))
    save_setting(db, "pts_def_win", json.dumps(body.pts_def_win))
    save_setting(db, "pts_def_lose", json.dumps(body.pts_def_lose))
    return {"ok": True}


class SeasonEndIn(BaseModel):
    end_date: str | None = None


@router.post("/api/season-end", dependencies=[Depends(require_admin)])
def admin_season_end(body: SeasonEndIn, db: Session = Depends(get_db)):
    from datetime import datetime

    from dofus_leaderboard.seasons import get_seasons

    if not body.end_date:
        live_config.season_end_override = None
        save_setting(db, "season_end_override", "")
        return {"ok": True, "cleared": True}

    try:
        datetime.fromisoformat(body.end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Date invalide.")

    save_setting(db, "season_end_override", body.end_date)

    seasons, current_season = get_seasons(live_config.season_end_override)
    cur_season = next((s for s in seasons if s.id == current_season), None)

    return {"ok": True, "curSeason": cur_season.end_raw if cur_season else None}


class DefaultWinratePoolIn(BaseModel):
    pool_id: str | None = None


@router.post("/api/default-winrate-pool", dependencies=[Depends(require_admin)])
def admin_default_winrate_pool(body: DefaultWinratePoolIn, db: Session = Depends(get_db)):
    save_setting(db, "default_winrate_pool", body.pool_id or "")
    return {"ok": True, "pool_id": live_config.default_winrate_pool}


# ============================================
# PLAYERS / POINTS
# ============================================
@router.get("/api/players", dependencies=[Depends(require_admin)])
def admin_players(db: Session = Depends(get_db)):
    season_id = ensure_current_season(db)
    rows = db.execute(
        text(
            """
            SELECT DISTINCT COALESCE(a.discord_nickname, a.discord_username, c.dofus_pseudo) as name
            FROM accounts a
            JOIN season_stats ss ON ss.account_id = a.id
            LEFT JOIN characters c ON c.account_id = a.id
            WHERE ss.season_id = :season_id AND (ss.wins + ss.losses) > 0
            ORDER BY name
            """
        ),
        {"season_id": season_id},
    ).mappings().all()
    return [r["name"] for r in rows]


@router.get("/api/player-stats/{pseudo}", dependencies=[Depends(require_admin)])
def admin_player_stats(pseudo: str, db: Session = Depends(get_db)):
    # Pas de JOIN characters ici : un compte a potentiellement plusieurs persos, et
    # season_stats n'a qu'UNE ligne par compte — un JOIN characters dupliquerait cette
    # ligne et fausserait la somme (déjà vu et corrigé dans get_leaderboard_players).
    season_id = ensure_current_season(db)
    row = db.execute(
        text(
            """
            SELECT COALESCE(ss.points, 0) as points
            FROM accounts a
            LEFT JOIN season_stats ss ON ss.account_id = a.id AND ss.season_id = :season_id
            WHERE a.discord_id = :pseudo
               OR LOWER(a.discord_nickname) = LOWER(:pseudo) OR LOWER(a.discord_username) = LOWER(:pseudo)
               OR EXISTS (SELECT 1 FROM characters c WHERE c.account_id = a.id AND LOWER(c.dofus_pseudo) = LOWER(:pseudo))
            """
        ),
        {"season_id": season_id, "pseudo": pseudo},
    ).mappings().first()
    return {"points": int(row["points"]) if row else 0}


class PlayerPointsIn(BaseModel):
    pseudo: str
    points: int


@router.post("/api/player-points", dependencies=[Depends(require_admin)])
def admin_player_points(body: PlayerPointsIn, db: Session = Depends(get_db)):
    account = db.execute(
        text(
            """
            SELECT a.id, COALESCE(a.discord_nickname, a.discord_username, MIN(c.dofus_pseudo)) as name
            FROM accounts a
            LEFT JOIN characters c ON c.account_id = a.id
            WHERE a.discord_id = :pseudo OR LOWER(c.dofus_pseudo) = LOWER(:pseudo)
               OR LOWER(a.discord_nickname) = LOWER(:pseudo) OR LOWER(a.discord_username) = LOWER(:pseudo)
            GROUP BY a.id
            """
        ),
        {"pseudo": body.pseudo},
    ).mappings().first()
    if not account:
        raise HTTPException(status_code=404, detail="Joueur introuvable.")

    season_id = ensure_current_season(db)
    update_season_stats(db, account["id"], season_id, points=body.points)

    total = db.execute(
        text("SELECT SUM(points) as total FROM season_stats WHERE account_id = :aid AND season_id = :sid"),
        {"aid": account["id"], "sid": season_id},
    ).mappings().first()

    return {"ok": True, "pseudo": account["name"], "delta": body.points, "newTotal": int(total["total"] or 0)}


@router.get("/api/multi-accounts", dependencies=[Depends(require_admin)])
def admin_multi_accounts(db: Session = Depends(get_db)):
    rows = db.execute(
        text(
            """
            SELECT a.discord_nickname, a.discord_username, a.avatar_url,
                array_agg(c.dofus_pseudo ORDER BY c.created_at ASC) as characters,
                COUNT(*) as count
            FROM characters c
            JOIN accounts a ON a.id = c.account_id
            GROUP BY a.id, a.discord_nickname, a.discord_username, a.avatar_url
            HAVING COUNT(*) > 1
            ORDER BY count DESC
            """
        )
    ).mappings().all()
    return [dict(r) for r in rows]


@router.get("/api/account/{identifier}", dependencies=[Depends(require_admin)])
def admin_account_detail(identifier: str, db: Session = Depends(get_db)):
    detail = get_account_detail(db, identifier)
    if not detail:
        raise HTTPException(status_code=404, detail="Compte introuvable.")
    return detail


# ============================================
# NUGGETS
# ============================================
@router.get("/api/nuggets/{season_id}", dependencies=[Depends(require_admin)])
def admin_nuggets(season_id: int, db: Session = Depends(get_db)):
    rows = db.execute(
        text(
            """
            SELECT COALESCE(a.discord_nickname, MIN(c.dofus_pseudo)) as name, ss.nuggets as nuggets
            FROM season_stats ss
            JOIN accounts a ON a.id = ss.account_id
            LEFT JOIN characters c ON c.account_id = a.id
            WHERE ss.season_id = :season_id AND ss.nuggets > 0
            GROUP BY a.id, ss.nuggets
            ORDER BY nuggets DESC
            """
        ),
        {"season_id": season_id},
    ).mappings().all()
    return [dict(r) for r in rows]


@router.post("/api/reset-nuggets", dependencies=[Depends(require_admin)])
def admin_reset_nuggets(db: Session = Depends(get_db)):
    season_id = ensure_current_season(db)
    db.execute(
        text("UPDATE season_stats SET nuggets = 0 WHERE season_id = :season_id AND nuggets > 0"),
        {"season_id": season_id},
    )
    db.commit()
    return {"ok": True, "seasonId": season_id}


# ============================================
# MATCHES
# ============================================
def _serialize_match(m: dict) -> dict:
    pool_obj = next((p for p in live_config.pools if p["id"] == m["alliance_tier"]), None)
    participants = m["participants"] or []
    return {
        "id": m["id"],
        "alliance": pool_obj["name"] if pool_obj else m["alliance_tier"],
        "points_awarded": m["points_awarded"],
        "context": m["context"],
        "has_won": m["has_won"] is not False,
        "created_at": m["created_at"],
        "cancelled": m["cancelled"] or False,
        "winners": [p["name"] for p in participants if p["is_winner"]],
        "losers": [p["name"] for p in participants if not p["is_winner"]],
    }


@router.get("/api/player-matches/{pseudo}", dependencies=[Depends(require_admin)])
def admin_player_matches(pseudo: str, db: Session = Depends(get_db)):
    # Un joueur = un compte, potentiellement plusieurs persos : on récupère les matchs de
    # TOUS ses persos, pas seulement celui qui porte le pseudo cherché.
    season_id = ensure_current_season(db)
    rows = db.execute(
        text(
            """
            SELECT m.id, m.alliance_tier, m.points_awarded, m.context, m.has_won, m.created_at, m.cancelled,
                (SELECT json_agg(json_build_object('name', COALESCE(a2.discord_nickname, c2.dofus_pseudo), 'is_winner', mp2.is_winner))
                 FROM match_participants mp2
                 JOIN characters c2 ON c2.id = mp2.character_id
                 JOIN accounts a2 ON a2.id = c2.account_id
                 WHERE mp2.match_id = m.id) as participants
            FROM matches m
            WHERE m.season_id = :season_id
            AND m.id IN (
                SELECT DISTINCT mp.match_id FROM match_participants mp
                JOIN characters c ON c.id = mp.character_id
                WHERE c.account_id = (
                    SELECT a.id FROM accounts a
                    LEFT JOIN characters c3 ON c3.account_id = a.id
                    WHERE a.discord_id = :pseudo OR LOWER(c3.dofus_pseudo) = LOWER(:pseudo)
                       OR LOWER(a.discord_nickname) = LOWER(:pseudo) OR LOWER(a.discord_username) = LOWER(:pseudo)
                    LIMIT 1
                )
            )
            ORDER BY m.created_at DESC NULLS LAST, m.id DESC
            LIMIT 25
            """
        ),
        {"season_id": season_id, "pseudo": pseudo},
    ).mappings().all()
    return [_serialize_match(dict(r)) for r in rows]


@router.get("/api/recent-matches", dependencies=[Depends(require_admin)])
def admin_recent_matches(db: Session = Depends(get_db)):
    season_id = ensure_current_season(db)
    rows = db.execute(
        text(
            """
            SELECT m.id, m.alliance_tier, m.points_awarded, m.context, m.has_won, m.created_at, m.cancelled,
                json_agg(json_build_object('name', COALESCE(a.discord_nickname, c.dofus_pseudo), 'is_winner', mp.is_winner)) as participants
            FROM matches m
            LEFT JOIN match_participants mp ON mp.match_id = m.id
            LEFT JOIN characters c ON c.id = mp.character_id
            LEFT JOIN accounts a ON a.id = c.account_id
            WHERE m.season_id = :season_id
            GROUP BY m.id
            ORDER BY m.created_at DESC NULLS LAST, m.id DESC
            LIMIT 25
            """
        ),
        {"season_id": season_id},
    ).mappings().all()
    return [_serialize_match(dict(r)) for r in rows]


class MatchPointsIn(BaseModel):
    points: int


@router.patch("/api/match/{match_id}/points", dependencies=[Depends(require_admin)])
def admin_match_points(match_id: int, body: MatchPointsIn, db: Session = Depends(get_db)):
    match = db.execute(text("SELECT * FROM matches WHERE id = :id"), {"id": match_id}).mappings().first()
    if not match:
        raise HTTPException(status_code=404, detail="Match introuvable.")
    if match["cancelled"]:
        raise HTTPException(status_code=400, detail="Match annulé, impossible de modifier.")

    delta = body.points - match["points_awarded"]
    is_win = match["has_won"]

    ally_rows = db.execute(
        text(
            """
            SELECT DISTINCT c.account_id FROM match_participants mp
            JOIN characters c ON c.id = mp.character_id
            WHERE mp.match_id = :mid AND mp.is_winner = :is_win
            """
        ),
        {"mid": match_id, "is_win": is_win},
    ).mappings().all()
    for row in ally_rows:
        db.execute(
            text("UPDATE season_stats SET points = points + :delta WHERE account_id = :aid AND season_id = :sid"),
            {"delta": delta, "aid": row["account_id"], "sid": match["season_id"]},
        )
    db.execute(text("UPDATE matches SET points_awarded = :pts WHERE id = :id"), {"pts": body.points, "id": match_id})
    db.commit()
    return {"ok": True}


@router.delete("/api/match/{match_id}", dependencies=[Depends(require_admin)])
def admin_cancel_match(match_id: int, db: Session = Depends(get_db)):
    match = db.execute(text("SELECT * FROM matches WHERE id = :id"), {"id": match_id}).mappings().first()
    if not match:
        raise HTTPException(status_code=404, detail="Match introuvable.")
    if match["cancelled"]:
        raise HTTPException(status_code=400, detail="Match déjà annulé.")

    pts = match["points_awarded"]
    is_win = match["has_won"]

    ally_rows = db.execute(
        text(
            """
            SELECT DISTINCT c.account_id FROM match_participants mp
            JOIN characters c ON c.id = mp.character_id
            WHERE mp.match_id = :mid AND mp.is_winner = :is_win
            """
        ),
        {"mid": match_id, "is_win": is_win},
    ).mappings().all()
    for row in ally_rows:
        db.execute(
            text(
                """
                UPDATE season_stats SET
                    points = GREATEST(0, points - :pts),
                    wins = GREATEST(0, wins - :win_delta),
                    losses = GREATEST(0, losses - :loss_delta)
                WHERE account_id = :aid AND season_id = :sid
                """
            ),
            {
                "pts": pts,
                "win_delta": 1 if is_win else 0,
                "loss_delta": 0 if is_win else 1,
                "aid": row["account_id"],
                "sid": match["season_id"],
            },
        )
    db.execute(text("UPDATE matches SET cancelled = true, points_awarded = 0 WHERE id = :id"), {"id": match_id})
    db.commit()
    return {"ok": True}
