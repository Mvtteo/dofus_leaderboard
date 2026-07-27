import discord

from dofus_leaderboard.database import SessionLocal
from dofus_leaderboard.services import link_character, unlink_character
from dofus_leaderboard.settings_store import live_config
from dofus_leaderboard.text_utils import remove_accents

from . import sessions
from .game import record_match_result


def _uniq_pools() -> list[dict]:
    seen: set[str] = set()
    out = []
    for p in live_config.pools:
        if not p.get("id") or not p.get("name") or p["id"] in seen:
            continue
        seen.add(p["id"])
        out.append(p)
    return out


# ============================================
# Etape 3 : choix de l'alliance adverse (select_alliance_bonus)
# ============================================
class AllianceSelect(discord.ui.Select):
    def __init__(self):
        options = [discord.SelectOption(label=p["name"], value=p["id"]) for p in _uniq_pools()]
        super().__init__(placeholder="Alliance Adverse", options=options, custom_id="select_alliance_bonus")

    async def callback(self, interaction: discord.Interaction):
        session = sessions.get_session(interaction.user.id)
        if not session:
            return await interaction.response.send_message("Session expirée.", ephemeral=True)

        session.alliance_tier = self.values[0]
        pool_obj = next((p for p in live_config.pools if p["id"] == session.alliance_tier), None)
        session.alliance_name = pool_obj["name"] if pool_obj else session.alliance_tier

        sessions.delete_session(interaction.user.id)
        await interaction.response.defer()
        await record_match_result(interaction, session, pool_obj)


class AllianceSelectView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        self.add_item(AllianceSelect())


# ============================================
# Etape 2 : résultat (result_win / result_lose)
# ============================================
class ResultView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="VICTOIRE", style=discord.ButtonStyle.success, custom_id="result_win")
    async def win(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self._resolve(interaction, True)

    @discord.ui.button(label="DÉFAITE", style=discord.ButtonStyle.danger, custom_id="result_lose")
    async def lose(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self._resolve(interaction, False)

    async def _resolve(self, interaction: discord.Interaction, has_won: bool):
        session = sessions.get_session(interaction.user.id)
        if not session:
            return await interaction.response.send_message("Session expirée.", ephemeral=True)
        session.has_won = has_won
        ctx_label = "Attaque" if session.context == "attack" else "Défense"
        result_label = "Victoire" if has_won else "Défaite"
        await interaction.response.edit_message(
            content=f"**{ctx_label}** — **{result_label}**. Adversaire ?", view=AllianceSelectView()
        )
        sessions.set_timeout(interaction.user.id, _make_expire_callback(interaction))


# ============================================
# Etape 1 : contexte (attack / defense) + Corriger / Reset
# ============================================
class ActionView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Attaque", style=discord.ButtonStyle.danger, custom_id="attack")
    async def attack(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self._set_context(interaction, "attack")

    @discord.ui.button(label="Défense", style=discord.ButtonStyle.primary, custom_id="defense")
    async def defense(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self._set_context(interaction, "defense")

    @discord.ui.button(label="Corriger", style=discord.ButtonStyle.secondary, custom_id="correct")
    async def correct(self, interaction: discord.Interaction, button: discord.ui.Button):
        session = sessions.get_session(interaction.user.id)
        if not session:
            return await interaction.response.send_message("Session expirée.", ephemeral=True)
        await interaction.response.send_modal(CorrectModal(session))

    @discord.ui.button(label="Reset", style=discord.ButtonStyle.secondary, custom_id="reset")
    async def reset(self, interaction: discord.Interaction, button: discord.ui.Button):
        sessions.delete_session(interaction.user.id)
        await interaction.response.edit_message(content="Annulé.", view=None)

    async def _set_context(self, interaction: discord.Interaction, context: str):
        session = sessions.get_session(interaction.user.id)
        if not session:
            return await interaction.response.send_message("Session expirée.", ephemeral=True)
        session.context = context
        mode_label = "Attaque" if context == "attack" else "Défense"
        await interaction.response.edit_message(content=f"Mode : **{mode_label}**. Résultat ?", view=ResultView())
        sessions.set_timeout(interaction.user.id, _make_expire_callback(interaction))


def _make_expire_callback(interaction: discord.Interaction):
    async def _expire():
        try:
            await interaction.edit_original_response(content="[EXPIRÉ] Session annulée (inactivité 2 min).", view=None)
        except discord.HTTPException:
            pass
    return _expire


class CorrectModal(discord.ui.Modal, title="Correction"):
    winners_input = discord.ui.TextInput(label="Gagnants", style=discord.TextStyle.short)
    losers_input = discord.ui.TextInput(label="Perdants", style=discord.TextStyle.short)

    def __init__(self, session: sessions.PvpSession):
        super().__init__()
        self.winners_input.default = ", ".join(session.winners)
        self.losers_input.default = ", ".join(session.losers)

    async def on_submit(self, interaction: discord.Interaction):
        session = sessions.get_session(interaction.user.id)
        if not session:
            return
        session.winners = [remove_accents(s.strip()) for s in self.winners_input.value.split(",") if s.strip()]
        session.losers = [remove_accents(s.strip()) for s in self.losers_input.value.split(",") if s.strip()]
        await interaction.response.send_message(
            content=f"[CORRIGÉ]\nGagnants: {', '.join(session.winners)}\nPerdants: {', '.join(session.losers)}",
            view=ActionView(),
        )
        sessions.set_timeout(interaction.user.id, _make_expire_callback(interaction))


# ============================================
# Liaison / déliaison de personnage (profil Discord)
# ============================================
class LinkModal(discord.ui.Modal, title="Lier Personnage"):
    pseudo_input = discord.ui.TextInput(label="Pseudo Dofus", style=discord.TextStyle.short)

    async def on_submit(self, interaction: discord.Interaction):
        pseudo = remove_accents(self.pseudo_input.value.strip())
        discord_id = str(interaction.user.id)
        discord_name = interaction.user.name
        discord_nickname = remove_accents(interaction.user.display_name)

        db = SessionLocal()
        try:
            ok, error = link_character(db, pseudo, discord_id, discord_name, discord_nickname)
        finally:
            db.close()

        if not ok:
            return await interaction.response.send_message(error, ephemeral=True)
        await interaction.response.send_message(f"[OK] {pseudo} lié au compte Discord.", ephemeral=True)


class UnlinkModal(discord.ui.Modal, title="Delier Personnage"):
    pseudo_input = discord.ui.TextInput(label="Pseudo Dofus", style=discord.TextStyle.short)

    async def on_submit(self, interaction: discord.Interaction):
        pseudo = remove_accents(self.pseudo_input.value.strip())
        discord_id = str(interaction.user.id)
        db = SessionLocal()
        try:
            unlink_character(db, pseudo, discord_id)
        finally:
            db.close()
        await interaction.response.send_message(f"[OK] {pseudo} délié.", ephemeral=True)


class ProfileButtonsView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Lier un Personnage", style=discord.ButtonStyle.success, custom_id="btn_link_char")
    async def link(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_modal(LinkModal())

    @discord.ui.button(label="Délier un Personnage", style=discord.ButtonStyle.danger, custom_id="btn_unlink_char")
    async def unlink(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.send_modal(UnlinkModal())
