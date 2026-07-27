from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from dofus_leaderboard.database import get_db
from dofus_leaderboard.services import ensure_current_season, get_leaderboard_players
from dofus_leaderboard.seasons import get_seasons
from dofus_leaderboard.settings_store import live_config

router = APIRouter(prefix="/api")


@router.get("/seasons")
def api_seasons():
    seasons, current_season = get_seasons(live_config.season_end_override)
    return {
        "seasons": [{"id": s.id, "label": s.label, "isCurrent": s.is_current} for s in seasons],
        "currentSeason": current_season,
    }


@router.get("/config")
def api_config():
    return {"pools": live_config.pools, "defaultWinratePool": live_config.default_winrate_pool}


@router.get("/season-info/{season_id}")
def api_season_info(season_id: int, db: Session = Depends(get_db)):
    count = db.execute(
        text("SELECT COUNT(*) FROM matches WHERE season_id = :season_id AND NOT COALESCE(cancelled, false)"),
        {"season_id": season_id},
    ).scalar_one()
    return {"totalCombats": int(count)}


@router.get("/leaderboard/{season_id}")
def api_leaderboard(season_id: int, db: Session = Depends(get_db)):
    return get_leaderboard_players(db, season_id)


@router.get("/matches/{season_id}")
def api_matches(season_id: int, limit: int = 20, db: Session = Depends(get_db)):
    limit = min(limit, 50)
    rows = db.execute(
        text(
            """
            SELECT m.id, m.alliance_tier, m.points_awarded, m.context, m.has_won, m.created_at,
                   json_agg(json_build_object(
                       'name', COALESCE(a.discord_nickname, c.dofus_pseudo),
                       'is_winner', mp.is_winner
                   )) as participants
            FROM matches m
            LEFT JOIN match_participants mp ON mp.match_id = m.id
            LEFT JOIN characters c ON c.id = mp.character_id
            LEFT JOIN accounts a ON a.id = c.account_id
            WHERE m.season_id = :season_id
            GROUP BY m.id
            ORDER BY m.created_at DESC NULLS LAST, m.id DESC
            LIMIT :limit
            """
        ),
        {"season_id": season_id, "limit": limit},
    ).mappings().all()

    matches = []
    for m in rows:
        pool_obj = next((p for p in live_config.pools if p["id"] == m["alliance_tier"]), None)
        participants = m["participants"] or []
        matches.append(
            {
                "id": m["id"],
                "alliance": pool_obj["name"] if pool_obj else m["alliance_tier"],
                "points": m["points_awarded"],
                "context": m["context"] or "attack",
                "has_won": m["has_won"] is not False,
                "created_at": m["created_at"],
                "winners": [p["name"] for p in participants if p["is_winner"]],
                "losers": [p["name"] for p in participants if not p["is_winner"]],
            }
        )
    return matches


@router.get("/stats/{season_id}")
def api_stats(season_id: int, db: Session = Depends(get_db)):
    pool_stats = db.execute(
        text(
            """
            SELECT
                m.alliance_tier,
                COUNT(*) as total,
                SUM(CASE WHEN m.has_won = true THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN m.has_won = false THEN 1 ELSE 0 END) as losses,
                SUM(m.points_awarded) as total_points,
                SUM(CASE WHEN m.context = 'attack' THEN 1 ELSE 0 END) as attacks,
                SUM(CASE WHEN m.context = 'defense' THEN 1 ELSE 0 END) as defenses,
                SUM(CASE WHEN m.context = 'attack' AND m.has_won = true THEN 1 ELSE 0 END) as atk_wins,
                SUM(CASE WHEN m.context = 'defense' AND m.has_won = true THEN 1 ELSE 0 END) as def_wins
            FROM matches m
            WHERE m.season_id = :season_id
            GROUP BY m.alliance_tier
            """
        ),
        {"season_id": season_id},
    ).mappings().all()

    top_players = db.execute(
        text(
            """
            SELECT
                m.alliance_tier,
                COALESCE(a.discord_nickname, a.discord_username, MIN(c.dofus_pseudo)) as name,
                COUNT(*) as wins
            FROM matches m
            JOIN match_participants mp ON mp.match_id = m.id
            JOIN characters c ON c.id = mp.character_id
            JOIN accounts a ON a.id = c.account_id
            WHERE m.season_id = :season_id AND mp.is_winner = true AND m.has_won = true
            GROUP BY m.alliance_tier, a.id
            ORDER BY m.alliance_tier, wins DESC
            """
        ),
        {"season_id": season_id},
    ).mappings().all()

    hourly = db.execute(
        text(
            """
            SELECT EXTRACT(HOUR FROM m.created_at) as hour, COUNT(*) as count
            FROM matches m
            WHERE m.season_id = :season_id AND m.created_at IS NOT NULL
            GROUP BY hour ORDER BY hour
            """
        ),
        {"season_id": season_id},
    ).mappings().all()

    pool_map = {}
    for row in pool_stats:
        pool_obj = next((p for p in live_config.pools if p["id"] == row["alliance_tier"]), None)
        key = row["alliance_tier"]
        total = int(row["total"])
        wins = int(row["wins"])
        attacks = int(row["attacks"])
        defenses = int(row["defenses"])
        pool_map[key] = {
            "name": pool_obj["name"] if pool_obj else key,
            "total": total,
            "wins": wins,
            "losses": int(row["losses"]),
            "winrate": round(wins / total * 100) if total > 0 else 0,
            "total_points": int(row["total_points"]),
            "attacks": attacks,
            "defenses": defenses,
            "atk_winrate": round(int(row["atk_wins"]) / attacks * 100) if attacks > 0 else 0,
            "def_winrate": round(int(row["def_wins"]) / defenses * 100) if defenses > 0 else 0,
            "top_players": [],
        }
    for row in top_players:
        entry = pool_map.get(row["alliance_tier"])
        if entry and len(entry["top_players"]) < 3:
            entry["top_players"].append({"name": row["name"], "wins": int(row["wins"])})

    hours = [0] * 24
    for row in hourly:
        if row["hour"] is not None:
            hours[int(row["hour"])] = int(row["count"])

    return {
        "pools": [p for p in pool_map.values() if any(lp["name"] == p["name"] for lp in live_config.pools)],
        "hours": hours,
    }
