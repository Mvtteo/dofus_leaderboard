from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Chemin absolu : la commande (uvicorn, alembic, python -m bot.main) est lancée depuis
# backend/, mais .env.local vit à la racine du repo — un chemin relatif dépendrait du CWD
# et ne trouverait rien (les settings retomberaient silencieusement sur leurs défauts vides).
_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env.local"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    DATABASE_URL: str = ""
    PORT: int = 3000
    ADMIN_PASSWORD: str = ""
    # "prefer" marche en local (Postgres sans SSL) et sur Railway (SSL dispo) sans
    # config différente entre environnements. Sur Railway avec un certificat non
    # vérifiable, passer DB_SSLMODE=require dans l'env si besoin de forcer le SSL.
    DB_SSLMODE: str = "prefer"

    DISCORD_TOKEN: str = ""
    CHANNEL_ID: str = ""
    LEADERBOARD_CHANNEL_ID: str = ""
    PROFILE_CHANNEL_ID: str = ""
    OWNER_ID: str = ""
    NUGGETS_CHANNEL_ID: str = ""

    GROQ_API_KEY: str = ""
    AI_MODEL: str = "qwen/qwen3.6-27b"

    DEFAULT_POOLS: list[dict] = [
        {"id": "pool_1", "name": "CXO / Dawnfall / Razia", "bonus": 8},
        {"id": "pool_2", "name": "Captain / ABBA / Tenebris", "bonus": 1},
    ]
    MAX_POOLS: int = 5

    def leaderboard_channel_id(self) -> str:
        return self.LEADERBOARD_CHANNEL_ID or self.CHANNEL_ID

    def profile_channel_id(self) -> str:
        return self.PROFILE_CHANNEL_ID or self.CHANNEL_ID


settings = Settings()
