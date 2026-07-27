import json
import re
import unicodedata

EXCLUDE_PATTERN = re.compile(r"prisme|gardien|protecteur|dofus|\bdo['\s]", re.IGNORECASE)


def remove_accents(value: str | None) -> str:
    if not value:
        return ""
    return "".join(
        c for c in unicodedata.normalize("NFD", value) if unicodedata.category(c) != "Mn"
    )


def has_accents(value: str) -> bool:
    return value != remove_accents(value)


def is_npc(name: str) -> bool:
    return bool(EXCLUDE_PATTERN.search(name)) or has_accents(name) or " " in name


def extract_winners_losers_json(raw_text: str) -> dict:
    clean = re.sub(r"```json\n?|```\n?", "", raw_text).strip()

    think_end = clean.rfind("</think>")
    if think_end != -1:
        clean = clean[think_end + len("</think>"):].strip()
    elif "<think>" in clean:
        # Raisonnement jamais fermé : la réponse a été tronquée avant le JSON final.
        clean = ""

    if clean:
        try:
            return json.loads(clean)
        except json.JSONDecodeError:
            brace_match = re.search(r"\{[\s\S]*\}", clean)
            if brace_match:
                try:
                    return json.loads(brace_match.group(0))
                except json.JSONDecodeError:
                    pass

    w_section = re.search(r'"winners"\s*:\s*\[?([\s\S]*?)\s*"losers"', clean)
    l_section = re.search(r'"losers"\s*:\s*\[?([\s\S]*?)(\]|\})\s*$', clean)

    def extract(match):
        if not match:
            return []
        return [m.strip('"') for m in re.findall(r'"([^"]+)"', match.group(1))]

    return {"winners": extract(w_section), "losers": extract(l_section)}


def format_retry_delay(raw_message: str) -> str | None:
    match = re.search(
        r"try again in\s*(?:([\d.]+)h)?\s*(?:([\d.]+)m)?\s*(?:([\d.]+)s)?",
        raw_message,
        re.IGNORECASE,
    )
    if not match or not any(match.groups()):
        return None
    h, m, s = match.groups()
    parts = []
    if h:
        parts.append(f"{round(float(h))}h")
    if m:
        parts.append(f"{round(float(m))}min")
    if s and not h:
        parts.append(f"{round(float(s))}s")
    return " ".join(parts)


def build_ai_error_message(error: Exception, status: int | None = None, raw_message: str | None = None) -> str:
    message = raw_message or str(error)
    if status == 429 or re.search(r"\b429\b", message):
        is_daily_quota = bool(re.search(r"tokens per day|TPD", message, re.IGNORECASE))
        retry_delay = format_retry_delay(message)
        if is_daily_quota:
            return f"Quota IA épuisé. Réessayez dans {retry_delay}." if retry_delay else "Quota IA épuisé. Réessayez plus tard."
        return f"Limite IA atteinte. Réessayez dans {retry_delay}." if retry_delay else "Limite IA atteinte. Réessayez dans quelques secondes."
    if status == 503 or re.search(r"\b503\b", message):
        return "IA indisponible (503). Réessayez dans quelques secondes."
    if "timeout" in message.lower():
        return "Timeout IA (60s dépassé). Réessayez."
    if any(s in message for s in ("fetch failed", "ECONNRESET", "ETIMEDOUT")):
        return "Erreur réseau. Vérifiez la connexion et réessayez."
    if "JSON" in message:
        return "Réponse IA illisible. Réessayez avec un screenshot plus net."
    return f"Erreur inattendue : {message or 'inconnue'}"
