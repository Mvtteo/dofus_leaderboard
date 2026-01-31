require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function updateSchema() {
    try {
        console.log("⚙️ Mise à jour de la base de données...");

        // 1. Ajouter la colonne discord_id
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS discord_id VARCHAR(50);`);
        
        // 2. Ajouter la colonne discord_username
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS discord_username VARCHAR(100);`);
        
        // 3. Ajouter un index
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_players_discord ON players(discord_id);`);

        console.log("✅ SUCCÈS : Colonnes ajoutées !");
    } catch (error) {
        console.error("❌ Erreur :", error);
    } finally {
        pool.end();
    }
}

updateSchema();