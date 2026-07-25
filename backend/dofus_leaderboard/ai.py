import asyncio
import base64
import logging
import re

import httpx
from openai import AsyncOpenAI

from .config import settings
from .text_utils import extract_winners_losers_json, is_npc

logger = logging.getLogger("dofus_leaderboard.ai")

AI_TIMEOUT_S = 60
AI_MAX_RETRIES = 3

_client: AsyncOpenAI | None = None
if settings.GROQ_API_KEY:
    _client = AsyncOpenAI(base_url="https://api.groq.com/openai/v1", api_key=settings.GROQ_API_KEY)
else:
    logger.warning("[AI] GROQ_API_KEY manquante — analyse d'images désactivée")

PVP_PROMPT = """Analyse ce screenshot de fin de combat Dofus (Alliance vs Alliance).
Extrait UNIQUEMENT les pseudos des joueurs HUMAINS.

IMPORTANT : Le screenshot peut ne montrer QU'UNE SEULE section (soit GAGNANTS, soit PERDANTS).
Dans ce cas, remplis la section visible et laisse l'autre vide [].

CRUCIAL - SECTION :
- Si tu vois le titre "PERDANTS" ou "LOSERS", TOUS les noms en dessous vont dans "losers" UNIQUEMENT.
- Si tu vois le titre "GAGNANTS" ou "WINNERS", TOUS les noms en dessous vont dans "winners" UNIQUEMENT.
- Ne jamais mettre un nom dans la mauvaise section.

CRUCIAL - DETECTION COMPLETE :
- Il DOIT y avoir jusqu'à 5 joueurs par section visible. Cherche TOUS les noms présents.
- Si tu ne vois que 3 ou 4 noms là où il devrait y en avoir 5, regarde plus attentivement toute la colonne.
- Le nombre de joueurs détectés est critique : il influe directement sur les points attribués.

Regles STRICTES :
- Les pseudos sous "GAGNANTS" ou "WINNERS" vont dans winners
- Les pseudos sous "PERDANTS" ou "LOSERS" vont dans losers
- MAXIMUM 5 joueurs par equipe (un combat AvA est 5v5 max)
- Extraire le NOM COMPLET tel qu'affiché
- Les pseudos peuvent être : un seul mot (ex: Bouff, Ketzal) OU plusieurs mots reliés par des tirets (ex: Raconte-pas-ta-vie, Mangeur-de-bouf, Jprotec-R)
- Les Percepteurs ont TOUJOURS "Do'" dans leur nom (ex: "Despera Do'Trakisse") — les exclure
- EXCLURE absolument tout nom contenant "Do'", "Do ", "Dofus", ainsi que : Prisme, Gardien, Protecteur
- EXCLURE les monstres, invocations, et PNJ
- IGNORER : niveaux, XP, kamas, butin, classes, objets, sorts
- Ne prendre QUE les noms qui apparaissent dans les colonnes GAGNANTS/PERDANTS
- Si tu vois plus de 5 pseudos dans une equipe, garde uniquement les 5 premiers

Reponds UNIQUEMENT en JSON valide : {"winners": [], "losers": []}"""

NUGGETS_PROMPT = """Cette image est une capture d'écran du chat Dofus. Cherche une ligne annonçant
l'ajout de pépites à l'alliance, du type "X pépites ont été ajoutées" (ou une formulation proche).

Réponds UNIQUEMENT en JSON valide : {"alliance_amount": <nombre entier, ou null si aucune ligne de ce type>}"""

PRISMES_PROMPT = """Historique d'achats Dofus. Format de chaque ligne : [heure] [qté] x [objet] (prix kamas)
Pour chaque ligne : calcule qté × prix (ignore les espaces dans les nombres, ex "19 498" = 19498).
Ignore les timestamps/heures.
Réponds UNIQUEMENT : {"amounts":[489,490,19498,1990,2418]}"""


async def _fetch_image_base64(image_url: str) -> str:
    async with httpx.AsyncClient() as client:
        response = await client.get(image_url)
        response.raise_for_status()
        return base64.b64encode(response.content).decode()


async def _call_classifier_once(base64_image: str, prompt: str, mime_type: str = "image/png", json_mode: bool = True) -> str:
    if _client is None:
        raise RuntimeError("AI non configurée (GROQ_API_KEY manquante)")
    extra_kwargs = {"response_format": {"type": "json_object"}} if json_mode else {}
    stream = await _client.chat.completions.create(
        model=settings.AI_MODEL,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{base64_image}"}},
                    {"type": "text", "text": prompt},
                ],
            }
        ],
        temperature=1,
        max_completion_tokens=2048,
        reasoning_effort="none",
        reasoning_format="hidden",
        top_p=1,
        stream=True,
        **extra_kwargs,
    )
    text = ""
    async for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            text += delta
    return text


# File d'attente séquentielle : un seul appel IA à la fois, pour ne pas se faire
# jeter par le rate-limit Groq quand plusieurs images arrivent en même temps.
_queue: asyncio.Queue | None = None
_worker_task: asyncio.Task | None = None


async def _worker():
    queue = _queue
    while True:
        base64_image, prompt, mime_type, json_mode, future = await queue.get()
        try:
            text = await _call_with_retries(base64_image, prompt, mime_type, json_mode)
            if not future.done():
                future.set_result(text)
        except Exception as exc:  # noqa: BLE001 - propagated to caller via future
            if not future.done():
                future.set_exception(exc)
        finally:
            queue.task_done()
        if not queue.empty():
            await asyncio.sleep(1)


async def _call_with_retries(
    base64_image: str, prompt: str, mime_type: str, json_mode: bool = True, retries: int = AI_MAX_RETRIES
) -> str:
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            return await asyncio.wait_for(
                _call_classifier_once(base64_image, prompt, mime_type, json_mode), timeout=AI_TIMEOUT_S
            )
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            message = str(exc)
            status = getattr(exc, "status_code", None)
            is_retryable = (
                status == 503
                or isinstance(exc, asyncio.TimeoutError)
                or any(s in message for s in ("fetch failed", "ECONNRESET", "ETIMEDOUT"))
            )
            logger.info("[AI] Tentative %s/%s echouee: %s", attempt, retries, message)
            if attempt < retries and is_retryable:
                await asyncio.sleep(attempt * 10)
            else:
                raise
    raise last_error  # pragma: no cover


async def queue_classifier(base64_image: str, prompt: str, mime_type: str = "image/png", json_mode: bool = True) -> str:
    global _queue, _worker_task
    if _queue is None:
        _queue = asyncio.Queue()
    if _worker_task is None or _worker_task.done():
        _worker_task = asyncio.create_task(_worker())

    future: asyncio.Future = asyncio.get_event_loop().create_future()
    await _queue.put((base64_image, prompt, mime_type, json_mode, future))
    return await future


async def parse_screen_with_ai(image_url: str) -> dict | None:
    try:
        base64_image = await _fetch_image_base64(image_url)
        text = await queue_classifier(base64_image, PVP_PROMPT)
        logger.info("[AI] Reponse brute: %s", text)
        parsed = extract_winners_losers_json(text)

        parsed["winners"] = [n for n in parsed.get("winners", []) if not is_npc(n)][:5]
        parsed["losers"] = [n for n in parsed.get("losers", []) if not is_npc(n)][:5]
        return parsed
    except Exception as exc:  # noqa: BLE001
        logger.error("Erreur AI PvP: %s", exc)
        return None


async def parse_nuggets_with_ai(image_url: str) -> dict | None:
    base64_image = await _fetch_image_base64(image_url)
    text = await queue_classifier(base64_image, NUGGETS_PROMPT)
    logger.info("[Pepites] Reponse brute: %s", text)

    try:
        import json

        clean = re.sub(r"```json\n?|```\n?", "", text).strip()
        obj = json.loads(clean)
        amount = obj.get("alliance_amount")
        return {"alliance_amount": int(amount)} if amount else None
    except (json.JSONDecodeError, TypeError, ValueError):
        # Filet de sécurité si le modèle n'a malgré tout pas renvoyé de JSON exploitable.
        match = re.search(r"et\s*(\d+)\s*ont\s*été\s*ajoutées", text, re.IGNORECASE)
        return {"alliance_amount": int(match.group(1))} if match else None


async def parse_prisme_kamas_with_ai(image_url: str) -> dict:
    if _client is None:
        raise RuntimeError("AI non configurée (GROQ_API_KEY manquante)")
    base64_image = await _fetch_image_base64(image_url)

    stream = await _client.chat.completions.create(
        model=settings.AI_MODEL,
        messages=[
            {"role": "system", "content": "Réponds UNIQUEMENT avec du JSON brut valide. Zéro texte, zéro markdown, zéro explication."},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64_image}"}},
                    {"type": "text", "text": PRISMES_PROMPT},
                ],
            },
        ],
        temperature=0,
        max_completion_tokens=128,
        reasoning_effort="none",
        reasoning_format="hidden",
        response_format={"type": "json_object"},
        stream=True,
    )
    raw = ""
    async for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            raw += delta
    logger.info("[Prismes] Réponse brute: %s", raw)

    amounts: list[int] = []
    array_match = re.search(r'"amounts"\s*:\s*\[([^\]]*)\]', raw)
    if array_match:
        amounts = [int(n) for n in re.findall(r"\d+", array_match.group(1)) if int(n) > 0]

    if not amounts:
        try:
            import json

            clean = re.sub(r"```json\n?|```\n?", "", raw)
            clean = re.sub(r",(\s*[\]}])", r"\1", clean).strip()
            obj = json.loads(clean)
            amounts = [int(n) for n in obj.get("amounts", []) if int(n) > 0]
        except Exception:  # noqa: BLE001
            pass

    total_kamas = sum(amounts) if amounts else None
    logger.info("[Prismes] Montants détectés: %s -> total: %s", amounts, total_kamas)
    return {"total_kamas": total_kamas}
