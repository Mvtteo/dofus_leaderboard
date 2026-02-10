require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function backup() {
    console.log("📦 Démarrage du backup complet...");
    const backupData = {};

    // Liste de toutes les tables possibles (anciennes et nouvelles)
    const tables = [
        'players', 
        'matches', 
        'match_participants', 
        'season_stats', 
        'season_points', // Ancienne table potentielle
        'nuggets', 
        'seasons'
    ];

    for (const table of tables) {
        try {
            const res = await pool.query(`SELECT * FROM ${table}`);
            if (res.rows.length > 0) {
                console.log(`✅ Table '${table}' : ${res.rows.length} enregistrements trouvés.`);
                backupData[table] = res.rows;
            } else {
                console.log(`ℹ️ Table '${table}' vide ou inexistante.`);
            }
        } catch (e) {
            // On ignore l'erreur si la table n'existe pas
            if (e.code === '42P01') {
                console.log(`❌ Table '${table}' n'existe pas dans cette BDD.`);
            } else {
                console.error(`⚠️ Erreur lecture table '${table}':`, e.message);
            }
        }
    }

    // Sauvegarde dans un fichier JSON
    const filename = `backup_data_${Date.now()}.json`;
    fs.writeFileSync(filename, JSON.stringify(backupData, null, 2));
    
    console.log(`\n💾 SAUVEGARDE TERMINÉE !`);
    console.log(`👉 Fichier créé : ${filename}`);
    console.log("Gardez ce fichier précieusement avant de lancer le reset.");
    
    pool.end();
}

backup();