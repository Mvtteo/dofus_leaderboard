require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    try {
        console.log("🛠️ Ajout des colonnes wins/losses...");
        
        // 1. Création des colonnes
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS wins INTEGER DEFAULT 0;`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS losses INTEGER DEFAULT 0;`);
        
        console.log("🔄 Recalcul de l'historique complet...");

        // 2. On remet tout à zéro pour être sûr
        await pool.query(`UPDATE players SET wins = 0, losses = 0;`);

        // 3. On lit tous les matchs
        const res = await pool.query('SELECT winners, losers FROM matches');
        
        let updates = {}; // Stockage temporaire en mémoire

        for (const match of res.rows) {
            const winners = match.winners ? match.winners.split(',').map(p => p.trim()) : [];
            const losers = match.losers ? match.losers.split(',').map(p => p.trim()) : [];

            winners.forEach(p => {
                if(!updates[p]) updates[p] = {w:0, l:0};
                updates[p].w++;
            });
            losers.forEach(p => {
                if(!updates[p]) updates[p] = {w:0, l:0};
                updates[p].l++;
            });
        }

        // 4. On sauvegarde dans la DB
        console.log(`💾 Sauvegarde des stats pour ${Object.keys(updates).length} joueurs...`);
        for (const [pseudo, stats] of Object.entries(updates)) {
            // On utilise LOWER() pour matcher même si la casse diffère légèrement
            await pool.query(
                `UPDATE players SET wins = $1, losses = $2 WHERE dofus_pseudo = $3`,
                [stats.w, stats.l, pseudo]
            );
        }

        console.log("✅ Migration terminée !");

    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

migrate();