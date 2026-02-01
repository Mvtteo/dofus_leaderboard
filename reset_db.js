require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function resetDatabase() {
    const client = await pool.connect();
    try {
        console.log("⚠️  ATTENTION : Nettoyage complet des données en cours...");
        
        // TRUNCATE : Vide les données
        // RESTART IDENTITY : Remet les IDs (1, 2, 3...) à zéro
        // CASCADE : Force le nettoyage même si les tables sont liées entre elles
        await client.query(`TRUNCATE TABLE players, season_points, matches RESTART IDENTITY CASCADE;`);
        
        console.log("✅ Données effacées avec succès !");
        console.log("📂 Les tables (players, season_points, matches) sont vides et prêtes.");
        
    } catch (err) {
        console.error("❌ Erreur lors du reset :", err);
    } finally {
        client.release();
        pool.end();
    }
}

// Sécurité : oblige à taper "node reset_db.js confirm"
if (process.argv[2] === 'confirm') {
    resetDatabase();
} else {
    console.log("🛑 SÉCURITÉ : Vous allez VIDER tout le contenu de la base de données.");
    console.log("Pour confirmer, lancez :");
    console.log("node reset_db.js confirm");
}