require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- SCHEMA ---
const SCHEMA_SQL = `
DROP TABLE IF EXISTS nuggets CASCADE;
DROP TABLE IF EXISTS match_participants CASCADE;
DROP TABLE IF EXISTS matches CASCADE;
DROP TABLE IF EXISTS season_stats CASCADE;
DROP TABLE IF EXISTS seasons CASCADE;
DROP TABLE IF EXISTS players CASCADE;

CREATE TABLE players (
    id SERIAL PRIMARY KEY,
    dofus_pseudo VARCHAR(255) UNIQUE NOT NULL,
    discord_id VARCHAR(255),
    discord_username VARCHAR(255),
    discord_nickname VARCHAR(255),
    total_points INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    bank_nuggets INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE seasons (
    id INTEGER PRIMARY KEY,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL
);

CREATE TABLE season_stats (
    player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
    season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE,
    points INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    PRIMARY KEY (player_id, season_id)
);

CREATE TABLE matches (
    id SERIAL PRIMARY KEY,
    season_id INTEGER REFERENCES seasons(id),
    alliance_tier VARCHAR(50),
    points_awarded INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE match_participants (
    match_id INTEGER REFERENCES matches(id) ON DELETE CASCADE,
    player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,
    is_winner BOOLEAN NOT NULL,
    PRIMARY KEY (match_id, player_id)
);

CREATE TABLE nuggets (
    id SERIAL PRIMARY KEY,
    discord_id VARCHAR(255) NOT NULL,
    amount INTEGER NOT NULL,
    image_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
`;

async function main() {
    const client = await pool.connect();
    try {
        console.log("🚀 DÉMARRAGE DU MERGE COMPLET (V2 FIXED)...");
        
        // 1. RESET DB
        console.log("🧹 Étape 1 : Reset de la Base de Données...");
        await client.query(SCHEMA_SQL);

        // 2. RESTAURATION DU FULL BACKUP (DONNÉES RÉCENTES)
        console.log("📥 Étape 2 : Restauration de backup_full.json...");
        const fullData = JSON.parse(fs.readFileSync('backup_full.json'));
        
        await client.query('BEGIN');

        // Saisons
        if (fullData.seasons) {
            for (const s of fullData.seasons) {
                await client.query(`INSERT INTO seasons (id, start_date, end_date) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`, [s.id, s.start_date, s.end_date]);
            }
        } else {
            await client.query(`INSERT INTO seasons (id, start_date, end_date) VALUES (1, '2026-02-01', '2026-02-15') ON CONFLICT DO NOTHING`);
        }

        // Joueurs
        for (const p of fullData.players) {
            await client.query(
                `INSERT INTO players (id, dofus_pseudo, discord_id, discord_username, discord_nickname, total_points, wins, losses, bank_nuggets, created_at) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (id) DO NOTHING`,
                [p.id, p.dofus_pseudo, p.discord_id, p.discord_username, p.discord_nickname, p.total_points, p.wins, p.losses, p.bank_nuggets || 0, p.created_at]
            );
        }
        // FIX SÉQUENCE JOUEURS
        await client.query(`SELECT setval(pg_get_serial_sequence('players', 'id'), COALESCE((SELECT MAX(id) FROM players), 1))`);

        // Matchs récents
        for (const m of fullData.matches) {
            await client.query(
                `INSERT INTO matches (id, season_id, alliance_tier, points_awarded, created_at) 
                 VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
                [m.id, m.season_id, m.alliance_tier, m.points_awarded, m.created_at]
            );
        }
        // FIX SÉQUENCE MATCHS (C'est ici que ça plantait avant)
        await client.query(`SELECT setval(pg_get_serial_sequence('matches', 'id'), COALESCE((SELECT MAX(id) FROM matches), 1))`);

        // Participants
        for (const mp of fullData.match_participants) {
            await client.query(`INSERT INTO match_participants (match_id, player_id, is_winner) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [mp.match_id, mp.player_id, mp.is_winner]);
        }

        // Stats Saisons
        for (const ss of fullData.season_stats) {
            await client.query(`INSERT INTO season_stats (player_id, season_id, points, wins, losses) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, [ss.player_id, ss.season_id, ss.points, ss.wins, ss.losses]);
        }

        // Nuggets
        if (fullData.nuggets) {
            for (const n of fullData.nuggets) {
                await client.query(`INSERT INTO nuggets (id, discord_id, amount, image_hash, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`, [n.id, n.discord_id, n.amount, n.image_hash, n.created_at]);
            }
            await client.query(`SELECT setval(pg_get_serial_sequence('nuggets', 'id'), COALESCE((SELECT MAX(id) FROM nuggets), 1))`);
        }

        await client.query('COMMIT');
        console.log("✅ Backup récent restauré !");


        // 3. INJECTION DU OLD BACKUP
        console.log("💉 Étape 3 : Fusion de backup_old.json...");
        const oldData = JSON.parse(fs.readFileSync('backup_old.json'));
        const oldMatches = oldData.tables.matches || [];
        
        await client.query('BEGIN');
        let addedMatches = 0;

        for (const m of oldMatches) {
            const winners = m.winners ? m.winners.split(',').map(s => s.trim()).filter(s => s) : [];
            const losers = m.losers ? m.losers.split(',').map(s => s.trim()).filter(s => s) : [];

            if (winners.length === 0 && losers.length === 0) continue;

            const seasonId = 1;
            const pts = 12;

            // CRÉATION DU MATCH (L'ID sera auto-incrémenté correctement maintenant)
            const matchRes = await client.query(
                `INSERT INTO matches (season_id, alliance_tier, points_awarded, created_at) 
                 VALUES ($1, 'legacy', $2, $3) RETURNING id`,
                [seasonId, pts, m.date_match || new Date()]
            );
            const matchId = matchRes.rows[0].id;

            // PARTICIPANTS
            const participants = [
                ...winners.map(name => ({ name, win: true })),
                ...losers.map(name => ({ name, win: false }))
            ];

            for (const p of participants) {
                // On crée ou on récupère
                await client.query(`INSERT INTO players (dofus_pseudo) VALUES ($1) ON CONFLICT (dofus_pseudo) DO NOTHING`, [p.name]);
                
                const pRes = await client.query(`SELECT id FROM players WHERE dofus_pseudo = $1`, [p.name]);
                const pid = pRes.rows[0].id;

                await client.query(`INSERT INTO match_participants (match_id, player_id, is_winner) VALUES ($1, $2, $3)`, [matchId, pid, p.win]);

                const w = p.win ? 1 : 0;
                const l = p.win ? 0 : 1;
                const points = p.win ? pts : 0;

                await client.query(
                    `UPDATE players SET total_points = total_points + $1, wins = wins + $2, losses = losses + $3 WHERE id = $4`, 
                    [points, w, l, pid]
                );

                await client.query(`
                    INSERT INTO season_stats (player_id, season_id, points, wins, losses) VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (player_id, season_id) DO UPDATE SET 
                    points = season_stats.points + $3, wins = season_stats.wins + $4, losses = season_stats.losses + $5
                `, [pid, seasonId, points, w, l]);
            }
            addedMatches++;
        }

        await client.query('COMMIT');
        console.log(`✅ FUSION TERMINÉE AVEC SUCCÈS ! ${addedMatches} anciens matchs ajoutés.`);

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ ERREUR CRITIQUE :", e);
    } finally {
        client.release();
        pool.end();
    }
}

main();