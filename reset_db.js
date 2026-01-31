require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function resetDatabase() {
    const client = await pool.connect();
    try {
        console.log("⚠️  ATTENTION : Suppression de toutes les données en cours...");
        
        // Cette commande vide les tables et remet les compteurs d'ID à 1
        await client.query(`TRUNCATE TABLE season_points, players RESTART IDENTITY CASCADE;`);
        
        console.log("✅ Base de données entièrement vidée avec succès !");
        console.log("🔄 Les IDs sont remis à 1.");
    } catch (err) {
        console.error("❌ Erreur lors du reset :", err);
    } finally {
        client.release();
        pool.end();
    }
}

// Petit système de sécurité : demande d'argument
// On oblige à lancer le script avec un argument pour éviter les clics accidentels
if (process.argv[2] === 'confirm') {
    resetDatabase();
} else {
    console.log("🛑 SECURITÉ : Pour confirmer la suppression, lancez la commande suivante :");
    console.log("node reset_db.js confirm");
}