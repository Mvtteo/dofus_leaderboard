require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function updateSchema() {
    try {
        console.log("⚙️ Mise à jour de la base de données...");

        // 1. Ajouter la colonne discord_id (déjà fait, mais on laisse pour sécurité)
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS discord_id VARCHAR(50);`);
        
        // 2. Ajouter la colonne discord_username
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS discord_username VARCHAR(100);`);
        
        // 3. Ajouter un index
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_players_discord ON players(discord_id);`);

        // ============================================================
        // 4. CRÉATION DE LA TABLE MATCHES (C'est ça qu'il manquait !)
        // ============================================================
        await pool.query(`
            CREATE TABLE IF NOT EXISTS matches (
                id SERIAL PRIMARY KEY,
                winners TEXT,
                losers TEXT,
                date_match TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ Table 'matches' vérifiée/créée.");

        console.log("✅ TOUT EST BON : Base de données à jour !");
    } catch (error) {
        console.error("❌ Erreur :", error);
    } finally {
        pool.end();
    }
}

updateSchema();