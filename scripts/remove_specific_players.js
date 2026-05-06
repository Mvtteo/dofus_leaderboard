require('dotenv').config();
const { pool } = require('./db');

// 👇 LISTE DES JOUEURS À VIRER DU CLASSEMENT 👇
const BLACKLIST = [
    "Vinhyr", 
    "Jonnyzer", 
    "Troisinges", 
    "Duman", 
    "Ouais-le-big", 
    "Mehmet-le-goat"
];

async function removePlayers() {
    const client = await pool.connect();
    try {
        console.log("🧹 Nettoyage des joueurs spécifiés...");

        // On formate tout en minuscule pour être sûr de les trouver
        const namesLower = BLACKLIST.map(n => n.toLowerCase());

        // On supprime leurs lignes dans season_stats
        // (C'est ça qui les affiche sur le site)
        const res = await client.query(`
            DELETE FROM season_stats 
            WHERE player_id IN (
                SELECT id FROM players 
                WHERE LOWER(dofus_pseudo) = ANY($1::text[])
            )
        `, [namesLower]);

        console.log(`✅ SUCCÈS : ${res.rowCount} entrées supprimées du classement.`);
        console.log(`(Les joueurs : ${BLACKLIST.join(', ')} ne sont plus affichés)`);

    } catch (e) {
        console.error("❌ Erreur :", e);
    } finally {
        client.release();
        pool.end();
    }
}

removePlayers();