require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Nécessaire pour Railway
});

async function initDB() {
    try {
        console.log("🏗️ Création des tables en cours...");

        const query = `
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
            -- Ajout des colonnes pour lier à Discord
            ALTER TABLE players ADD COLUMN IF NOT EXISTS discord_id VARCHAR(50);
            ALTER TABLE players ADD COLUMN IF NOT EXISTS discord_username VARCHAR(100);

            -- Index pour que le classement soit rapide à calculer
            CREATE INDEX IF NOT EXISTS idx_players_discord ON players(discord_id);

            CREATE INDEX IF NOT EXISTS idx_players_points ON players(total_points DESC);
        `;

        await pool.query(query);
        console.log("✅ Tables créées avec succès !");
    } catch (error) {
        console.error("❌ Erreur :", error);
    } finally {
        pool.end();
    }
}

initDB();