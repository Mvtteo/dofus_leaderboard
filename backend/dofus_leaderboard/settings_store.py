import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .models import Setting

DEFAULT_GRID_WIN = [[2, 4, 5, 5, 5], [1, 4, 5, 5, 5], [1, 2, 6, 6, 6], [1, 2, 3, 8, 8], [1, 2, 3, 5, 8]]
DEFAULT_GRID_LOSE = [[1, 2, 3, 3, 3], [1, 2, 3, 3, 3], [0, 2, 3, 3, 3], [0, 0, 3, 4, 4], [0, 0, 0, 4, 5]]


class LiveConfig:
    def __init__(self):
        self.pools: list[dict] = json.loads(json.dumps(settings.DEFAULT_POOLS))
        self.season_end_override: str | None = None
        self.pts_atk_win = [row[:] for row in DEFAULT_GRID_WIN]
        self.pts_atk_lose = [row[:] for row in DEFAULT_GRID_LOSE]
        self.pts_def_win = [row[:] for row in DEFAULT_GRID_WIN]
        self.pts_def_lose = [row[:] for row in DEFAULT_GRID_LOSE]
        self.default_winrate_pool: str | None = None


live_config = LiveConfig()


def load_settings(db: Session) -> None:
    db_keys = {row.key: row.value for row in db.execute(select(Setting)).scalars()}

    if "pools" in db_keys:
        try:
            live_config.pools = json.loads(db_keys["pools"])
        except (TypeError, json.JSONDecodeError):
            pass
    elif "pool_1_name" in db_keys:
        live_config.pools = [
            {"id": "pool_1", "name": db_keys.get("pool_1_name") or "Pool 1", "bonus": int(db_keys.get("pool_1_bonus") or 0)},
            {"id": "pool_2", "name": db_keys.get("pool_2_name") or "Pool 2", "bonus": int(db_keys.get("pool_2_bonus") or 0)},
        ]
        save_setting(db, "pools", json.dumps(live_config.pools))

    for grid_key in ("pts_atk_win", "pts_atk_lose", "pts_def_win", "pts_def_lose"):
        if grid_key in db_keys and db_keys[grid_key]:
            try:
                setattr(live_config, grid_key, json.loads(db_keys[grid_key]))
            except json.JSONDecodeError:
                pass

    if "pts_atk_win" not in db_keys and db_keys.get("pts_win"):
        try:
            old_win = json.loads(db_keys["pts_win"])
            old_lose = json.loads(db_keys["pts_lose"])
            live_config.pts_atk_win = old_win
            live_config.pts_def_win = old_win
            live_config.pts_atk_lose = old_lose
            live_config.pts_def_lose = old_lose
            save_setting(db, "pts_atk_win", json.dumps(old_win))
            save_setting(db, "pts_atk_lose", json.dumps(old_lose))
            save_setting(db, "pts_def_win", json.dumps(old_win))
            save_setting(db, "pts_def_lose", json.dumps(old_lose))
        except json.JSONDecodeError:
            pass

    if "season_end_override" in db_keys:
        live_config.season_end_override = db_keys["season_end_override"] or None
    if "default_winrate_pool" in db_keys:
        live_config.default_winrate_pool = db_keys["default_winrate_pool"] or None


def save_setting(db: Session, key: str, value: str) -> None:
    existing = db.get(Setting, key)
    if existing:
        existing.value = str(value)
    else:
        db.add(Setting(key=key, value=str(value)))
    db.commit()

    if key == "pools":
        try:
            live_config.pools = json.loads(value)
        except json.JSONDecodeError:
            pass
    elif key.startswith("pts_"):
        try:
            setattr(live_config, key, json.loads(value))
        except json.JSONDecodeError:
            pass
    elif key == "season_end_override":
        live_config.season_end_override = value or None
    else:
        setattr(live_config, key, value)
