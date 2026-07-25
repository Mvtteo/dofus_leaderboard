from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env.local", extra="ignore")

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
    PRISMES_CHANNEL_ID: str = ""

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
