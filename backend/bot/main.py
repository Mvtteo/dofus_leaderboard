import logging

import discord

from dofus_leaderboard.config import settings
from dofus_leaderboard.database import SessionLocal
from dofus_leaderboard.settings_store import load_settings

from . import handlers

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("dofus_leaderboard.bot")

if not settings.CHANNEL_ID:
    raise SystemExit("ERREUR : CHANNEL_ID manquant dans le .env")

intents = discord.Intents.default()
intents.guilds = True
intents.guild_messages = True
intents.message_content = True

client = discord.Client(intents=intents)


@client.event
async def on_ready():
    db = SessionLocal()
    try:
        load_settings(db)
    finally:
        db.close()
    await handlers.on_ready(client)


@client.event
async def on_message(message: discord.Message):
    await handlers.handle_message(client, message)


def main() -> None:
    client.run(settings.DISCORD_TOKEN)


if __name__ == "__main__":
    main()
