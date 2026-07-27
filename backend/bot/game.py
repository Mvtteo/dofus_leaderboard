import discord
from sqlalchemy import text

from dofus_leaderboard.database import SessionLocal
from dofus_leaderboard.services import (
    ensure_current_season,
    get_or_create_characters,
    snapshot_ranks,
    update_season_stats,
)
from dofus_leaderboard.settings_store import live_config

from .sessions import PvpSession


async def record_match_result(interaction: discord.Interaction, session: PvpSession, pool_obj: dict | None) -> None:
    """Port du bloc `select_alliance_bonus` de index.js : calcule les points, enregistre
    le match (au grain personnage) et crédite chaque COMPTE une seule fois par match,
    même si plusieurs de ses personnages étaient alignés côté allié."""
    has_won = session.has_won
    my_team = session.winners if has_won else session.losers
    en_team = session.losers if has_won else session.winners
    my_c = min(max(len(my_team), 1), 5)
    en_c = min(max(len(en_team), 1), 5)

    grid_win = live_config.pts_def_win if session.context == "defense" else live_config.pts_atk_win
    grid_lose = live_config.pts_def_lose if session.context == "defense" else live_config.pts_atk_lose
    grid_pts = grid_win[my_c - 1][en_c - 1] if has_won else grid_lose[my_c - 1][en_c - 1]
    pool_pct = (pool_obj.get("bonus") or 0) if (has_won and pool_obj) else 0
    pts = int(grid_pts * (1 + pool_pct / 100))

    if len(en_team) == 0:
        pts = 0

    db = SessionLocal()
    try:
        season_id = ensure_current_season(db)
        snapshot_ranks(db, season_id)

        match_id = db.execute(
            text(
                "INSERT INTO matches (season_id, alliance_tier, points_awarded, context, has_won) "
                "VALUES (:season_id, :alliance_tier, :points, :context, :has_won) RETURNING id"
            ),
            {
                "season_id": season_id,
                "alliance_tier": session.alliance_tier,
                "points": pts,
                "context": session.context,
                "has_won": has_won,
            },
        ).scalar_one()
        db.commit()

        processed_account_ids: set[int] = set()
        paid: list[str] = []
        skipped: list[str] = []
        defeated: list[str] = []

        async def process_players(pseudos: list[str], is_winner: bool, is_ally: bool) -> None:
            characters = get_or_create_characters(db, pseudos)

            for p_name in pseudos:
                c_data = next((c for c in characters if c["dofus_pseudo"].lower() == p_name.lower()), None)
                if not c_data:
                    continue

                db.execute(
                    text(
                        "INSERT INTO match_participants (match_id, character_id, is_winner) "
                        "VALUES (:mid, :cid, :win)"
                    ),
                    {"mid": match_id, "cid": c_data["id"], "win": is_winner},
                )
                db.commit()

                if not is_ally:
                    continue

                account_id = c_data["account_id"]
                if account_id in processed_account_ids:
                    if is_winner:
                        skipped.append(p_name)
                    continue
                processed_account_ids.add(account_id)

                update_season_stats(
                    db, account_id, season_id,
                    points=pts, wins=1 if is_winner else 0, losses=0 if is_winner else 1,
                    context=session.context,
                )
                (paid if is_winner else defeated).append(p_name)

        await process_players(session.winners, True, has_won)
        await process_players(session.losers, False, not has_won)

        result_label = "Victoire" if has_won else "Défaite"
        context_label = "Attaque" if session.context == "attack" else "Défense"
        my_count = len(session.winners) if has_won else len(session.losers)
        en_count = len(session.losers) if has_won else len(session.winners)
        alliance_line = f"**{result_label}** vs **{session.alliance_name or session.alliance_tier}** ({context_label}) — {my_count}vs{en_count}"

        multi_groups: dict[int, list[str]] = {}
        all_ally_pseudos = session.winners if has_won else session.losers
        if all_ally_pseudos:
            ally_rows = db.execute(
                text(
                    """
                    SELECT c.dofus_pseudo, c.account_id
                    FROM characters c
                    WHERE LOWER(c.dofus_pseudo) = ANY(:pseudos)
                    """
                ),
                {"pseudos": [p.lower() for p in all_ally_pseudos]},
            ).mappings().all()
            for r in ally_rows:
                multi_groups.setdefault(r["account_id"], []).append(r["dofus_pseudo"])
        multi_account_lines = [g for g in multi_groups.values() if len(g) > 1]

        if paid and defeated:
            msg = f"{alliance_line}\n**+{pts} pts** : {', '.join(paid)}\n**+{pts} pts** (défaite) : {', '.join(defeated)}"
        elif paid:
            msg = f"{alliance_line}\n**+{pts} pts** : {', '.join(paid)}"
        elif defeated:
            msg = f"{alliance_line}\n**+{pts} pts** : {', '.join(defeated)}"
        else:
            msg = f"{alliance_line}\nAucun joueur crédité."
        if skipped:
            msg += f"\n⚠️ Multi-comptes ignorés : {', '.join(skipped)}"
        if multi_account_lines:
            msg += f"\n🔗 Comptes liés : {' | '.join(' = '.join(g) for g in multi_account_lines)}"

        await interaction.edit_original_response(content=msg, view=None)
    finally:
        db.close()
