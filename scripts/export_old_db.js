// Fichier: export_old_db.js
require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function exportData() {
    try {
        console.log("📦 Exportation des anciens matchs...");
        
        // On récupère tout de l'ancienne table
        // Si ta table s'appelait autrement, change 'matches' ici
        const res = await pool.query('SELECT * FROM matches');
        
        const data = JSON.stringify(res.rows, null, 2);
        fs.writeFileSync('backup_matches.json', data);
        
        console.log(`✅ Succès ! ${res.rows.length} matchs sauvegardés dans 'backup_matches.json'.`);
        console.log("👉 Tu peux maintenant supprimer les anciennes tables et installer les nouvelles.");
        
    } catch (e) {
        console.error("❌ Erreur export :", e.message);
    } finally {
        pool.end();
    }
}

exportData();