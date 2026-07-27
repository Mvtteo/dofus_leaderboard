from sqlalchemy import text
from sqlalchemy.orm import Session

from .seasons import get_seasons
from .settings_store import live_config


# ============================================
# SAISONS
# ============================================
def ensure_current_season(db: Session) -> int:
    seasons, current_season = get_seasons(live_config.season_end_override)
    cur = next((s for s in seasons if s.id == current_season), None)
    if cur:
        db.execute(
            text(
                "INSERT INTO seasons (id, start_date, end_date) VALUES (:id, :start, :end) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"id": cur.id, "start": cur.start, "end": cur.end},
        )
        db.commit()
    return current_season


def snapshot_ranks(db: Session, season_id: int) -> None:
    db.execute(
        text(
            """
            WITH ranked AS (
                SELECT ss.account_id, ss.season_id,
                    ROW_NUMBER() OVER (ORDER BY ss.points DESC, ss.wins DESC) as current_rank
                FROM season_stats ss
                WHERE ss.season_id = :season_id AND (ss.wins + ss.losses) > 0
            )
            UPDATE season_stats SET previous_rank = ranked.current_rank
            FROM ranked
            WHERE season_stats.account_id = ranked.account_id AND season_stats.season_id = ranked.season_id
            """
        ),
        {"season_id": season_id},
    )
    db.commit()


def update_season_stats(
    db: Session,
    account_id: int,
    season_id: int,
    points: int = 0,
    wins: int = 0,
    losses: int = 0,
    nuggets: int = 0,
    context: str | None = None,
) -> None:
    atk_points = points if context == "attack" else 0
    def_points = points if context == "defense" else 0
    db.execute(
        text(
            """
            INSERT INTO season_stats (account_id, season_id, points, wins, losses, nuggets, atk_points, def_points)
            VALUES (:account_id, :season_id, :points, :wins, :losses, :nuggets, :atk_points, :def_points)
            ON CONFLICT (account_id, season_id) DO UPDATE SET
                points = season_stats.points + EXCLUDED.points,
                wins = season_stats.wins + EXCLUDED.wins,
                losses = season_stats.losses + EXCLUDED.losses,
                nuggets = season_stats.nuggets + EXCLUDED.nuggets,
                atk_points = season_stats.atk_points + EXCLUDED.atk_points,
                def_points = season_stats.def_points + EXCLUDED.def_points
            """
        ),
        {
            "account_id": account_id,
            "season_id": season_id,
            "points": points,
            "wins": wins,
            "losses": losses,
            "nuggets": nuggets,
            "atk_points": atk_points,
            "def_points": def_points,
        },
    )
    db.commit()


# ============================================
# COMPTES / PERSONNAGES
# ============================================
def get_or_create_account_for_discord(
    db: Session, discord_id: str, discord_username: str | None = None, discord_nickname: str | None = None
) -> int:
    account = db.execute(
        text("SELECT id FROM accounts WHERE discord_id = :did"), {"did": discord_id}
    ).mappings().first()
    if account:
        return account["id"]
    account_id = db.execute(
        text(
            "INSERT INTO accounts (discord_id, discord_username, discord_nickname) "
            "VALUES (:did, :duser, :dnick) RETURNING id"
        ),
        {"did": discord_id, "duser": discord_username, "dnick": discord_nickname},
    ).scalar_one()
    db.commit()
    return account_id


def get_or_create_characters(db: Session, pseudos: list[str]) -> list[dict]:
    """Résout une liste de pseudos vers leurs personnages (id, account_id, discord_id).
    Tout pseudo inconnu reçoit un compte autonome tout neuf (account_id non-NULL dès la
    création) — plus jamais de personnage "orphelin" invisible du système de comptes."""
    if not pseudos:
        return []

    def fetch() -> list[dict]:
        rows = db.execute(
            text(
                """
                SELECT c.id, c.dofus_pseudo, c.account_id, a.discord_id
                FROM characters c
                JOIN accounts a ON a.id = c.account_id
                WHERE LOWER(c.dofus_pseudo) = ANY(:pseudos)
                """
            ),
            {"pseudos": [p.lower() for p in pseudos]},
        ).mappings().all()
        return [dict(r) for r in rows]

    existing = fetch()
    known = {r["dofus_pseudo"].lower() for r in existing}
    missing = [p for p in pseudos if p.lower() not in known]

    for pseudo in missing:
        account_id = db.execute(text("INSERT INTO accounts DEFAULT VALUES RETURNING id")).scalar_one()
        db.execute(
            text("INSERT INTO characters (dofus_pseudo, account_id) VALUES (:pseudo, :aid) ON CONFLICT DO NOTHING"),
            {"pseudo": pseudo, "aid": account_id},
        )
    if missing:
        db.commit()
        existing = fetch()

    return existing


def link_character(
    db: Session, pseudo: str, discord_id: str, discord_username: str, discord_nickname: str
) -> tuple[bool, str | None]:
    """Rattache `pseudo` au compte Discord `discord_id`. Si ce personnage avait déjà
    son propre compte autonome (créé par get_or_create_characters), on FUSIONNE : le
    personnage rejoint le compte Discord existant (ou en devient le premier), et l'ancien
    compte autonome, s'il ne sert plus à rien, est nettoyé."""
    character = db.execute(
        text(
            """
            SELECT c.id, c.account_id, a.discord_id
            FROM characters c JOIN accounts a ON a.id = c.account_id
            WHERE LOWER(c.dofus_pseudo) = LOWER(:pseudo)
            """
        ),
        {"pseudo": pseudo},
    ).mappings().first()

    target_account = db.execute(
        text("SELECT id FROM accounts WHERE discord_id = :did"), {"did": discord_id}
    ).mappings().first()

    if character is None:
        if target_account:
            account_id = target_account["id"]
            db.execute(
                text(
                    "UPDATE accounts SET discord_username = :duser, discord_nickname = :dnick WHERE id = :aid"
                ),
                {"duser": discord_username, "dnick": discord_nickname, "aid": account_id},
            )
        else:
            account_id = db.execute(
                text(
                    "INSERT INTO accounts (discord_id, discord_username, discord_nickname) "
                    "VALUES (:did, :duser, :dnick) RETURNING id"
                ),
                {"did": discord_id, "duser": discord_username, "dnick": discord_nickname},
            ).scalar_one()
        db.execute(
            text("INSERT INTO characters (dofus_pseudo, account_id) VALUES (:pseudo, :aid)"),
            {"pseudo": pseudo, "aid": account_id},
        )
        db.commit()
        return True, None

    if character["discord_id"] and character["discord_id"] != discord_id:
        db.rollback()
        return False, "Déjà lié à un autre compte."

    old_account_id = character["account_id"]

    if target_account and target_account["id"] != old_account_id:
        new_account_id = target_account["id"]
        db.execute(
            text("UPDATE characters SET account_id = :aid WHERE id = :cid"),
            {"aid": new_account_id, "cid": character["id"]},
        )
        db.execute(
            text("UPDATE accounts SET discord_username = :duser, discord_nickname = :dnick WHERE id = :aid"),
            {"duser": discord_username, "dnick": discord_nickname, "aid": new_account_id},
        )
        db.execute(
            text(
                """
                DELETE FROM accounts WHERE id = :aid
                AND NOT EXISTS (SELECT 1 FROM characters WHERE account_id = :aid)
                AND NOT EXISTS (SELECT 1 FROM season_stats WHERE account_id = :aid)
                """
            ),
            {"aid": old_account_id},
        )
    else:
        db.execute(
            text(
                "UPDATE accounts SET discord_id = :did, discord_username = :duser, discord_nickname = :dnick "
                "WHERE id = :aid"
            ),
            {"did": discord_id, "duser": discord_username, "dnick": discord_nickname, "aid": old_account_id},
        )
    db.commit()
    return True, None


def unlink_character(db: Session, pseudo: str, discord_id: str) -> bool:
    """Détache `pseudo` de son compte en le déplaçant vers un compte autonome flambant
    neuf. Note : les stats déjà accumulées (season_stats) restent attachées au compte
    d'origine — elles ne sont pas suivies par personnage, donc pas rétroactivement
    scindées. Seuls les futurs matchs de ce personnage compteront à part."""
    character = db.execute(
        text(
            """
            SELECT c.id FROM characters c JOIN accounts a ON a.id = c.account_id
            WHERE LOWER(c.dofus_pseudo) = LOWER(:pseudo) AND a.discord_id = :did
            """
        ),
        {"pseudo": pseudo, "did": discord_id},
    ).mappings().first()
    if not character:
        return False

    new_account_id = db.execute(text("INSERT INTO accounts DEFAULT VALUES RETURNING id")).scalar_one()
    db.execute(
        text("UPDATE characters SET account_id = :aid WHERE id = :cid"),
        {"aid": new_account_id, "cid": character["id"]},
    )
    db.commit()
    return True


def get_account_detail(db: Session, identifier: str) -> dict | None:
    """Détail d'un joueur, par pseudo de personnage ou discord_id — chaque requête
    filtre d'abord sur une colonne indexée (unicité discord_id / dofus_pseudo,
    idx_characters_account, idx_match_participants_character, PK season_stats),
    jamais un scan de la table entière."""
    account = db.execute(
        text(
            """
            SELECT a.id, a.discord_id, a.discord_username, a.discord_nickname, a.avatar_url
            FROM accounts a
            LEFT JOIN characters c ON c.account_id = a.id
            WHERE a.discord_id = :ident OR LOWER(c.dofus_pseudo) = LOWER(:ident)
            LIMIT 1
            """
        ),
        {"ident": identifier},
    ).mappings().first()
    if not account:
        return None
    account_id = account["id"]

    characters = db.execute(
        text("SELECT id, dofus_pseudo FROM characters WHERE account_id = :aid ORDER BY dofus_pseudo"),
        {"aid": account_id},
    ).mappings().all()

    matches = db.execute(
        text(
            """
            SELECT m.id, m.season_id, m.alliance_tier, m.points_awarded, m.context,
                   m.has_won, m.created_at, m.cancelled, mp.character_id, mp.is_winner
            FROM match_participants mp
            JOIN matches m ON m.id = mp.match_id
            WHERE mp.character_id = ANY(:char_ids)
            ORDER BY m.created_at DESC NULLS LAST, m.id DESC
            LIMIT 100
            """
        ),
        {"char_ids": [c["id"] for c in characters]},
    ).mappings().all()

    stats = db.execute(
        text("SELECT * FROM season_stats WHERE account_id = :aid ORDER BY season_id DESC"),
        {"aid": account_id},
    ).mappings().all()

    return {
        "account": dict(account),
        "characters": [dict(c) for c in characters],
        "matches": [dict(m) for m in matches],
        "season_stats": [dict(s) for s in stats],
    }


# ============================================
# CLASSEMENT
# ============================================
def get_leaderboard_players(db: Session, season_id: int) -> list[dict]:
    # season_stats a maintenant EXACTEMENT une ligne par (account_id, season_id) — plus
    # besoin de GROUP BY/SUM ici. Joindre `characters` pour le pseudo de repli aurait
    # provoqué un produit cartésien (autant de lignes que de persos sur le compte) et
    # gonflé artificiellement les totaux : on utilise une sous-requête corrélée à la place.
    result = db.execute(
        text(
            """
            SELECT
                a.id as account_id,
                COALESCE(
                    a.discord_nickname, a.discord_username,
                    (SELECT MIN(c.dofus_pseudo) FROM characters c WHERE c.account_id = a.id)
                ) as dofus_pseudo,
                a.avatar_url,
                ss.points as total_points,
                ss.atk_points as atk_points,
                ss.def_points as def_points,
                ss.wins as wins,
                ss.losses as losses,
                ss.previous_rank as previous_rank
            FROM accounts a
            JOIN season_stats ss ON ss.account_id = a.id
            WHERE ss.season_id = :season_id AND (ss.wins + ss.losses) > 0
            ORDER BY total_points DESC
            """
        ),
        {"season_id": season_id},
    ).mappings().all()

    pool_id = live_config.default_winrate_pool
    pool_winrate_map: dict[int, object] = {}
    if pool_id:
        pw = db.execute(
            text(
                """
                SELECT
                    a.id as account_id,
                    SUM(CASE WHEN m.has_won = true AND mp.is_winner = true AND NOT COALESCE(m.cancelled, false) THEN 1 ELSE 0 END) as pool_wins,
                    SUM(CASE WHEN m.has_won = false AND mp.is_winner = false AND NOT COALESCE(m.cancelled, false) THEN 1 ELSE 0 END) as pool_losses
                FROM accounts a
                JOIN characters c ON c.account_id = a.id
                JOIN match_participants mp ON mp.character_id = c.id
                JOIN matches m ON m.id = mp.match_id
                WHERE m.season_id = :season_id AND m.alliance_tier = :pool_id
                AND NOT COALESCE(m.cancelled, false)
                AND (SELECT COUNT(*) FROM match_participants mp3 WHERE mp3.match_id = m.id AND mp3.is_winner = true) = 5
                AND (SELECT COUNT(*) FROM match_participants mp4 WHERE mp4.match_id = m.id AND mp4.is_winner = false) = 5
                GROUP BY a.id
                """
            ),
            {"season_id": season_id, "pool_id": pool_id},
        ).mappings().all()
        for row in pw:
            w = row["pool_wins"] or 0
            l = row["pool_losses"] or 0
            total = w + l
            pool_winrate_map[row["account_id"]] = {
                "winrate": round(w / total * 100) if total > 0 else None,
                "wins": w,
                "losses": l,
            }

    players = []
    for index, p in enumerate(result):
        wins = p["wins"] or 0
        losses = p["losses"] or 0
        total_games = wins + losses
        prev_rank = p["previous_rank"]
        rank_change = (prev_rank - (index + 1)) if prev_rank is not None else 0
        pool_data = pool_winrate_map.get(p["account_id"]) if pool_id else None
        has_pool_data = pool_data is not None and pool_data["winrate"] is not None
        winrate = (
            pool_data["winrate"] if has_pool_data else (round(wins / total_games * 100) if total_games > 0 else 0)
        )
        display_wins = pool_data["wins"] if has_pool_data else wins
        display_losses = pool_data["losses"] if has_pool_data else losses
        players.append(
            {
                "dofus_pseudo": p["dofus_pseudo"],
                "avatar_url": p["avatar_url"],
                "total_points": int(p["total_points"] or 0),
                "atk_points": int(p["atk_points"] or 0),
                "def_points": int(p["def_points"] or 0),
                "wins": display_wins,
                "losses": display_losses,
                "winrate": winrate,
                "rank_change": rank_change,
            }
        )
    return players
