import time

from fastapi import Cookie, HTTPException, Request

ADMIN_TOKENS: set[str] = set()

MAX_ATTEMPTS = 5
LOCKOUT_S = 15 * 60
_login_attempts: dict[str, dict] = {}


def is_admin(admin_token: str | None = Cookie(default=None)) -> bool:
    return bool(admin_token and admin_token in ADMIN_TOKENS)


def require_admin(admin_token: str | None = Cookie(default=None)) -> None:
    if not admin_token or admin_token not in ADMIN_TOKENS:
        raise HTTPException(status_code=401, detail="Non autorisé.")


def check_rate_limit(ip: str) -> bool:
    entry = _login_attempts.get(ip)
    if not entry:
        return True
    if time.time() - entry["first"] > LOCKOUT_S:
        del _login_attempts[ip]
        return True
    return entry["count"] < MAX_ATTEMPTS


def record_failed_login(ip: str) -> None:
    entry = _login_attempts.get(ip)
    if not entry:
        _login_attempts[ip] = {"count": 1, "first": time.time()}
    else:
        entry["count"] += 1


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"
