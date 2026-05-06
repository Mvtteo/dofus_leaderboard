require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const SCHEMA_SQL = `
-- 1. Nettoyage (Attention ça supprime tout !)
DROP TABLE IF EXISTS nuggets CASCADE;
DROP TABLE IF EXISTS match_participants CASCADE;
DROP TABLE IF EXISTS matches CASCADE;
DROP TABLE IF EXISTS season_stats CASCADE;
DROP TABLE IF EXISTS seasons CASCADE;
DROP TABLE IF EXISTS players CASCADE;
DROP TABLE IF EXISTS season_points CASCADE; -- Ancienne table au cas où

-- 2. Création des Tables
CREATE TABLE players (
    id SERIAL PRIMARY KEY,
    dofus_pseudo VARCHAR(255) UNIQUE NOT NULL,
    discord_id VARCHAR(255),
    discord_username VARCHAR(255),
    discord_nickname VARCHAR(255),
    total_points INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    bank_nuggets INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE seasons (
    id INTEGER PRIMARY KEY,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL
);

CREATE TABLE season_stats (
    player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
    season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE,
    points INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    PRIMARY KEY (player_id, season_id)
);

CREATE TABLE matches (
    id SERIAL PRIMARY KEY,
    season_id INTEGER REFERENCES seasons(id),
    alliance_tier VARCHAR(50),
    points_awarded INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE match_participants (
    match_id INTEGER REFERENCES matches(id) ON DELETE CASCADE,
    player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
    is_winner BOOLEAN NOT NULL,
    PRIMARY KEY (match_id, player_id)
);

CREATE TABLE nuggets (
    id SERIAL PRIMARY KEY,
    discord_id VARCHAR(255) NOT NULL,
    amount INTEGER NOT NULL,
    image_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
`;

async function reset() {
    try {
        console.log("⏳ Suppression et recréation des tables...");
        await pool.query(SCHEMA_SQL);
        console.log("✅ Base de données prête et compatible avec le bot !");
    } catch (e) {
        console.error("❌ Erreur :", e);
    } finally {
        pool.end();
    }
}

reset();