import asyncio
from dataclasses import dataclass, field

SESSION_TIMEOUT_S = 2 * 60


@dataclass
class PvpSession:
    winners: list[str] = field(default_factory=list)
    losers: list[str] = field(default_factory=list)
    context: str | None = None
    alliance_tier: str | None = None
    alliance_name: str | None = None
    percepteur_detected: bool = False
    has_won: bool | None = None


active_sessions: dict[int, PvpSession] = {}
_timeouts: dict[int, asyncio.Task] = {}


def get_session(user_id: int) -> PvpSession | None:
    return active_sessions.get(user_id)


def get_or_create_session(user_id: int) -> PvpSession:
    return active_sessions.setdefault(user_id, PvpSession())


def delete_session(user_id: int) -> None:
    active_sessions.pop(user_id, None)
    clear_timeout(user_id)


def clear_timeout(user_id: int) -> None:
    task = _timeouts.pop(user_id, None)
    if task and not task.done():
        task.cancel()


def set_timeout(user_id: int, on_expire) -> None:
    """on_expire: async callback with no args, called after 2min of inactivity."""
    clear_timeout(user_id)

    async def _expire():
        try:
            await asyncio.sleep(SESSION_TIMEOUT_S)
        except asyncio.CancelledError:
            return
        active_sessions.pop(user_id, None)
        _timeouts.pop(user_id, None)
        await on_expire()

    _timeouts[user_id] = asyncio.create_task(_expire())
