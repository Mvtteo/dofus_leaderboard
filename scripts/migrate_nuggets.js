require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function migrate() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Reset toutes les pepites dans season_stats
        const reset = await client.query('UPDATE season_stats SET nuggets = 0 WHERE nuggets > 0');
        console.log(`[1/3] Reset : ${reset.rowCount} lignes remises a 0`);

        // 2. Saison 1 : pepites avant le 15/02
        const s1 = await client.query(`
            INSERT INTO season_stats (player_id, season_id, points, wins, losses, nuggets)
            SELECT p.id, 1, 0, 0, 0, SUM(FLOOR(n.amount * 0.5))::int
            FROM nuggets n
            JOIN players p ON p.discord_id = n.discord_id
            WHERE n.created_at < '2026-02-15T00:00:00Z'
            GROUP BY p.id
            ON CONFLICT (player_id, season_id) DO UPDATE SET nuggets = EXCLUDED.nuggets
        `);
        console.log(`[2/3] Saison 1 : ${s1.rowCount} joueurs credites`);

        // 3. Saison 2 : pepites depuis le 15/02
        const s2 = await client.query(`
            INSERT INTO season_stats (player_id, season_id, points, wins, losses, nuggets)
            SELECT p.id, 2, 0, 0, 0, SUM(FLOOR(n.amount * 0.5))::int
            FROM nuggets n
            JOIN players p ON p.discord_id = n.discord_id
            WHERE n.created_at >= '2026-02-15T00:00:00Z'
            GROUP BY p.id
            ON CONFLICT (player_id, season_id) DO UPDATE SET nuggets = EXCLUDED.nuggets
        `);
        console.log(`[3/3] Saison 2 : ${s2.rowCount} joueurs credites`);

        await client.query('COMMIT');
        console.log('Migration terminee.');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Erreur, rollback :', e.message);
    } finally {
        client.release();
        pool.end();
    }
}

migrate();