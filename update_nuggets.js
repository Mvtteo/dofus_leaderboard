require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function addNuggetsColumn() {
    try {
        console.log("⚙️  Mise à jour de la table 'players'...");
        
        // Ajoute la colonne bank_nuggets (type nombre entier, défaut 0)
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS bank_nuggets INTEGER DEFAULT 0;`);
        
        console.log("✅ SUCCÈS : Colonne 'bank_nuggets' ajoutée !");
    } catch (error) {
        console.error("❌ Erreur :", error);
    } finally {
        pool.end();
    }
}

addNuggetsColumn();