import hashlib
import logging

import discord
from sqlalchemy import text

from dofus_leaderboard.ai import parse_nuggets_with_ai, queue_classifier, PVP_PROMPT
from dofus_leaderboard.config import settings
from dofus_leaderboard.database import SessionLocal
from dofus_leaderboard.services import (
    correct_player_names,
    ensure_current_season,
    get_or_create_account_for_discord,
    get_or_create_characters,
    update_season_stats,
)
from dofus_leaderboard.text_utils import (
    build_ai_error_message,
    extract_winners_losers_json,
    is_npc,
    remove_accents,
)

from . import sessions
from .views import ActionView, ProfileButtonsView

logger = logging.getLogger("dofus_leaderboard.bot")


def has_staff_role(member: discord.Member | None) -> bool:
    if member is None:
        return False
    if member.guild_permissions.administrator:
        return True
    return any(r.name.upper() == "STAFF" for r in member.roles)


async def on_ready(client: discord.Client) -> None:
    logger.info("Bot Connecte : %s", client.user)
    # Le schéma (players, matches, season_stats, nuggets, prism_requests, ...) est géré
    # par Alembic (backend/alembic) — pas de DDL/migration ad hoc au démarrage ici,
    # contrairement à l'ancien bot Node qui rattrapait un schéma qui avait dérivé au fil du temps.


async def handle_message(client: discord.Client, message: discord.Message) -> None:
    if message.author.bot:
        return

    if str(message.channel.id) == settings.CHANNEL_ID:
        db = SessionLocal()
        try:
            raw_nickname = message.author.display_name if isinstance(message.author, discord.Member) else message.author.name
            clean_nickname = remove_accents(raw_nickname)
            avatar_url = str(message.author.display_avatar.replace(size=128, format="webp"))
            db.execute(
                text("UPDATE accounts SET discord_nickname = :nick, avatar_url = :avatar WHERE discord_id = :did"),
                {"nick": clean_nickname, "avatar": avatar_url, "did": str(message.author.id)},
            )
            db.commit()
        except Exception:  # noqa: BLE001
            pass
        finally:
            db.close()

    content = message.content
    member = message.author if isinstance(message.author, discord.Member) else None

    if content.startswith("!addplayer") and member and member.guild_permissions.administrator:
        return await _cmd_addplayer(message, content)

    if content.startswith("!deleteplayer") and member and (
        member.guild_permissions.administrator
        or str(message.author.id) == settings.OWNER_ID
        or message.author.name.lower() == "sino299"
    ):
        return await _cmd_deleteplayer(message, content)

    if content == "!pepites":
        return await _cmd_pepites(message, member)

    if content == "!resetpepites":
        return await _cmd_resetpepites(message, member)

    if content == "!setup_profile" and member and member.guild_permissions.administrator:
        return await _cmd_setup_profile(client)

    if settings.NUGGETS_CHANNEL_ID and str(message.channel.id) == settings.NUGGETS_CHANNEL_ID:
        return await _handle_nuggets_upload(message)

    if str(message.channel.id) != settings.CHANNEL_ID:
        return
    await _handle_pvp_upload(message)


async def _cmd_addplayer(message: discord.Message, content: str) -> None:
    args = content.split(" ")
    if len(args) < 2:
        return await message.reply("Usage : `!addplayer <PseudoExact>`")
    clean_arg = remove_accents(args[1])
    db = SessionLocal()
    try:
        get_or_create_characters(db, [clean_arg])
        await message.reply(f"[OK] Joueur {clean_arg} ajouté.")
    except Exception:  # noqa: BLE001
        await message.reply("Erreur d'ajout.")
    finally:
        db.close()


async def _cmd_deleteplayer(message: discord.Message, content: str) -> None:
    args = content.split(" ")
    if len(args) < 2:
        return await message.reply("Usage : `!deleteplayer <PseudoExact>`")
    clean_arg = remove_accents(args[1])
    db = SessionLocal()
    try:
        found = db.execute(
            text("SELECT id FROM characters WHERE LOWER(dofus_pseudo) = LOWER(:pseudo)"), {"pseudo": clean_arg}
        ).mappings().first()
        if not found:
            return await message.reply(f'Joueur "{clean_arg}" introuvable.')
        # Supprime uniquement ce personnage (cascade sur match_participants). Les stats de
        # saison vivent sur le compte, pas sur le personnage — elles ne sont pas touchées,
        # ce qui est correct si le compte a d'autres persos liés.
        db.execute(text("DELETE FROM characters WHERE id = :cid"), {"cid": found["id"]})
        db.commit()
        await message.reply(f"[OK] Joueur {clean_arg} supprimé.")
    except Exception:  # noqa: BLE001
        logger.exception("Erreur suppression")
        await message.reply("Erreur suppression.")
    finally:
        db.close()


async def _cmd_pepites(message: discord.Message, member: discord.Member | None) -> None:
    if not has_staff_role(member):
        return await message.reply("[REFUS] Cette commande est réservée au STAFF.")
    db = SessionLocal()
    try:
        season_id = ensure_current_season(db)
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
        if not rows:
            return await message.reply("Aucune pépite en banque pour cette saison.")
        lines = [f"{i + 1}. **{r['name']}** : {r['nuggets']}" for i, r in enumerate(rows)]
        embed = discord.Embed(title="Banque des Pépites (Alliance)", description="\n".join(lines[:20]), color=0xFFD700)
        embed.set_footer(text=f"Total accumulé - Top 20 sur {len(rows)} comptes")
        await message.reply(embed=embed)
    except Exception:  # noqa: BLE001
        logger.exception("Erreur récupération pépites")
        await message.reply("Erreur récupération pépites.")
    finally:
        db.close()


async def _cmd_resetpepites(message: discord.Message, member: discord.Member | None) -> None:
    if not has_staff_role(member):
        return await message.reply("[REFUS] Cette commande est réservée au STAFF.")
    db = SessionLocal()
    try:
        season_id = ensure_current_season(db)
        db.execute(
            text("UPDATE season_stats SET nuggets = 0 WHERE season_id = :season_id AND nuggets > 0"),
            {"season_id": season_id},
        )
        db.commit()
        await message.reply(f"[OK] Pépites remises à zéro pour la saison {season_id}.")
    except Exception:  # noqa: BLE001
        logger.exception("Erreur reset pépites")
        await message.reply("Erreur reset pépites.")
    finally:
        db.close()


async def _cmd_setup_profile(client: discord.Client) -> None:
    embed = discord.Embed(
        title="Gestion de vos Personnages",
        description="Liez vos personnages Dofus à votre compte Discord !",
        color=0x00FF00,
    )
    channel = client.get_channel(int(settings.profile_channel_id()))
    if channel:
        await channel.send(embed=embed, view=ProfileButtonsView())


async def _handle_nuggets_upload(message: discord.Message) -> None:
    attachments = [a for a in message.attachments if a.content_type and a.content_type.startswith("image/")]
    if not attachments:
        return
    msg_ref = await message.reply("Analyse pépites...")
    db = SessionLocal()
    try:
        for attachment in attachments:
            image_bytes = await attachment.read()
            image_hash = hashlib.sha256(image_bytes).hexdigest()

            dup = db.execute(text("SELECT id FROM nuggets WHERE image_hash = :hash"), {"hash": image_hash}).first()
            if dup:
                await msg_ref.edit(content="Image déjà traitée.")
                return

            parsed = await parse_nuggets_with_ai(attachment.url)
            if not parsed or not parsed.get("alliance_amount"):
                await msg_ref.edit(content="Montant introuvable.")
                return

            player_share = int(parsed["alliance_amount"] * 0.5)
            mentioned = message.mentions[0] if message.mentions else None
            recipient_id = mentioned.id if mentioned else message.author.id
            recipient_name = mentioned.display_name if mentioned else (
                message.author.display_name if isinstance(message.author, discord.Member) else message.author.name
            )
            display_name = "Gros orteils" if recipient_name.lower() == "duma" else recipient_name

            clean_name = remove_accents(recipient_name)
            account_id = get_or_create_account_for_discord(
                db, str(recipient_id), discord_username=recipient_name, discord_nickname=clean_name
            )
            season_id = ensure_current_season(db)

            db.execute(
                text("INSERT INTO nuggets (discord_id, amount, image_hash) VALUES (:did, :amount, :hash)"),
                {"did": str(recipient_id), "amount": parsed["alliance_amount"], "hash": image_hash},
            )
            db.commit()
            update_season_stats(db, account_id, season_id, nuggets=player_share)
            await msg_ref.edit(
                content=f"[OK] {parsed['alliance_amount']} pépites alliance.\n[+] {player_share} pour {display_name}."
            )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Erreur pépites")
        try:
            await msg_ref.edit(content=build_ai_error_message(exc))
        except discord.HTTPException:
            pass
    finally:
        db.close()


async def _handle_pvp_upload(message: discord.Message) -> None:
    attachments = [a for a in message.attachments if a.content_type and a.content_type.startswith("image/")]
    if not attachments:
        return

    logger.info("[PvP] Upload detecté de %s - %d image(s)", message.author.name, len(attachments))
    user_session = sessions.get_or_create_session(message.author.id)
    msg_ref = await message.reply("Analyse PvP en cours...")

    try:
        all_parsed_winners: list[str] = []
        all_parsed_losers: list[str] = []
        total_images = len(attachments)

        for idx, attachment in enumerate(attachments, start=1):
            if total_images > 1:
                try:
                    await msg_ref.edit(content=f"Analyse image {idx}/{total_images}...")
                except discord.HTTPException:
                    pass

            image_bytes = await attachment.read()
            import base64

            base64_image = base64.b64encode(image_bytes).decode()
            text_result = await queue_classifier(base64_image, PVP_PROMPT, attachment.content_type or "image/png")
            logger.info("[AI] Image %s reponse: %s", attachment.id, text_result)
            parsed = extract_winners_losers_json(text_result)

            all_parsed_winners.extend(parsed.get("winners") or [])
            all_parsed_losers.extend(parsed.get("losers") or [])

        parsed = {
            "winners": list(dict.fromkeys(all_parsed_winners)),
            "losers": list(dict.fromkeys(all_parsed_losers)),
        }
        logger.info("[PvP] Merged result: %s", parsed)

        pre_filter_win_count = len(parsed["winners"])
        pre_filter_lose_count = len(parsed["losers"])

        parsed["winners"] = [n for n in parsed["winners"] if not is_npc(n)]
        parsed["losers"] = [n for n in parsed["losers"] if not is_npc(n)]

        if pre_filter_lose_count > 0 and not parsed["losers"]:
            user_session.percepteur_detected = True
        if pre_filter_win_count > 0 and not parsed["winners"]:
            user_session.percepteur_detected = True

        parsed["winners"] = parsed["winners"][:5]
        parsed["losers"] = parsed["losers"][:5]

        db = SessionLocal()
        try:
            parsed["winners"] = correct_player_names(db, parsed["winners"])
            parsed["losers"] = correct_player_names(db, parsed["losers"])
        finally:
            db.close()
        logger.info("[PvP] Noms corriges: %s", parsed)

        user_session.winners = list(dict.fromkeys(user_session.winners + parsed["winners"]))
        user_session.losers = list(dict.fromkeys(user_session.losers + parsed["losers"]))

        both_sides = bool(user_session.winners) and bool(user_session.losers)
        percepteur_fight = user_session.percepteur_detected and not both_sides and (
            bool(user_session.winners) or bool(user_session.losers)
        )

        if percepteur_fight:
            sessions.delete_session(message.author.id)
            await msg_ref.edit(content="Pas de def, 0 point chef", view=None)
        elif both_sides:
            await msg_ref.edit(
                content=f"[COMPLET]\nGagnants: {', '.join(user_session.winners)}\nPerdants: {', '.join(user_session.losers)}",
                view=ActionView(),
            )
            sessions.set_timeout(message.author.id, _make_expire_callback(msg_ref))
        else:
            await msg_ref.edit(
                content=f"[PARTIEL] Gagnants {len(user_session.winners)} / Perdants {len(user_session.losers)}. Envoyez la suite."
            )
            sessions.set_timeout(message.author.id, _make_expire_callback(msg_ref))
    except Exception as exc:  # noqa: BLE001
        logger.exception("[PvP] Erreur")
        try:
            await msg_ref.edit(content=build_ai_error_message(exc), view=None)
        except discord.HTTPException:
            pass


def _make_expire_callback(msg_ref: discord.Message):
    async def _expire():
        try:
            await msg_ref.edit(content="[EXPIRÉ] Session annulée (inactivité 2 min).", view=None)
        except discord.HTTPException:
            pass
    return _expire
