require('dotenv').config();
const { pool } = require('./db');

// 👇 METS LE VRAI PSEUDO DISCORD ICI (sans le @) 👇
const TARGET_USERNAME = "therocolosse"; 

async function halvePointsByName() {
    const client = await pool.connect();
    try {
        console.log(`[Traitement] Recherche du joueur avec le pseudo : ${TARGET_USERNAME}...`);

        await client.query('BEGIN');

        // 1. On cherche d'abord l'ID Discord à partir du pseudo
        const resUser = await client.query(
            `SELECT discord_id FROM players WHERE discord_username = $1 LIMIT 1`,
            [TARGET_USERNAME]
        );

        if (resUser.rows.length === 0) {
            console.log(`❌ ERREUR : Aucun joueur trouvé avec le pseudo "${TARGET_USERNAME}".`);
            console.log("👉 Vérifie que c'est bien le nom d'utilisateur (pas le surnom affiché sur le serveur).");
            await client.query('ROLLBACK');
            return;
        }

        const discordId = resUser.rows[0].discord_id;
        console.log(`✅ Joueur trouvé ! ID Discord correspondant : ${discordId}`);

        // 2. Récupérer les persos liés pour info
        const resPlayers = await client.query(
            `SELECT id, dofus_pseudo, total_points FROM players WHERE discord_id = $1`,
            [discordId]
        );
        const playerIds = resPlayers.rows.map(p => p.id);

        // 3. Diviser le total global (Table players)
        await client.query(
            `UPDATE players 
             SET total_points = FLOOR(total_points / 2) 
             WHERE discord_id = $1`,
            [discordId]
        );

        // 4. Diviser les stats des saisons (Table season_stats)
        await client.query(
            `UPDATE season_stats 
             SET points = FLOOR(points / 2) 
             WHERE player_id = ANY($1::int[])`,
            [playerIds]
        );

        await client.query('COMMIT');

        console.log("✂️  POINTS DIVISÉS PAR 2 :");
        resPlayers.rows.forEach(p => {
            console.log(`- ${p.dofus_pseudo} : ${p.total_points} -> ${Math.floor(p.total_points / 2)}`);
        });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("[ERREUR SQL]", e);
    } finally {
        client.release();
        pool.end();
    }
}

halvePointsByName();