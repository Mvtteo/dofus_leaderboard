CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    dofus_pseudo VARCHAR(255) UNIQUE NOT NULL,
    total_points INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS season_points (
    id SERIAL PRIMARY KEY,
    dofus_pseudo VARCHAR(100) NOT NULL,
    season_id INTEGER NOT NULL,
    points INTEGER DEFAULT 0,
    UNIQUE(dofus_pseudo, season_id)
);

CREATE INDEX IF NOT EXISTS idx_players_points ON players(total_points DESC);