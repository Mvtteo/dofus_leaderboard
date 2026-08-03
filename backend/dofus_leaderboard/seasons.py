from dataclasses import dataclass
from datetime import date, datetime, timedelta

INITIAL_DATE = datetime(2026, 7, 25)  # nouvelle base : on repart de la saison 1
DAYS_PER_SEASON = 14


@dataclass
class SeasonWindow:
    id: int
    label: str
    start: datetime
    end: datetime
    end_raw: str
    is_current: bool


def get_seasons(season_end_override: str | None) -> tuple[list[SeasonWindow], int]:
    now = datetime.now()
    seasons: list[SeasonWindow] = []
    loop_date = INITIAL_DATE
    season_id = 1
    current_season_id = 1
    override_applied = False

    while True:
        start = loop_date
        if start > now:
            break
        end = start + timedelta(days=DAYS_PER_SEASON) - timedelta(milliseconds=1)

        if not override_applied and season_end_override:
            override_date = datetime.fromisoformat(season_end_override).replace(
                hour=23, minute=59, second=59, microsecond=999000
            )
            if start <= override_date <= end:
                end = override_date
                override_applied = True

        is_current = start <= now <= end
        if is_current:
            current_season_id = season_id

        start_str = start.strftime("%d/%m")
        end_str = end.strftime("%d/%m")
        seasons.append(
            SeasonWindow(
                id=season_id,
                label=f"Saison {season_id} ({start_str} - {end_str})",
                start=start,
                end=end,
                end_raw=end.date().isoformat(),
                is_current=is_current,
            )
        )

        loop_date = datetime(end.year, end.month, end.day) + timedelta(days=1)
        season_id += 1
        if season_id > 1000:
            break

    if not seasons:
        end = INITIAL_DATE + timedelta(days=DAYS_PER_SEASON)
        seasons.append(
            SeasonWindow(
                id=1,
                label="Saison 1 (Bientot)",
                start=INITIAL_DATE,
                end=end,
                end_raw=end.date().isoformat(),
                is_current=True,
            )
        )

    return seasons, current_season_id
