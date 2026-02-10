require('dotenv').config();
const { pool } = require('./db');

// 👇 METS LE VRAI PSEUDO DISCORD ICI 👇
const TARGET_USERNAME = "therocolosse"; 

async function halveWinsLossesOnly() {
    const client = await pool.connect();
    try {
        console.log(`[Traitement] Division des Victoires/Défaites (SANS toucher aux points) pour : ${TARGET_USERNAME}...`);

        await client.query('BEGIN');

        // 1. On récupère l'ID Discord
        const resUser = await client.query(
            `SELECT discord_id FROM players WHERE discord_username = $1 LIMIT 1`,
            [TARGET_USERNAME]
        );

        if (resUser.rows.length === 0) {
            console.log(`❌ ERREUR : Joueur introuvable.`);
            await client.query('ROLLBACK');
            return;
        }

        const discordId = resUser.rows[0].discord_id;
        
        // 2. On récupère les IDs des persos
        const resPlayers = await client.query(
            `SELECT id FROM players WHERE discord_id = $1`,
            [discordId]
        );
        const playerIds = resPlayers.rows.map(p => p.id);

        // 3. Mise à jour GLOBAL (Table players) - JUSTE WINS/LOSSES
        await client.query(
            `UPDATE players 
             SET wins = FLOOR(wins / 2),
                 losses = FLOOR(losses / 2)
             WHERE discord_id = $1`,
            [discordId]
        );

        // 4. Mise à jour SAISON (Table season_stats) - JUSTE WINS/LOSSES
        await client.query(
            `UPDATE season_stats 
             SET wins = FLOOR(wins / 2),
                 losses = FLOOR(losses / 2)
             WHERE player_id = ANY($1::int[])`,
            [playerIds]
        );

        await client.query('COMMIT');

        console.log("✂️  C'est fait ! Uniquement les Victoires et Défaites ont été divisées par 2.");

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("[ERREUR SQL]", e);
    } finally {
        client.release();
        pool.end();
    }
}

halveWinsLossesOnly();