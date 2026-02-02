require('dotenv').config({ path: process.argv[2] || '.env' });
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function updateSchema() {
    try {
        console.log("⚙️ Mise à jour de la base de données...");
        // Sécurité pour ne pas afficher le mot de passe dans la console
        if (process.env.DATABASE_URL) {
            console.log("📡 Connexion à:", process.env.DATABASE_URL.split('@')[1]); 
        }

        // 1. CRÉATION TABLE PLAYERS
        await pool.query(`
            CREATE TABLE IF NOT EXISTS players (
                dofus_pseudo VARCHAR(100) PRIMARY KEY,
                discord_id VARCHAR(50),
                discord_username VARCHAR(100),
                total_points INTEGER DEFAULT 0,
                bank_nuggets INTEGER DEFAULT 0
            );
        `);
        console.log("✅ Table 'players' OK");

        // --- 🆕 NOUVELLE COLONNE : SURNOM DISCORD ---
        // Cette commande ajoute la colonne si elle manque, sans effacer les données
        await pool.query(`
            ALTER TABLE players 
            ADD COLUMN IF NOT EXISTS discord_nickname TEXT;
        `);
        console.log("✅ Colonne 'discord_nickname' ajoutée/vérifiée.");
        // ---------------------------------------------

        // 2. CRÉATION TABLE MATCHES
        await pool.query(`
            CREATE TABLE IF NOT EXISTS matches (
                id SERIAL PRIMARY KEY,
                winners TEXT,
                losers TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ Table 'matches' OK");

        // 3. CRÉATION TABLE SEASON_POINTS
        await pool.query(`
            CREATE TABLE IF NOT EXISTS season_points (
                dofus_pseudo VARCHAR(100),
                season_id INTEGER,
                points INTEGER DEFAULT 0,
                PRIMARY KEY (dofus_pseudo, season_id)
            );
        `);
        console.log("✅ Table 'season_points' OK");

        // 4. INDEX pour optimisation
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_players_discord ON players(discord_id);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_season_points_season ON season_points(season_id);`);
        console.log("✅ Index OK");

        console.log("\n🎉 Base de données à jour !");
        
    } catch (error) {
        console.error("❌ Erreur :", error);
    } finally {
        pool.end();
    }
}

updateSchema();