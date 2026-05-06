// Fichier: restore_db.js
require('dotenv').config();
const fs = require('fs');
const { pool } = require('./db');

async function restore() {
    const client = await pool.connect();
    try {
        console.log("📦 Lecture du fichier 'backup_full.json'...");
        if (!fs.existsSync('backup_full.json')) throw new Error("Fichier introuvable ! Renomme ton backup.");
        
        const data = JSON.parse(fs.readFileSync('backup_full.json'));
        await client.query('BEGIN'); // On sécurise tout dans une transaction

        // 1. RESTAURATION SEASONS
        if (data.seasons) {
            console.log(`🔄 Import ${data.seasons.length} saisons...`);
            for (const s of data.seasons) {
                await client.query(
                    `INSERT INTO seasons (id, start_date, end_date) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
                    [s.id, s.start_date, s.end_date]
                );
            }
        }

        // 2. RESTAURATION PLAYERS
        if (data.players) {
            console.log(`🔄 Import ${data.players.length} joueurs...`);
            for (const p of data.players) {
                await client.query(
                    `INSERT INTO players (id, dofus_pseudo, discord_id, discord_username, discord_nickname, total_points, wins, losses, bank_nuggets, created_at) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
                    [p.id, p.dofus_pseudo, p.discord_id, p.discord_username, p.discord_nickname, p.total_points, p.wins, p.losses, p.bank_nuggets || 0, p.created_at]
                );
                // On met à jour la séquence ID pour éviter les erreurs futures
                await client.query(`SELECT setval('players_id_seq', (SELECT MAX(id) FROM players))`);
            }
        }

        // 3. RESTAURATION MATCHES
        if (data.matches) {
            console.log(`🔄 Import ${data.matches.length} matchs...`);
            for (const m of data.matches) {
                await client.query(
                    `INSERT INTO matches (id, season_id, alliance_tier, points_awarded, created_at) 
                     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
                    [m.id, m.season_id, m.alliance_tier, m.points_awarded, m.created_at]
                );
                await client.query(`SELECT setval('matches_id_seq', (SELECT MAX(id) FROM matches))`);
            }
        }

        // 4. RESTAURATION PARTICIPANTS
        if (data.match_participants) {
            console.log(`🔄 Import ${data.match_participants.length} participations...`);
            for (const mp of data.match_participants) {
                await client.query(
                    `INSERT INTO match_participants (match_id, player_id, is_winner) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
                    [mp.match_id, mp.player_id, mp.is_winner]
                );
            }
        }

        // 5. RESTAURATION SEASON_STATS
        if (data.season_stats) {
            console.log(`🔄 Import ${data.season_stats.length} stats saison...`);
            for (const ss of data.season_stats) {
                await client.query(
                    `INSERT INTO season_stats (player_id, season_id, points, wins, losses) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
                    [ss.player_id, ss.season_id, ss.points, ss.wins, ss.losses]
                );
            }
        }

        // 6. RESTAURATION NUGGETS
        if (data.nuggets) {
            console.log(`🔄 Import ${data.nuggets.length} historiques pépites...`);
            for (const n of data.nuggets) {
                await client.query(
                    `INSERT INTO nuggets (id, discord_id, amount, image_hash, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
                    [n.id, n.discord_id, n.amount, n.image_hash, n.created_at]
                );
                await client.query(`SELECT setval('nuggets_id_seq', (SELECT MAX(id) FROM nuggets))`);
            }
        }

        await client.query('COMMIT');
        console.log("✅ Restauration terminée avec succès !");

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ Erreur restauration :", e);
    } finally {
        client.release();
        pool.end();
    }
}

restore();