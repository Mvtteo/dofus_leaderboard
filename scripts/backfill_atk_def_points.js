require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Recalcule season_stats.atk_points / def_points depuis l'historique complet des matchs.
// Reproduit la règle de crédit utilisée en direct par le bot :
//   - un participant est "credité" quand match_participants.is_winner = matches.has_won
//   - les multi-comptes (même discord_id) ne sont crédités qu'une seule fois par match
async function backfill() {
    try {
        console.log("🛠️ Vérification des colonnes atk_points/def_points...");
        await pool.query(`ALTER TABLE season_stats ADD COLUMN IF NOT EXISTS atk_points INTEGER DEFAULT 0`);
        await pool.query(`ALTER TABLE season_stats ADD COLUMN IF NOT EXISTS def_points INTEGER DEFAULT 0`);

        console.log("🔄 Lecture de l'historique des matchs...");
        const matches = await pool.query(`
            SELECT id, season_id, context, has_won, points_awarded
            FROM matches
            WHERE NOT COALESCE(cancelled, false)
            ORDER BY id
        `);

        const totals = new Map(); // key: player_id|season_id -> { atk, def }

        for (const m of matches.rows) {
            const pts = m.points_awarded || 0;
            if (pts === 0) continue;

            const participants = await pool.query(`
                SELECT mp.player_id, p.discord_id
                FROM match_participants mp
                JOIN players p ON p.id = mp.player_id
                WHERE mp.match_id = $1 AND mp.is_winner = $2
                ORDER BY mp.player_id
            `, [m.id, m.has_won]);

            const seenDiscordIds = new Set();
            for (const row of participants.rows) {
                if (row.discord_id) {
                    if (seenDiscordIds.has(row.discord_id)) continue;
                    seenDiscordIds.add(row.discord_id);
                }
                const key = `${row.player_id}|${m.season_id}`;
                if (!totals.has(key)) totals.set(key, { atk: 0, def: 0 });
                const t = totals.get(key);
                if (m.context === 'defense') t.def += pts;
                else t.atk += pts;
            }
        }

        console.log(`💾 Sauvegarde pour ${totals.size} paires joueur/saison...`);
        await pool.query('UPDATE season_stats SET atk_points = 0, def_points = 0');
        for (const [key, t] of totals.entries()) {
            const [playerId, seasonId] = key.split('|');
            await pool.query(`
                INSERT INTO season_stats (player_id, season_id, atk_points, def_points)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (player_id, season_id) DO UPDATE SET
                atk_points = EXCLUDED.atk_points,
                def_points = EXCLUDED.def_points
            `, [playerId, seasonId, t.atk, t.def]);
        }

        console.log("✅ Backfill attaque/défense terminé !");
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}

backfill();
