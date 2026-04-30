require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');

// --- CRASH HANDLERS (avant tout le reste) ---
process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRASH] Unhandled Rejection:', reason);
});
process.on('uncaughtException', (error) => {
    console.error('[CRASH] Uncaught Exception:', error);
});
const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    Events
} = require('discord.js');
const { OpenAI } = require('openai');

// --- IMPORTS ---
const { pool } = require('./db');
const config = require('./config');

// --- GROQ AI ---
const AI_TIMEOUT_MS = 60000;
const AI_MAX_RETRIES = 3;
const AI_MODEL = process.env.AI_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';

let ai = null;
if (process.env.GROQ_API_KEY) {
    ai = new OpenAI({
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey: process.env.GROQ_API_KEY,
    });
} else {
    console.warn('[AI] GROQ_API_KEY manquante — analyse d\'images désactivée');
}

// Convertit le format parts Gemini → content OpenAI
function partsToContent(parts) {
    return parts.map(part => {
        if (part.inlineData) {
            return {
                type: 'image_url',
                image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` }
            };
        }
        return { type: 'text', text: part.text };
    });
}

async function callGemini(parts, retries = AI_MAX_RETRIES) {
    if (!ai) throw new Error('AI non configurée (GROQ_API_KEY manquante)');
    const content = partsToContent(parts);
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const result = await Promise.race([
                (async () => {
                    const stream = await ai.chat.completions.create({
                        model: AI_MODEL,
                        messages: [{ role: 'user', content }],
                        temperature: 1,
                        max_completion_tokens: 1024,
                        top_p: 1,
                        stream: true,
                    });
                    let text = '';
                    for await (const chunk of stream) {
                        const delta = chunk.choices?.[0]?.delta?.content;
                        if (delta) text += delta;
                    }
                    return { text };
                })(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('AI timeout (60s)')), AI_TIMEOUT_MS))
            ]);
            return result;
        } catch (err) {
            const isRetryable = err.status === 503 || err.message?.includes('timeout') || err.message?.includes('fetch failed') || err.message?.includes('ECONNRESET') || err.message?.includes('ETIMEDOUT') || err.type === 'system';
            console.log(`[AI] Tentative ${attempt}/${retries} echouee: ${err.message || err.status}`);
            if (attempt < retries && isRetryable) {
                const delay = attempt * 10000;
                console.log(`[AI] Retry dans ${delay/1000}s...`);
                await new Promise(r => setTimeout(r, delay));
            } else {
                throw err;
            }
        }
    }
}

// --- AI QUEUE ---
const geminiQueue = [];
let geminiProcessing = false;

async function queueGemini(parts) {
    return new Promise((resolve, reject) => {
        geminiQueue.push({ parts, resolve, reject, retries: 0 });
        processGeminiQueue();
    });
}

async function processGeminiQueue() {
    if (geminiProcessing || geminiQueue.length === 0) return;
    geminiProcessing = true;
    try {
        while (geminiQueue.length > 0) {
            const item = geminiQueue.shift();
            const { parts, resolve, reject } = item;
            try {
                const result = await callGemini(parts);
                resolve(result);
                if (geminiQueue.length > 0) await new Promise(r => setTimeout(r, 1000));
            } catch (err) {
                if ((err.status === 429 || err.message?.includes('429')) && item.retries < 3) {
                    console.log(`[AI] 429 reçu, pause 15s puis retry (${item.retries + 1}/3)...`);
                    await new Promise(r => setTimeout(r, 15000));
                    geminiQueue.unshift({ ...item, retries: item.retries + 1 });
                } else {
                    reject(err);
                    if (geminiQueue.length > 0) await new Promise(r => setTimeout(r, 1000));
                }
            }
        }
    } finally {
        geminiProcessing = false;
    }
}

// --- FONCTION UTILITAIRE : SUPPRESSION ACCENTS ---
function removeAccents(str) {
    if (!str) return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function hasStaffRole(member) {
    if (!member) return false;
    if (member.permissions.has('Administrator')) return true;
    return member.roles.cache.some(r => r.name.toUpperCase() === 'STAFF');
}

if (!config.CHANNEL_ID) {
    console.error("ERREUR : CHANNEL_ID manquant dans le .env");
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const activeSessions = new Map();
const sessionTimeouts = new Map();
const SESSION_TIMEOUT_MS = 2 * 60 * 1000;

function setSessionTimeout(userId, msgRef) {
    clearSessionTimeout(userId);
    const timer = setTimeout(async () => {
        activeSessions.delete(userId);
        sessionTimeouts.delete(userId);
        try { await msgRef.edit({ content: '[EXPIRÉ] Session annulée (inactivité 2 min).', components: [] }); } catch {}
    }, SESSION_TIMEOUT_MS);
    sessionTimeouts.set(userId, timer);
}

function clearSessionTimeout(userId) {
    const existing = sessionTimeouts.get(userId);
    if (existing) { clearTimeout(existing); sessionTimeouts.delete(userId); }
}

// Helper : extrait le texte de la réponse
function getResponseText(result) {
    return result?.text || '';
}

// ============================================
// 1. IA : LECTURE DES SCREENS PVP
// ============================================
async function parseScreenWithAI(imageUrl) {
    try {
        const response = await fetch(imageUrl);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        
        const result = await queueGemini([
            { inlineData: { data: base64, mimeType: "image/png" } },
            { text: `Analyse ce screenshot de fin de combat Dofus (Alliance vs Alliance).
             Extrait UNIQUEMENT les pseudos des joueurs HUMAINS.
             
             IMPORTANT : Le screenshot peut ne montrer QU'UNE SEULE section (soit GAGNANTS, soit PERDANTS).
             Dans ce cas, remplis la section visible et laisse l'autre vide [].
             
             CRUCIAL - SECTION :
             - Si tu vois le titre "PERDANTS" ou "LOSERS", TOUS les noms en dessous vont dans "losers" UNIQUEMENT.
             - Si tu vois le titre "GAGNANTS" ou "WINNERS", TOUS les noms en dessous vont dans "winners" UNIQUEMENT.
             - Ne jamais mettre un nom dans la mauvaise section.
             
             CRUCIAL - DETECTION COMPLETE :
             - Il DOIT y avoir jusqu'à 5 joueurs par section visible. Cherche TOUS les noms présents.
             - Si tu ne vois que 3 ou 4 noms là où il devrait y en avoir 5, regarde plus attentivement toute la colonne.
             - Le nombre de joueurs détectés est critique : il influe directement sur les points attribués.
             
             Regles STRICTES :
             - Les pseudos sous "GAGNANTS" ou "WINNERS" vont dans winners
             - Les pseudos sous "PERDANTS" ou "LOSERS" vont dans losers
             - MAXIMUM 5 joueurs par equipe (un combat AvA est 5v5 max)
             - Extraire le NOM COMPLET tel qu'affiché
             - Les pseudos peuvent être : un seul mot (ex: Bouff, Ketzal) OU plusieurs mots reliés par des tirets (ex: Raconte-pas-ta-vie, Mangeur-de-bouf, Jprotec-R)
             - Les Percepteurs ont TOUJOURS "Do'" dans leur nom (ex: "Despera Do'Trakisse") — les exclure
             - EXCLURE absolument tout nom contenant "Do'", "Do ", "Dofus", ainsi que : Prisme, Gardien, Protecteur
             - EXCLURE les monstres, invocations, et PNJ
             - IGNORER : niveaux, XP, kamas, butin, classes, objets, sorts
             - Ne prendre QUE les noms qui apparaissent dans les colonnes GAGNANTS/PERDANTS
             - Si tu vois plus de 5 pseudos dans une equipe, garde uniquement les 5 premiers
             
             Reponds UNIQUEMENT en JSON valide : {"winners": [], "losers": []}` }
        ]);
        
        const text = getResponseText(result);
        const clean = text.replace(/```json\n?|```\n?/g, '').trim();
        console.log('[Gemini] Reponse brute:', clean);
        
        let parsed;
        try {
            parsed = JSON.parse(clean);
        } catch (jsonErr) {
            console.log('[Gemini] JSON invalide, tentative repair...');
            const wSection = clean.match(/"winners"\s*:\s*\[?([\s\S]*?)\s*"losers"/);
            const lSection = clean.match(/"losers"\s*:\s*\[?([\s\S]*?)(\]|})\s*$/);
            const extract = (m) => m ? (m[1].match(/"([^"]+)"/g) || []).map(s => s.replace(/"/g, '')) : [];
            parsed = { winners: extract(wSection), losers: extract(lSection) };
            console.log('[Gemini] Repair result:', JSON.stringify(parsed));
        }

        const excludePattern = /prisme|gardien|protecteur|dofus|\bdo['\s]/i;
        const hasAccents = (str) => str !== str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const isNPC = (n) => excludePattern.test(n) || hasAccents(n) || n.includes(' ');
        if (parsed.winners) parsed.winners = parsed.winners.filter(n => !isNPC(n));
        if (parsed.losers) parsed.losers = parsed.losers.filter(n => !isNPC(n));
        if (parsed.winners && parsed.winners.length > 5) parsed.winners = parsed.winners.slice(0, 5);
        if (parsed.losers && parsed.losers.length > 5) parsed.losers = parsed.losers.slice(0, 5);

        return parsed;
    } catch (error) {
        console.error("Erreur Gemini PvP:", error.message);
        return null;
    }
}

// ============================================
// 2. IA : LECTURE DES PEPITES
// ============================================
async function parseNuggetsWithAI(imageUrl) {
    try {
        const response = await fetch(imageUrl);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');

        const result = await queueGemini([
            { inlineData: { data: base64, mimeType: "image/png" } },
            { text: `Transcris tout le texte visible sur cette image de chat Dofus, mot pour mot.` }
        ]);

        const text = getResponseText(result);
        
        const regex = /et\s*(\d+)\s*ont\s*été\s*ajoutées/i;
        const match = text.match(regex);

        if (match && match[1]) {
            return { alliance_amount: parseInt(match[1]) };
        }
        
        return null;

    } catch (error) { 
        console.error("Erreur Gemini Pepites:", error.message);
        return null; 
    }
}

// ============================================
// 3. SERVEUR WEB (SITE)
// ============================================
const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', __dirname);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'dist'), { index: false }));
app.use(express.static(__dirname, { index: false }));
app.use('/assets', express.static(path.join(__dirname, 'web/assets')));

// --- ADMIN AUTH ---
const adminTokens = new Set();

function adminAuth(req, res, next) {
    const token = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('admin_token='))?.split('=')[1];
    if (token && adminTokens.has(token)) { req.adminAuth = true; return next(); }
    req.adminAuth = false; next();
}

// --- LIVE SETTINGS ---
const liveConfig = {
    pools: JSON.parse(JSON.stringify(config.DEFAULT_POOLS || [
        { id: "pool_1", name: "Pool 1", bonus: 0 },
        { id: "pool_2", name: "Pool 2", bonus: 0 }
    ])),
    season_end_override: null,
    pts_atk_win:  [[2,4,5,5,5],[1,4,5,5,5],[1,2,6,6,6],[1,2,3,8,8],[1,2,3,5,8]],
    pts_atk_lose: [[1,2,3,3,3],[1,2,3,3,3],[0,2,3,3,3],[0,0,3,4,4],[0,0,0,4,5]],
    pts_def_win:  [[2,4,5,5,5],[1,4,5,5,5],[1,2,6,6,6],[1,2,3,8,8],[1,2,3,5,8]],
    pts_def_lose: [[1,2,3,3,3],[1,2,3,3,3],[0,2,3,3,3],[0,0,3,4,4],[0,0,0,4,5]],
    default_winrate_pool: null
};

async function loadSettings() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
        const res = await pool.query('SELECT key, value FROM settings');
        const dbKeys = {};
        for (const row of res.rows) dbKeys[row.key] = row.value;

        if (dbKeys.pools) {
            try { liveConfig.pools = JSON.parse(dbKeys.pools); } catch {}
        } else if (dbKeys.pool_1_name) {
            liveConfig.pools = [
                { id: 'pool_1', name: dbKeys.pool_1_name || 'Pool 1', bonus: parseInt(dbKeys.pool_1_bonus) || 0 },
                { id: 'pool_2', name: dbKeys.pool_2_name || 'Pool 2', bonus: parseInt(dbKeys.pool_2_bonus) || 0 }
            ];
            await saveSetting('pools', JSON.stringify(liveConfig.pools));
            console.log('[Settings] Migration pools ancien format -> nouveau format OK');
        }

        const gridKeys = ['pts_atk_win', 'pts_atk_lose', 'pts_def_win', 'pts_def_lose'];
        for (const gk of gridKeys) {
            if (dbKeys[gk]) {
                try { liveConfig[gk] = JSON.parse(dbKeys[gk]); } catch {}
            }
        }
        if (!dbKeys.pts_atk_win && dbKeys.pts_win) {
            try {
                const oldWin = JSON.parse(dbKeys.pts_win);
                const oldLose = JSON.parse(dbKeys.pts_lose);
                liveConfig.pts_atk_win = oldWin;
                liveConfig.pts_def_win = oldWin;
                liveConfig.pts_atk_lose = oldLose;
                liveConfig.pts_def_lose = oldLose;
                await saveSetting('pts_atk_win', JSON.stringify(oldWin));
                await saveSetting('pts_atk_lose', JSON.stringify(oldLose));
                await saveSetting('pts_def_win', JSON.stringify(oldWin));
                await saveSetting('pts_def_lose', JSON.stringify(oldLose));
                console.log('[Settings] Migration grilles ancien format -> 4 grilles OK');
            } catch {}
        }

        if (dbKeys.season_end_override !== undefined) {
            liveConfig.season_end_override = dbKeys.season_end_override || null;
        }
        if (dbKeys.default_winrate_pool !== undefined) {
            liveConfig.default_winrate_pool = dbKeys.default_winrate_pool || null;
        }

        console.log('[Settings] Charges depuis la DB:', JSON.stringify(liveConfig, null, 2));
    } catch (e) { console.error('[Settings] Fallback config.js:', e.message); }
}

async function saveSetting(key, value) {
    await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, String(value)]);
    if (key === 'pools') {
        try { liveConfig.pools = JSON.parse(value); } catch {}
    } else if (key === 'scoring') {
        // legacy, ignore
    } else if (key.startsWith('pts_')) {
        try { liveConfig[key] = JSON.parse(value); } catch {}
    } else if (key === 'season_end_override') {
        liveConfig[key] = value || null;
    } else {
        liveConfig[key] = value;
    }
}

loadSettings();

function getSeasons() {
    const INITIAL_DATE = new Date('2026-02-01T00:00:00'); 
    const DAYS_PER_SEASON = 14;
    const now = new Date();
    const seasons = [];
    let loopDate = new Date(INITIAL_DATE);
    let id = 1;
    let currentSeasonId = 1;
    let overrideApplied = false;

    while (true) {
        const start = new Date(loopDate);
        if (start > now) break;
        let end = new Date(start);
        end.setDate(end.getDate() + DAYS_PER_SEASON);
        end.setMilliseconds(-1); 

        if (!overrideApplied && liveConfig.season_end_override) {
            const ov = new Date(liveConfig.season_end_override);
            ov.setHours(23, 59, 59, 999);
            if (now >= start && now <= ov) {
                end = ov;
                overrideApplied = true;
            }
        }

        const isCurrent = (now >= start && now <= end);
        if (isCurrent) currentSeasonId = id;

        const startStr = start.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
        const endStr = end.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
        const endRaw = end.toISOString().split('T')[0];
        seasons.push({ id, label: `Saison ${id} (${startStr} - ${endStr})`, start, end, endRaw, isCurrent });
        
        loopDate = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
        id++;
        if (id > 1000) break;
    }
    if (seasons.length === 0) {
        const end = new Date(INITIAL_DATE);
        end.setDate(end.getDate() + DAYS_PER_SEASON);
        seasons.push({ id: 1, label: `Saison 1 (Bientot)`, start: INITIAL_DATE, end, endRaw: end.toISOString().split('T')[0], isCurrent: true });
    }
    return { seasons, currentSeason: currentSeasonId };
}

async function getLeaderboardPlayers(seasonId) {
    const result = await pool.query(`
        SELECT 
            COALESCE(MAX(p.discord_nickname), MAX(p.discord_username), MAX(p.dofus_pseudo)) as dofus_pseudo,
            MAX(p.avatar_url) as avatar_url,
            SUM(ss.points) as total_points,
            SUM(ss.wins) as wins,
            SUM(ss.losses) as losses,
            MIN(ss.previous_rank) as previous_rank
        FROM players p
        JOIN season_stats ss ON ss.player_id = p.id
        WHERE ss.season_id = $1
        GROUP BY COALESCE(p.discord_id, p.dofus_pseudo)
        HAVING SUM(ss.wins) + SUM(ss.losses) > 0
        ORDER BY total_points DESC
    `, [seasonId]);

    const poolId = liveConfig.default_winrate_pool;
    let poolWinrateMap = {};
    if (poolId) {
        const pw = await pool.query(`
            SELECT
                COALESCE(MAX(p.discord_nickname), MAX(p.discord_username), MAX(p.dofus_pseudo)) as display_name,
                SUM(CASE WHEN m.has_won = true AND mp.is_winner = true AND NOT COALESCE(m.cancelled, false) THEN 1 ELSE 0 END) as pool_wins,
                SUM(CASE WHEN m.has_won = false AND mp.is_winner = false AND NOT COALESCE(m.cancelled, false) THEN 1 ELSE 0 END) as pool_losses
            FROM players p
            JOIN match_participants mp ON mp.player_id = p.id
            JOIN matches m ON m.id = mp.match_id
            WHERE m.season_id = $1 AND m.alliance_tier = $2
            AND NOT COALESCE(m.cancelled, false)
            AND (SELECT COUNT(*) FROM match_participants mp3 WHERE mp3.match_id = m.id AND mp3.is_winner = true) = 5
            AND (SELECT COUNT(*) FROM match_participants mp4 WHERE mp4.match_id = m.id AND mp4.is_winner = false) = 5
            GROUP BY COALESCE(p.discord_id, p.dofus_pseudo::text)
        `, [seasonId, poolId]);
        for (const row of pw.rows) {
            const w = Number(row.pool_wins) || 0;
            const l = Number(row.pool_losses) || 0;
            const t = w + l;
            poolWinrateMap[row.display_name] = t > 0 ? Math.round(w / t * 100) : null;
            poolWinrateMap[row.display_name + '_w'] = w;
            poolWinrateMap[row.display_name + '_l'] = l;
        }
    }

    return result.rows.map((p, index) => {
        const wins = Number(p.wins) || 0;
        const losses = Number(p.losses) || 0;
        const totalGames = wins + losses;
        const prevRank = p.previous_rank ? Number(p.previous_rank) : null;
        let rankChange = 0;
        if (prevRank !== null) rankChange = prevRank - (index + 1);
        const hasPoolData = poolId && poolWinrateMap[p.dofus_pseudo] !== null && poolWinrateMap[p.dofus_pseudo] !== undefined;
        const winrate = hasPoolData
            ? poolWinrateMap[p.dofus_pseudo]
            : totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;
        const displayWins = hasPoolData ? poolWinrateMap[p.dofus_pseudo + '_w'] : wins;
        const displayLosses = hasPoolData ? poolWinrateMap[p.dofus_pseudo + '_l'] : losses;
        return {
            dofus_pseudo: p.dofus_pseudo,
            avatar_url: p.avatar_url || null,
            total_points: parseInt(p.total_points),
            wins: displayWins, losses: displayLosses, winrate, rank_change: rankChange
        };
    });
}

app.get('/api/seasons', (req, res) => {
    try {
        const { seasons, currentSeason } = getSeasons();
        res.json({ seasons, currentSeason });
    } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

app.get('/api/config', (req, res) => {
    res.json({ pools: liveConfig.pools, defaultWinratePool: liveConfig.default_winrate_pool });
});

app.get('/api/season-info/:seasonId', async (req, res) => {
    try {
        const seasonId = req.params.seasonId;
        const countRes = await pool.query(
            'SELECT COUNT(*) as c FROM matches WHERE season_id = $1 AND NOT COALESCE(cancelled, false)',
            [seasonId]
        );
        res.json({ totalCombats: parseInt(countRes.rows[0].c) });
    } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.get('/dev', async (req, res) => {
    try {
        const { seasons, currentSeason } = getSeasons();
        const seasonId = await ensureCurrentSeason();
        const query = `
            SELECT 
                COALESCE(MAX(p.discord_nickname), MAX(p.discord_username), MAX(p.dofus_pseudo)) as display_name,
                MAX(p.avatar_url) as avatar_url,
                SUM(ss.points) as total_points, SUM(ss.wins) as wins, SUM(ss.losses) as losses,
                MIN(ss.previous_rank) as previous_rank
            FROM players p
            JOIN season_stats ss ON ss.player_id = p.id
            WHERE ss.season_id = $1
            GROUP BY COALESCE(p.discord_id, p.dofus_pseudo)
            HAVING SUM(ss.wins) + SUM(ss.losses) > 0
            ORDER BY total_points DESC
        `;
        const result = await pool.query(query, [seasonId]);
        const players = result.rows.map((p, index) => {
            const wins = Number(p.wins) || 0;
            const losses = Number(p.losses) || 0;
            const totalGames = wins + losses;
            const currentRank = index + 1;
            const prevRank = p.previous_rank ? Number(p.previous_rank) : null;
            let rankChange = 0;
            if (prevRank !== null) rankChange = prevRank - currentRank;
            return { dofus_pseudo: p.display_name, avatar_url: p.avatar_url || null, total_points: parseInt(p.total_points), wins, losses, winrate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0, rank_change: rankChange };
        });
        const countRes = await pool.query('SELECT COUNT(*) as c FROM matches WHERE season_id = $1', [seasonId]);
        res.render('dev', { players, seasons, currentSeason, totalCombats: parseInt(countRes.rows[0].c) });
    } catch (error) { console.error(error); res.status(500).send('Erreur serveur'); }
});

app.get('/api/leaderboard/:seasonId', async (req, res) => {
    try {
        const seasonId = req.params.seasonId;
        const players = await getLeaderboardPlayers(seasonId);
        res.json(players);
    } catch (error) { console.error(error); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.get('/api/matches/:seasonId', async (req, res) => {
    try {
        const seasonId = req.params.seasonId;
        const limit = Math.min(parseInt(req.query.limit) || 20, 50);
        const matchesRes = await pool.query(`
            SELECT m.id, m.alliance_tier, m.points_awarded, m.context, m.has_won, m.created_at,
                   json_agg(json_build_object(
                       'name', COALESCE(p.discord_nickname, p.dofus_pseudo),
                       'is_winner', mp.is_winner
                   )) as participants
            FROM matches m
            LEFT JOIN match_participants mp ON mp.match_id = m.id
            LEFT JOIN players p ON p.id = mp.player_id
            WHERE m.season_id = $1
            GROUP BY m.id
            ORDER BY m.created_at DESC NULLS LAST, m.id DESC
            LIMIT $2
        `, [seasonId, limit]);

        const matches = matchesRes.rows.map(m => {
            const poolObj = liveConfig.pools.find(p => p.id === m.alliance_tier);
            return {
                id: m.id,
                alliance: poolObj ? poolObj.name : m.alliance_tier,
                points: m.points_awarded,
                context: m.context || 'attack',
                has_won: m.has_won !== false,
                created_at: m.created_at,
                winners: (m.participants || []).filter(p => p.is_winner).map(p => p.name),
                losers: (m.participants || []).filter(p => !p.is_winner).map(p => p.name)
            };
        });
        res.json(matches);
    } catch (error) { console.error(error); res.status(500).json({ error: 'Erreur serveur' }); }
});

app.get('/api/stats/:seasonId', async (req, res) => {
    try {
        const seasonId = req.params.seasonId;

        const poolStats = await pool.query(`
            SELECT 
                m.alliance_tier,
                COUNT(*) as total,
                SUM(CASE WHEN m.has_won = true THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN m.has_won = false THEN 1 ELSE 0 END) as losses,
                SUM(m.points_awarded) as total_points,
                SUM(CASE WHEN m.context = 'attack' THEN 1 ELSE 0 END) as attacks,
                SUM(CASE WHEN m.context = 'defense' THEN 1 ELSE 0 END) as defenses,
                SUM(CASE WHEN m.context = 'attack' AND m.has_won = true THEN 1 ELSE 0 END) as atk_wins,
                SUM(CASE WHEN m.context = 'defense' AND m.has_won = true THEN 1 ELSE 0 END) as def_wins
            FROM matches m
            WHERE m.season_id = $1
            GROUP BY m.alliance_tier
        `, [seasonId]);

        const topPlayers = await pool.query(`
            SELECT 
                m.alliance_tier,
                COALESCE(p.discord_nickname, p.dofus_pseudo) as name,
                COUNT(*) as wins
            FROM matches m
            JOIN match_participants mp ON mp.match_id = m.id
            JOIN players p ON p.id = mp.player_id
            WHERE m.season_id = $1 AND mp.is_winner = true AND m.has_won = true
            GROUP BY m.alliance_tier, COALESCE(p.discord_nickname, p.dofus_pseudo)
            ORDER BY m.alliance_tier, wins DESC
        `, [seasonId]);

        const hourly = await pool.query(`
            SELECT EXTRACT(HOUR FROM m.created_at) as hour, COUNT(*) as count
            FROM matches m
            WHERE m.season_id = $1 AND m.created_at IS NOT NULL
            GROUP BY hour ORDER BY hour
        `, [seasonId]);

        const poolMap = {};
        for (const row of poolStats.rows) {
            const poolObj = liveConfig.pools.find(p => p.id === row.alliance_tier);
            const key = row.alliance_tier;
            poolMap[key] = {
                name: poolObj ? poolObj.name : key,
                total: parseInt(row.total),
                wins: parseInt(row.wins),
                losses: parseInt(row.losses),
                winrate: parseInt(row.total) > 0 ? Math.round(parseInt(row.wins) / parseInt(row.total) * 100) : 0,
                total_points: parseInt(row.total_points),
                attacks: parseInt(row.attacks),
                defenses: parseInt(row.defenses),
                atk_winrate: parseInt(row.attacks) > 0 ? Math.round(parseInt(row.atk_wins) / parseInt(row.attacks) * 100) : 0,
                def_winrate: parseInt(row.defenses) > 0 ? Math.round(parseInt(row.def_wins) / parseInt(row.defenses) * 100) : 0,
                top_players: []
            };
        }
        for (const row of topPlayers.rows) {
            if (poolMap[row.alliance_tier] && poolMap[row.alliance_tier].top_players.length < 3) {
                poolMap[row.alliance_tier].top_players.push({ name: row.name, wins: parseInt(row.wins) });
            }
        }

        const hours = Array(24).fill(0);
        for (const row of hourly.rows) { if (row.hour !== null) hours[parseInt(row.hour)] = parseInt(row.count); }

        res.json({
            pools: Object.values(poolMap).filter(p => liveConfig.pools.some(lp => lp.name === p.name)),
            hours
        });
    } catch (error) { console.error(error); res.status(500).json({ error: 'Erreur serveur' }); }
});

// ============================================
// 3b. ROUTES ADMIN
// ============================================
app.get('/admin', adminAuth, async (req, res) => {
    if (!req.adminAuth) return res.render('admin', { authenticated: false, error: null });
    try {
        const { seasons, currentSeason } = getSeasons();
        const curSeason = seasons.find(s => s.id === currentSeason);
        const seasonId = await ensureCurrentSeason();

        const nuggetsRes = await pool.query(`
            SELECT 
                COALESCE(MAX(p.discord_nickname), MAX(p.dofus_pseudo)) as name, 
                SUM(ss.nuggets) as nuggets 
            FROM season_stats ss
            JOIN players p ON p.id = ss.player_id
            WHERE ss.season_id = $1 AND ss.nuggets > 0 
            GROUP BY COALESCE(p.discord_id, p.dofus_pseudo)
            ORDER BY nuggets DESC
        `, [seasonId]);

        res.render('admin', { 
            authenticated: true, error: null,
            settings: liveConfig,
            pools: liveConfig.pools,
            maxPools: config.MAX_POOLS || 5,
            nuggets: nuggetsRes.rows,
            seasons,
            currentSeason,
            curSeason,
            ptsAtkWin: liveConfig.pts_atk_win,
            ptsAtkLose: liveConfig.pts_atk_lose,
            ptsDefWin: liveConfig.pts_def_win,
            ptsDefLose: liveConfig.pts_def_lose,
            defaultWinratePool: liveConfig.default_winrate_pool
        });
    } catch (e) { 
        console.error(e);
        const { seasons, currentSeason } = getSeasons();
        const curSeason = seasons.find(s => s.id === currentSeason);
        res.render('admin', { authenticated: true, error: null, settings: liveConfig, pools: liveConfig.pools, maxPools: config.MAX_POOLS || 5, nuggets: [], seasons, currentSeason, curSeason, ptsAtkWin: liveConfig.pts_atk_win, ptsAtkLose: liveConfig.pts_atk_lose, ptsDefWin: liveConfig.pts_def_win, ptsDefLose: liveConfig.pts_def_lose });
    }
});

// --- ADMIN RATE LIMIT ---
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function checkRateLimit(ip) {
    const entry = loginAttempts.get(ip);
    if (!entry) return true;
    if (Date.now() - entry.first > LOCKOUT_MS) { loginAttempts.delete(ip); return true; }
    return entry.count < MAX_ATTEMPTS;
}

function recordFailedLogin(ip) {
    const entry = loginAttempts.get(ip);
    if (!entry) { loginAttempts.set(ip, { count: 1, first: Date.now() }); return; }
    entry.count++;
}

app.post('/admin/login', (req, res) => {
    const ip = req.ip;
    if (!checkRateLimit(ip)) {
        return res.render('admin', { authenticated: false, error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
    }
    const pwd = req.body.password;
    if (pwd === process.env.ADMIN_PASSWORD) {
        loginAttempts.delete(ip);
        const token = crypto.randomBytes(32).toString('hex');
        adminTokens.add(token);
        res.setHeader('Set-Cookie', `admin_token=${token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=86400`);
        return res.redirect('/admin');
    }
    recordFailedLogin(ip);
    res.render('admin', { authenticated: false, error: 'Mot de passe incorrect.' });
});

app.post('/admin/logout', (req, res) => {
    const token = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('admin_token='))?.split('=')[1];
    if (token) adminTokens.delete(token);
    res.setHeader('Set-Cookie', 'admin_token=; Path=/admin; Max-Age=0');
    res.redirect('/admin');
});

app.post('/admin/api/pools', adminAuth, async (req, res) => {
    if (!req.adminAuth) return res.status(401).json({ error: 'Non autorisé.' });
    try {
        const { pools: newPools } = req.body;
        if (!Array.isArray(newPools)) return res.status(400).json({ error: 'Format invalide.' });
        if (newPools.length > (config.MAX_POOLS || 5)) return res.status(400).json({ error: `Maximum ${config.MAX_POOLS || 5} pools.` });
        for (const p of newPools) {
            if (!p.id || !p.name || typeof p.bonus !== 'number') return res.status(400).json({ error: 'Pool invalide.' });
        }
        await saveSetting('pools', JSON.stringify(newPools));
        res.json({ ok: true, pools: liveConfig.pools });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur.' }); }
});

app.get('/admin/api/players', adminAuth, async (req, res) => {
    if (!req.adminAuth) return res.status(401).json([]);
    try {
        const seasonId = await ensureCurrentSeason();
        const r = await pool.query(`
            SELECT DISTINCT COALESCE(p.discord_nickname, p.dofus_pseudo) as name
            FROM players p
            JOIN season_stats ss ON ss.player_id = p.id
            WHERE ss.season_id = $1
            AND (ss.wins + ss.losses) > 0
            ORDER BY name
        `, [seasonId]);
        res.json(r.rows.map(p => p.name));
    } catch { res.json([]); }
});

app.get('/admin/api/player-stats/:pseudo', adminAuth, async (req, res) => {
    if (!req.adminAuth) return res.status(401).json({ error: 'Non autorisé.' });
    try {
        const pseudo = req.params.pseudo;
        const seasonId = await ensureCurrentSeason();
        const r = await pool.query(`
            SELECT COALESCE(SUM(ss.points), 0) as points
            FROM players p
            LEFT JOIN season_stats ss ON ss.player_id = p.id AND ss.season_id = $2
            WHERE LOWER(COALESCE(p.discord_nickname, p.dofus_pseudo)) = LOWER($1)
        `, [pseudo, seasonId]);
        res.json({ points: parseInt(r.rows[0]?.points) || 0 });
    } catch { res.json({ points: 0 }); }
});

app.post('/admin/api/player-points', adminAuth, async (req, res) => {
    if (!req.adminAuth) return res.status(401).json({ error: 'Non autorisé.' });
    try {
        const { pseudo, points } = req.body;
        const pts = parseInt(points);
        if (!pseudo || isNaN(pts)) return res.status(400).json({ error: 'Pseudo ou points invalides.' });

        const playerRes = await pool.query(`
            SELECT id, COALESCE(discord_nickname, dofus_pseudo) as name 
            FROM players WHERE LOWER(COALESCE(discord_nickname, dofus_pseudo)) = LOWER($1)
        `, [pseudo]);
        if (playerRes.rows.length === 0) return res.status(404).json({ error: 'Joueur introuvable.' });

        const playerId = playerRes.rows[0].id;
        const playerName = playerRes.rows[0].name;
        const seasonId = await ensureCurrentSeason();

        await updateSeasonStats(playerId, seasonId, { points: pts, wins: 0, losses: 0 });

        const totalRes = await pool.query('SELECT SUM(points) as total FROM season_stats WHERE player_id = $1 AND season_id = $2', [playerId, seasonId]);
        const newTotal = parseInt(totalRes.rows[0].total) || 0;

        res.json({ ok: true, pseudo: playerName, delta: pts, newTotal });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur.' }); }
});

app.get('/admin/api/nuggets/:seasonId', adminAuth, async (req, res) => {
    if (!req.adminAuth) return res.status(401).json([]);
    try {
        const seasonId = parseInt(req.params.seasonId);
        const r = await pool.query(`
            SELECT 
                COALESCE(MAX(p.discord_nickname), MAX(p.dofus_pseudo)) as name, 
                SUM(ss.nuggets) as nuggets 
            FROM season_stats ss
            JOIN players p ON p.id = ss.player_id
            WHERE ss.season_id = $1 AND ss.nuggets > 0 
            GROUP BY COALESCE(p.discord_id, p.dofus_pseudo)
            ORDER BY nuggets DESC
        `, [seasonId]);
        res.json(r.rows);
    } catch (e) { console.error(e); res.json([]); }
});

app.post('/admin/api/reset-nuggets', adminAuth, async (req, res) => {
    if (!req.adminAuth) return res.status(401).json({ error: 'Non autorisé.' });
    try {
        const seasonId = await ensureCurrentSeason();
        await pool.query('UPDATE season_stats SET nuggets = 0 WHERE season_id = $1 AND nuggets > 0', [seasonId]);
        res.json({ ok: true, seasonId });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur.' }); }
});

app.post('/admin/api/season-end', adminAuth, async (req, res) => {
    if (!req.adminAuth) return res.status(401).json({ error: 'Non autorisé.' });
    try {
        const { end_date } = req.body;
        if (!end_date) {
            liveConfig.season_end_override = null;
            await saveSetting('season_end_override', '');
            return res.json({ ok: true, cleared: true });
        }
        const d = new Date(end_date);
        if (isNaN(d.getTime())) return res.status(400).json({ error: 'Date invalide.' });
        
        liveConfig.season_end_override = end_date;
        await saveSetting('season_end_override', end_date);
        
        const { seasons, currentSeason } = getSeasons();
        const curSeason = seasons.find(s => s.id === currentSeason);
        
        if (curSeason) {
            await pool.query('UPDATE seasons SET end_date = $1 WHERE id = $2', [curSeason.end, curSeason.id]);
        }
        
        res.json({ ok: true, curSeason });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur.' }); }
});

app.post('/admin/api/points-grid', adminAuth, async (req, res) => {
    if (!req.adminAuth) return res.status(401).json({ error: 'Non autorisé.' });
    try {
        const { pts_atk_win, pts_atk_lose, pts_def_win, pts_def_lose } = req.body;
        for (const [name, grid] of Object.entries({ pts_atk_win, pts_atk_lose, pts_def_win, pts_def_lose })) {
            if (!Array.isArray(grid) || grid.length !== 5) return res.status(400).json({ error: `Grille ${name} invalide (5 lignes attendues).` });
            for (const row of grid) {
                if (!Array.isArray(row) || row.length !== 5) return res.status(400).json({ error: `Grille ${name} invalide (5 colonnes attendues).` });
                if (row.some(v => typeof v !== 'number' || isNaN(v))) return res.status(400).json({ error: `Valeurs invalides dans ${name}.` });
            }
        }
        await saveSetting('pts_atk_win', JSON.stringify(pts_atk_win));
        await saveSetting('pts_atk_lose', JSON.stringify(pts_atk_lose));
        await saveSetting('pts_def_win', JSON.stringify(pts_def_win));
        await saveSetting('pts_def_lose', JSON.stringify(pts_def_lose));
        res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur.' }); }
});

app.get('/admin/api/multi-accounts', adminAuth, async (req, res) => {
    if (!req.adminAuth) return res.status(401).json([]);
    try {
        const r = await pool.query(`
            SELECT 
                array_agg(DISTINCT p.dofus_pseudo ORDER BY p.dofus_pseudo) as pseudos,
                COUNT(*) as count
            FROM players p
            WHERE p.discord_id IS NOT NULL
            GROUP BY p.discord_id
            HAVING COUNT(*) > 1
            ORDER BY count DESC
        `);
        res.json(r.rows);
    } catch { res.json([]); }
});

// Historique matchs d'un joueur (25 derniers)
app.get('/admin/api/player-matches/:pseudo', adminAuth, async (req, res) => {
    if (!req.adminAuth) return res.status(401).json([]);
    try {
        const pseudo = req.params.pseudo;
        const seasonId = await ensureCurrentSeason();
        const r = await pool.query(`
            SELECT m.id, m.alliance_tier, m.points_awarded, m.context, m.has_won, m.created_at, m.cancelled,
                (SELECT json_agg(json_build_object('name', COALESCE(p2.discord_nickname, p2.dofus_pseudo), 'is_winner', mp2.is_winner))
                 FROM match_participants mp2 JOIN players p2 ON p2.id = mp2.player_id WHERE mp2.match_id = m.id) as participants
            FROM matches m
            WHERE m.season_id = $1
            AND m.id IN (
                SELECT DISTINCT match_id FROM match_participants mp
                JOIN players p ON p.id = mp.player_id
                WHERE LOWER(COALESCE(p.discord_nickname, p.dofus_pseudo)) = LOWER($2)
            )
            ORDER BY m.created_at DESC NULLS LAST, m.id DESC
            LIMIT 25
        `, [seasonId, pseudo]);
        const matches = r.rows.map(m => {
            const poolObj = liveConfig.pools.find(p => p.id === m.alliance_tier);
            return {
                id: m.id, alliance: poolObj ? poolObj.name : m.alliance_tier,
                points_awarded: m.points_awarded, context: m.context,
                has_won: m.has_won !== false, created_at: m.created_at, cancelled: m.cancelled || false,
                winners: (m.participants||[]).filter(p => p.is_winner).map(p => p.name),
                losers: (m.participants||[]).filter(p => !p.is_winner).map(p => p.name)
            };
        });
        res.json(matches);
    } catch (e) { console.error(e); res.json([]); }
});

// 25 derniers matchs globaux
app.get('/admin/api/recent-matches', adminAuth, async (req, res) => {
    if (!req.adminAuth) return res.status(401).json([]);
    try {
        const seasonId = await ensureCurrentSeason();
        const r = await pool.query(`
            SELECT m.id, m.alliance_tier, m.points_awarded, m.context, m.has_won, m.created_at, m.cancelled,
                json_agg(json_build_object('name', COALESCE(p.discord_nickname, p.dofus_pseudo), 'is_winner', mp.is_winner)) as participants
            FROM matches m
            LEFT JOIN match_participants mp ON mp.match_id = m.id
            LEFT JOIN players p ON p.id = mp.player_id
            WHERE m.season_id = $1
            GROUP BY m.id
            ORDER BY m.created_at DESC NULLS LAST, m.id DESC
            LIMIT 25
        `, [seasonId]);
        const matches = r.rows.map(m => {
            const poolObj = liveConfig.pools.find(p => p.id === m.alliance_tier);
            return {
                id: m.id, alliance: poolObj ? poolObj.name : m.alliance_tier,
                points_awarded: m.points_awarded, context: m.context,
                has_won: m.has_won !== false, created_at: m.created_at, cancelled: m.cancelled || false,
                winners: (m.participants||[]).filter(p => p.is_winner).map(p => p.name),
                losers: (m.participants||[]).filter(p => !p.is_winner).map(p => p.name)
            };
        });
        res.json(matches);
    } catch (e) { console.error(e); res.json([]); }
});

// Modifier les points d'un match
app.patch('/admin/api/match/:id/points', adminAuth, async (req, res) => {
    if (!req.adminAuth) return res.status(401).json({ error: 'Non autorisé.' });
    try {
        const matchId = parseInt(req.params.id);
        const newPts = parseInt(req.body.points);
        if (isNaN(matchId) || isNaN(newPts)) return res.status(400).json({ error: 'Paramètres invalides.' });

        const matchRes = await pool.query('SELECT * FROM matches WHERE id = $1', [matchId]);
        if (matchRes.rows.length === 0) return res.status(404).json({ error: 'Match introuvable.' });
        const match = matchRes.rows[0];
        if (match.cancelled) return res.status(400).json({ error: 'Match annulé, impossible de modifier.' });

        const delta = newPts - match.points_awarded;
        const isWin = match.has_won;

        const allyRows = await pool.query(
            'SELECT mp.player_id FROM match_participants mp WHERE mp.match_id = $1 AND mp.is_winner = $2',
            [matchId, isWin]
        );
        for (const row of allyRows.rows) {
            await pool.query(
                'UPDATE season_stats SET points = points + $1 WHERE player_id = $2 AND season_id = $3',
                [delta, row.player_id, match.season_id]
            );
        }
        await pool.query('UPDATE matches SET points_awarded = $1 WHERE id = $2', [newPts, matchId]);
        res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur.' }); }
});

// Annuler un match
app.delete('/admin/api/match/:id', adminAuth, async (req, res) => {
    if (!req.adminAuth) return res.status(401).json({ error: 'Non autorisé.' });
    try {
        const matchId = parseInt(req.params.id);
        if (isNaN(matchId)) return res.status(400).json({ error: 'ID invalide.' });

        const matchRes = await pool.query('SELECT * FROM matches WHERE id = $1', [matchId]);
        if (matchRes.rows.length === 0) return res.status(404).json({ error: 'Match introuvable.' });
        const match = matchRes.rows[0];
        if (match.cancelled) return res.status(400).json({ error: 'Match déjà annulé.' });

        const pts = match.points_awarded;
        const isWin = match.has_won;

        const allyRows = await pool.query(
            'SELECT mp.player_id FROM match_participants mp WHERE mp.match_id = $1 AND mp.is_winner = $2',
            [matchId, isWin]
        );
        for (const row of allyRows.rows) {
            await pool.query(`
                UPDATE season_stats SET
                    points = GREATEST(0, points - $1),
                    wins = GREATEST(0, wins - $2),
                    losses = GREATEST(0, losses - $3)
                WHERE player_id = $4 AND season_id = $5
            `, [pts, isWin ? 1 : 0, isWin ? 0 : 1, row.player_id, match.season_id]);
        }
        await pool.query('UPDATE matches SET cancelled = true, points_awarded = 0 WHERE id = $1', [matchId]);
        res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur.' }); }
});


// Sauvegarder le pool de winrate par défaut
app.post('/admin/api/default-winrate-pool', adminAuth, async (req, res) => {
    if (!req.adminAuth) return res.status(401).json({ error: 'Non autorisé.' });
    try {
        const { pool_id } = req.body;
        liveConfig.default_winrate_pool = pool_id || null;
        await saveSetting('default_winrate_pool', pool_id || '');
        res.json({ ok: true, pool_id: liveConfig.default_winrate_pool });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur.' }); }
});

app.listen(config.WEB_PORT, () => { console.log(`Web server running on port ${config.WEB_PORT}`); });

// ============================================
// 4. BOT DISCORD
// ============================================
client.once(Events.ClientReady, async () => { 
    console.log(`Bot Connecte : ${client.user.tag}`);
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS nuggets (id SERIAL PRIMARY KEY, discord_id TEXT, amount INT, image_hash TEXT, created_at TIMESTAMP DEFAULT NOW())`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS bank_nuggets INTEGER DEFAULT 0`);
        await pool.query(`ALTER TABLE season_stats ADD COLUMN IF NOT EXISTS previous_rank INTEGER DEFAULT NULL`);
        await pool.query(`ALTER TABLE season_stats ADD COLUMN IF NOT EXISTS nuggets INTEGER DEFAULT 0`);
        await pool.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
        await pool.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS context TEXT DEFAULT 'attack'`);
        await pool.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS has_won BOOLEAN DEFAULT true`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL`);
        await pool.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS cancelled BOOLEAN DEFAULT false`);
        
        const migCheck = await pool.query("SELECT value FROM settings WHERE key = 'nuggets_migrated'");
        if (migCheck.rows.length === 0) {
            console.log('[Migration] Report bank_nuggets vers season_stats...');
            const playersWithNuggets = await pool.query('SELECT id, bank_nuggets FROM players WHERE bank_nuggets > 0');
            if (playersWithNuggets.rows.length > 0) {
                const seasonId = await ensureCurrentSeason();
                for (const p of playersWithNuggets.rows) {
                    await pool.query(`
                        INSERT INTO season_stats (player_id, season_id, points, wins, losses, nuggets) 
                        VALUES ($1, $2, 0, 0, 0, $3)
                        ON CONFLICT (player_id, season_id) DO UPDATE SET nuggets = season_stats.nuggets + $3
                    `, [p.id, seasonId, p.bank_nuggets]);
                }
                console.log(`[Migration] ${playersWithNuggets.rows.length} joueurs migrés.`);
            }
            await pool.query("INSERT INTO settings (key, value) VALUES ('nuggets_migrated', '1') ON CONFLICT (key) DO NOTHING");
        }
        
        console.log('[Startup] DB verifiee.');
    } catch (e) { console.error(e); }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.channel.id === config.CHANNEL_ID) {
        try {
            const rawNickname = message.member ? message.member.displayName : message.author.username;
            const cleanNickname = removeAccents(rawNickname);
            const avatarUrl = message.author.displayAvatarURL({ size: 128, format: 'webp' });
            await pool.query('UPDATE players SET discord_nickname = $1, avatar_url = $2 WHERE discord_id = $3', [cleanNickname, avatarUrl, message.author.id]);
        } catch (e) {}
    }

    if (message.content.startsWith('!addplayer') && message.member.permissions.has('Administrator')) {
        const args = message.content.split(' ');
        if (args.length < 2) return message.reply("Usage : `!addplayer <PseudoExact>`");
        try {
            const cleanArg = removeAccents(args[1]);
            await pool.query('INSERT INTO players (dofus_pseudo) VALUES ($1) ON CONFLICT (dofus_pseudo) DO NOTHING', [cleanArg]);
            return message.reply(`[OK] Joueur ${cleanArg} ajouté.`);
        } catch (err) { return message.reply("Erreur d'ajout."); }
    }

    if (message.content.startsWith('!deleteplayer') && (message.member.permissions.has('Administrator') || message.author.id === config.OWNER_ID || message.author.username.toLowerCase() === 'sino299')) {
        const args = message.content.split(' ');
        if (args.length < 2) return message.reply("Usage : `!deleteplayer <PseudoExact>`");
        try {
            const cleanArg = removeAccents(args[1]);
            const found = await pool.query('SELECT id FROM players WHERE LOWER(dofus_pseudo) = LOWER($1)', [cleanArg]);
            if (found.rows.length === 0) return message.reply(`Joueur "${cleanArg}" introuvable.`);
            const playerId = found.rows[0].id;
            await pool.query('DELETE FROM match_participants WHERE player_id = $1', [playerId]);
            await pool.query('DELETE FROM season_stats WHERE player_id = $1', [playerId]);
            await pool.query('DELETE FROM players WHERE id = $1', [playerId]);
            return message.reply(`[OK] Joueur ${cleanArg} supprimé.`);
        } catch (err) { console.error(err); return message.reply("Erreur suppression."); }
    }

    if (message.content === '!pepites') {
        if (!hasStaffRole(message.member)) return message.reply("[REFUS] Cette commande est réservée au STAFF.");
        try {
            const seasonId = await ensureCurrentSeason();
            const res = await pool.query(`
                SELECT 
                    COALESCE(MAX(p.discord_nickname), MAX(p.dofus_pseudo)) as name, 
                    SUM(ss.nuggets) as nuggets 
                FROM season_stats ss
                JOIN players p ON p.id = ss.player_id
                WHERE ss.season_id = $1 AND ss.nuggets > 0 
                GROUP BY COALESCE(p.discord_id, p.dofus_pseudo)
                ORDER BY nuggets DESC 
            `, [seasonId]);
            if (res.rows.length === 0) return message.reply("Aucune pépite en banque pour cette saison.");
            const lines = res.rows.map((p, i) => `${i + 1}. **${p.name}** : ${p.nuggets}`);
            const embed = new EmbedBuilder()
                .setTitle('Banque des Pépites (Alliance)')
                .setColor(0xFFD700)
                .setDescription(lines.slice(0, 20).join('\n'))
                .setFooter({ text: `Total accumulé - Top 20 sur ${res.rows.length} comptes` });
            return message.reply({ embeds: [embed] });
        } catch (e) { console.error(e); return message.reply("Erreur récupération pépites."); }
    }

    if (message.content === '!resetpepites') {
        if (!hasStaffRole(message.member)) return message.reply("[REFUS] Cette commande est réservée au STAFF.");
        try {
            const seasonId = await ensureCurrentSeason();
            await pool.query('UPDATE season_stats SET nuggets = 0 WHERE season_id = $1 AND nuggets > 0', [seasonId]);
            return message.reply(`[OK] Pépites remises à zéro pour la saison ${seasonId}.`);
        } catch (e) { console.error(e); return message.reply("Erreur reset pépites."); }
    }

    if (message.content === '!setup_profile' && message.member.permissions.has('Administrator')) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_link_char').setLabel('Lier un Personnage').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('btn_unlink_char').setLabel('Délier un Personnage').setStyle(ButtonStyle.Danger)
        );
        const embed = new EmbedBuilder().setTitle('Gestion de vos Personnages').setDescription("Liez vos personnages Dofus à votre compte Discord !").setColor(0x00FF00);
        const ch = await client.channels.fetch(config.PROFILE_CHANNEL_ID);
        if(ch) ch.send({ embeds: [embed], components: [row] });
    }

    // --- LOGIQUE PEPITES ---
    if (config.NUGGETS_CHANNEL_ID && message.channel.id === config.NUGGETS_CHANNEL_ID) {
        console.log('[Pepites] Upload detecté de', message.author.username);
        const attachments = message.attachments.filter(a => a.contentType && a.contentType.startsWith('image/'));
        if (attachments.size === 0) return;
        const msgRef = await message.reply('Analyse pépites...');
        try {
            for (const [id, attachment] of attachments) {
                const imgResponse = await fetch(attachment.url);
                const imgBuffer = await imgResponse.arrayBuffer();
                const imageHash = crypto.createHash('sha256').update(Buffer.from(imgBuffer)).digest('hex');
                
                const dup = await pool.query('SELECT id FROM nuggets WHERE image_hash = $1', [imageHash]);
                if (dup.rows.length > 0) { await msgRef.edit('Image déjà traitée.'); return; }

                const parsed = await parseNuggetsWithAI(attachment.url);
                if (!parsed || !parsed.alliance_amount) { await msgRef.edit('Montant introuvable.'); return; }

                const playerShare = Math.floor(parsed.alliance_amount * 0.5);
                const mentionedMember = message.mentions.members?.first();
                const recipientId = mentionedMember ? mentionedMember.id : message.author.id;
                const recipientName = mentionedMember ? mentionedMember.displayName : (message.member?.displayName || message.author.username);
                const displayName = recipientName.toLowerCase() === 'duma' ? 'Gros orteils' : recipientName;
                
                let playerRes = await pool.query('SELECT id FROM players WHERE discord_id = $1 LIMIT 1', [recipientId]);
                if (playerRes.rows.length === 0) {
                    const cleanName = removeAccents(recipientName);
                    await pool.query(
                        'INSERT INTO players (dofus_pseudo, discord_id, discord_username, discord_nickname) VALUES ($1, $2, $3, $4) ON CONFLICT (dofus_pseudo) DO UPDATE SET discord_id = $2, discord_nickname = $4',
                        [cleanName, recipientId, recipientName, cleanName]
                    );
                    playerRes = await pool.query('SELECT id FROM players WHERE discord_id = $1 LIMIT 1', [recipientId]);
                }
                const playerId = playerRes.rows[0].id;
                const seasonId = await ensureCurrentSeason();

                await pool.query('INSERT INTO nuggets (discord_id, amount, image_hash) VALUES ($1, $2, $3)', [recipientId, parsed.alliance_amount, imageHash]);
                await updateSeasonStats(playerId, seasonId, { nuggets: playerShare });
                await msgRef.edit(`[OK] ${parsed.alliance_amount} pépites alliance.\n[+] ${playerShare} pour ${displayName}.`);
            }
        } catch (e) { console.error(e); await msgRef.edit('Erreur technique.'); }
        return;
    }

    // --- LOGIQUE PVP ---
    if (message.channel.id !== config.CHANNEL_ID) return;
    const attachments = message.attachments.filter(a => a.contentType && a.contentType.startsWith('image/'));
    if (attachments.size === 0) return;

    console.log('[PvP] Upload detecté de', message.author.username, '-', attachments.size, 'image(s)');
    let userSession = activeSessions.get(message.author.id) || { winners: [], losers: [], context: null, allianceTier: null, percepteurDetected: false };
    const msgRef = await message.reply(`Analyse PvP en cours...`);
    console.log('[PvP] Message reply envoyé, debut analyse Gemini...');

    try {
        let allParsedWinners = [];
        let allParsedLosers = [];
        const totalImages = attachments.size;
        let imgIndex = 0;

        for (const [id, attachment] of attachments) {
            imgIndex++;
            if (totalImages > 1) {
                try { await msgRef.edit(`Analyse image ${imgIndex}/${totalImages}...`); } catch {}
            }
            const response = await fetch(attachment.url);
            const buffer = await response.arrayBuffer();
            const base64 = Buffer.from(buffer).toString('base64');

            const geminiResult = await queueGemini([
                { inlineData: { data: base64, mimeType: attachment.contentType || "image/png" } },
                { text: `Analyse ce screenshot de fin de combat Dofus (Alliance vs Alliance).
                 Extrait UNIQUEMENT les pseudos des joueurs HUMAINS.
                 
                 IMPORTANT : Le screenshot peut ne montrer QU'UNE SEULE section (soit GAGNANTS, soit PERDANTS).
                 Dans ce cas, remplis la section visible et laisse l'autre vide [].
                 
                 CRUCIAL - SECTION :
                 - Si tu vois le titre "PERDANTS" ou "LOSERS", TOUS les noms en dessous vont dans "losers" UNIQUEMENT.
                 - Si tu vois le titre "GAGNANTS" ou "WINNERS", TOUS les noms en dessous vont dans "winners" UNIQUEMENT.
                 - Ne jamais mettre un nom dans la mauvaise section.
                 
                 CRUCIAL - DETECTION COMPLETE :
                 - Il DOIT y avoir jusqu'à 5 joueurs par section visible. Cherche TOUS les noms présents.
                 - Si tu ne vois que 3 ou 4 noms là où il devrait y en avoir 5, regarde plus attentivement toute la colonne.
                 - Le nombre de joueurs détectés est critique : il influe directement sur les points attribués.
                 
                 Regles STRICTES :
                 - Les pseudos sous "GAGNANTS" ou "WINNERS" vont dans winners
                 - Les pseudos sous "PERDANTS" ou "LOSERS" vont dans losers
                 - MAXIMUM 5 joueurs par equipe (un combat AvA est 5v5 max)
                 - Extraire le NOM COMPLET tel qu'affiché
                 - Les pseudos peuvent être : un seul mot (ex: Bouff, Ketzal) OU plusieurs mots reliés par des tirets (ex: Raconte-pas-ta-vie, Mangeur-de-bouf, Jprotec-R)
                 - Les Percepteurs ont TOUJOURS "Do'" dans leur nom (ex: "Despera Do'Trakisse") — les exclure
                 - EXCLURE absolument tout nom contenant "Do'", "Do ", "Dofus", ainsi que : Prisme, Gardien, Protecteur
                 - EXCLURE les monstres, invocations, et PNJ
                 - IGNORER : niveaux, XP, kamas, butin, classes, objets, sorts
                 - Ne prendre QUE les noms qui apparaissent dans les colonnes GAGNANTS/PERDANTS
                 - Si tu vois plus de 5 pseudos dans une equipe, garde uniquement les 5 premiers
                 
                 Reponds UNIQUEMENT en JSON valide : {"winners": [], "losers": []}` }
            ]);

            const text = getResponseText(geminiResult);
            const clean = text.replace(/```json\n?|```\n?/g, '').trim();
            console.log('[Gemini] Image', id, 'reponse:', clean);

            let parsed;
            try {
                parsed = JSON.parse(clean);
            } catch (jsonErr) {
                console.log('[Gemini] JSON invalide, tentative repair...');
                const wSection = clean.match(/"winners"\s*:\s*\[?([\s\S]*?)\s*"losers"/);
                const lSection = clean.match(/"losers"\s*:\s*\[?([\s\S]*?)(\]|})\s*$/);
                const extract = (m) => m ? (m[1].match(/"([^"]+)"/g) || []).map(s => s.replace(/"/g, '')) : [];
                parsed = { winners: extract(wSection), losers: extract(lSection) };
                console.log('[Gemini] Repair result:', JSON.stringify(parsed));
            }

            if (parsed.winners) allParsedWinners.push(...parsed.winners);
            if (parsed.losers) allParsedLosers.push(...parsed.losers);
        }

        const parsed = {
            winners: [...new Set(allParsedWinners)],
            losers: [...new Set(allParsedLosers)]
        };

        console.log('[PvP] Merged result:', JSON.stringify(parsed));

        const preFilterWinCount = parsed.winners ? parsed.winners.length : 0;
        const preFilterLoseCount = parsed.losers ? parsed.losers.length : 0;

        const excludePattern = /prisme|gardien|protecteur|dofus|\bdo['\s]/i;
        const hasAccents = (str) => str !== str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const isNPC = (n) => excludePattern.test(n) || hasAccents(n) || n.includes(' ');
        if (parsed.winners) parsed.winners = parsed.winners.filter(n => !isNPC(n));
        if (parsed.losers) parsed.losers = parsed.losers.filter(n => !isNPC(n));

        if (preFilterLoseCount > 0 && parsed.losers.length === 0) userSession.percepteurDetected = true;
        if (preFilterWinCount > 0 && parsed.winners.length === 0) userSession.percepteurDetected = true;

        if (parsed.winners && parsed.winners.length > 5) parsed.winners = parsed.winners.slice(0, 5);
        if (parsed.losers && parsed.losers.length > 5) parsed.losers = parsed.losers.slice(0, 5);

        if (parsed.winners) userSession.winners = [...new Set([...userSession.winners, ...parsed.winners])];
        if (parsed.losers) userSession.losers = [...new Set([...userSession.losers, ...parsed.losers])];

        activeSessions.set(message.author.id, userSession);

        const bothSides = userSession.winners.length > 0 && userSession.losers.length > 0;
        const percepteurFight = userSession.percepteurDetected && !bothSides && (userSession.winners.length > 0 || userSession.losers.length > 0);

        if (percepteurFight) {
            clearSessionTimeout(message.author.id);
            activeSessions.delete(message.author.id);
            await msgRef.edit({ content: `Pas de def, 0 point chef`, components: [] });
        } else if (bothSides) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('attack').setLabel('Attaque').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('defense').setLabel('Défense').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('correct').setLabel('Corriger').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('reset').setLabel('Reset').setStyle(ButtonStyle.Secondary)
            );
            await msgRef.edit({ content: `[COMPLET]\nGagnants: ${userSession.winners.join(', ')}\nPerdants: ${userSession.losers.join(', ')}`, components: [row] });
            setSessionTimeout(message.author.id, msgRef);
        } else {
            await msgRef.edit(`[PARTIEL] Gagnants ${userSession.winners.length} / Perdants ${userSession.losers.length}. Envoyez la suite.`);
            setSessionTimeout(message.author.id, msgRef);
        }
    } catch (error) {
        console.error('[PvP] Erreur:', error);
        let msg;
        if (error.status === 503 || error.message?.includes('503')) {
            msg = "Gemini indisponible (503). Réessayez dans quelques secondes.";
        } else if (error.status === 429 || error.message?.includes('429')) {
            msg = "Limite de requêtes Gemini atteinte (429). Réessayez dans 30 secondes.";
        } else if (error.message?.includes('timeout')) {
            msg = "Timeout Gemini (60s dépassé). Réessayez.";
        } else if (error.message?.includes('fetch failed') || error.message?.includes('ECONNRESET') || error.message?.includes('ETIMEDOUT')) {
            msg = "Erreur réseau. Vérifiez la connexion et réessayez.";
        } else if (error.message?.includes('JSON')) {
            msg = "Réponse Gemini illisible. Réessayez avec un screenshot plus net.";
        } else {
            msg = `Erreur inattendue : ${error.message || error.status || 'inconnue'}`;
        }
        try { await msgRef.edit({ content: msg, components: [] }); } catch {}
    }
});

// ============================================
// 5. INTERACTIONS
// ============================================
client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isButton() && (interaction.customId === 'btn_link_char' || interaction.customId === 'btn_unlink_char')) {
            const isLink = interaction.customId === 'btn_link_char';
            const modal = new ModalBuilder().setCustomId(isLink ? 'modal_link' : 'modal_unlink').setTitle(isLink ? 'Lier Personnage' : 'Delier Personnage');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pseudoInput').setLabel("Pseudo Dofus").setStyle(TextInputStyle.Short)));
            await interaction.showModal(modal); return;
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'modal_correct') {
                const w = interaction.fields.getTextInputValue('winnersInput').split(',').map(s=>s.trim()).filter(s=>s).map(s => removeAccents(s));
                const l = interaction.fields.getTextInputValue('losersInput').split(',').map(s=>s.trim()).filter(s=>s).map(s => removeAccents(s));
                const session = activeSessions.get(interaction.user.id);
                if(session) {
                    session.winners = w; session.losers = l;
                    activeSessions.set(interaction.user.id, session);
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('attack').setLabel('Attaque').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('defense').setLabel('Défense').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('correct').setLabel('Corriger').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('reset').setLabel('Reset').setStyle(ButtonStyle.Secondary)
                    );
                    await interaction.reply({ content: `[CORRIGÉ]\nGagnants: ${w.join(', ')}\nPerdants: ${l.join(', ')}`, components: [row] });
                    const replyMsg = await interaction.fetchReply();
                    setSessionTimeout(interaction.user.id, replyMsg);
                }
                return;
            }

            const pseudo = removeAccents(interaction.fields.getTextInputValue('pseudoInput').trim());
            const { id: discordId, username: discordName } = interaction.user;
            const discordNickname = removeAccents(interaction.member.displayName);

            if (interaction.customId === 'modal_link') {
                const check = await pool.query('SELECT * FROM players WHERE LOWER(dofus_pseudo) = LOWER($1)', [pseudo]);
                if (check.rows.length === 0) {
                    await pool.query('INSERT INTO players (dofus_pseudo, discord_id, discord_username, discord_nickname) VALUES ($1, $2, $3, $4)', [pseudo, discordId, discordName, discordNickname]);
                } else {
                    const ex = check.rows[0];
                    if (ex.discord_id && ex.discord_id !== discordId) return interaction.reply({ content: 'Déjà lié à un autre compte.', ephemeral: true });
                    await pool.query('UPDATE players SET discord_id = $1, discord_username = $2, discord_nickname = $3 WHERE LOWER(dofus_pseudo) = LOWER($4)', [discordId, discordName, discordNickname, pseudo]);
                }
                await interaction.reply({ content: `[OK] ${pseudo} lié au compte Discord.`, ephemeral: true });
            }
            if (interaction.customId === 'modal_unlink') {
                await pool.query('UPDATE players SET discord_id = NULL WHERE LOWER(dofus_pseudo) = LOWER($1) AND discord_id = $2', [pseudo, discordId]);
                await interaction.reply({ content: `[OK] ${pseudo} délié.`, ephemeral: true });
            }
            return;
        }

        const session = activeSessions.get(interaction.user.id);
        if (!session && ['attack','defense','result_win','result_lose','select_alliance_bonus'].includes(interaction.customId)) return interaction.reply({ content: "Session expirée.", ephemeral: true });

        if (interaction.customId === 'reset') { clearSessionTimeout(interaction.user.id); activeSessions.delete(interaction.user.id); return interaction.update({ content: "Annulé.", components: [] }); }
        
        if (interaction.customId === 'correct') {
            const modal = new ModalBuilder().setCustomId('modal_correct').setTitle('Correction');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('winnersInput').setLabel('Gagnants').setStyle(TextInputStyle.Short).setValue(session.winners.join(', '))),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('losersInput').setLabel('Perdants').setStyle(TextInputStyle.Short).setValue(session.losers.join(', ')))
            );
            await interaction.showModal(modal); return;
        }

        if (interaction.customId === 'attack' || interaction.customId === 'defense') {
            session.context = interaction.customId;
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('result_win').setLabel('VICTOIRE').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('result_lose').setLabel('DÉFAITE').setStyle(ButtonStyle.Danger)
            );
            const modeLabel = interaction.customId === 'attack' ? 'Attaque' : 'Défense';
            await interaction.update({ content: `Mode : **${modeLabel}**. Résultat ?`, components: [row] });
            setSessionTimeout(interaction.user.id, interaction.message);
        }

        else if (interaction.customId === 'result_win' || interaction.customId === 'result_lose') {
            session.hasWon = interaction.customId === 'result_win';
            const resultLabel = session.hasWon ? 'Victoire' : 'Défaite';
            const seenIds = new Set();
            const uniquePools = liveConfig.pools.filter(p => {
                if (!p.id || !p.name || seenIds.has(p.id)) return false;
                seenIds.add(p.id);
                return true;
            });
            console.log('[PvP] Pools disponibles:', uniquePools.map(p => p.id + ':' + p.name).join(', '));
            const poolOptions = uniquePools.map(p => new StringSelectMenuOptionBuilder().setLabel(p.name).setValue(p.id));
            const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('select_alliance_bonus').setPlaceholder("Alliance Adverse").addOptions(poolOptions));
            const ctxLabel = session.context === 'attack' ? 'Attaque' : 'Défense';
            await interaction.update({ content: `**${ctxLabel}** — **${resultLabel}**. Adversaire ?`, components: [row] });
            setSessionTimeout(interaction.user.id, interaction.message);
        }

        else if (interaction.isStringSelectMenu() && interaction.customId === 'select_alliance_bonus') {
            session.allianceTier = interaction.values[0];
            const poolObj = liveConfig.pools.find(p => p.id === session.allianceTier);
            const tierName = poolObj ? poolObj.name : session.allianceTier;
            session.allianceName = tierName;

            clearSessionTimeout(interaction.user.id);
            activeSessions.delete(interaction.user.id);
            await interaction.deferUpdate();

            const hasWon = session.hasWon;
            const myTeam = hasWon ? session.winners : session.losers;
            const enTeam = hasWon ? session.losers : session.winners;
            const myC = Math.min(Math.max(myTeam.length, 1), 5); 
            const enC = Math.min(Math.max(enTeam.length, 1), 5);
            
            const gridWin = session.context === 'defense' ? liveConfig.pts_def_win : liveConfig.pts_atk_win;
            const gridLose = session.context === 'defense' ? liveConfig.pts_def_lose : liveConfig.pts_atk_lose;
            const gridPts = hasWon ? gridWin[myC-1][enC-1] : gridLose[myC-1][enC-1];
            const poolPct = (hasWon && poolObj) ? (poolObj.bonus || 0) : 0;
            let pts = Math.floor(gridPts * (1 + poolPct / 100));

            if (enTeam.length === 0) pts = 0;

            const seasonId = await ensureCurrentSeason();
            await snapshotRanks(seasonId);
            const matchRes = await pool.query("INSERT INTO matches (season_id, alliance_tier, points_awarded, context, has_won) VALUES ($1, $2, $3, $4, $5) RETURNING id", [seasonId, session.allianceTier, pts, session.context, hasWon]);
            const matchId = matchRes.rows[0].id;
            
            const processedDiscordIds = new Set();
            const paid = [], skipped = [], defeated = [];

            const processPlayers = async (pseudos, isWinner, isAlly) => {
                for (const p of pseudos) await pool.query('INSERT INTO players (dofus_pseudo) VALUES ($1) ON CONFLICT DO NOTHING', [p]);
                
                const rows = await pool.query(`
                    SELECT id, dofus_pseudo, discord_id 
                    FROM players 
                    WHERE LOWER(dofus_pseudo) = ANY($1::text[])
                    ORDER BY discord_id NULLS LAST
                `, [pseudos.map(x=>x.toLowerCase())]);

                for (const pName of pseudos) {
                    const pData = rows.rows.find(r => r.dofus_pseudo.toLowerCase() === pName.toLowerCase());
                    if (!pData) continue;

                    await pool.query('INSERT INTO match_participants (match_id, player_id, is_winner) VALUES ($1, $2, $3)', [matchId, pData.id, isWinner]);

                    if (isAlly) {
                        let shouldCountStats = true;
                        if (pData.discord_id) {
                            if (processedDiscordIds.has(pData.discord_id)) {
                                shouldCountStats = false;
                            } else {
                                processedDiscordIds.add(pData.discord_id);
                            }
                        }

                        if (shouldCountStats) {
                            await updateSeasonStats(pData.id, seasonId, { points: pts, wins: isWinner ? 1 : 0, losses: isWinner ? 0 : 1 });
                            if (isWinner) paid.push(pName);
                            else defeated.push(pName);
                        } else {
                            if (isWinner) skipped.push(pName);
                        }
                    }
                }
            };

            await processPlayers(session.winners, true, hasWon);
            await processPlayers(session.losers, false, !hasWon);

            const resultLabel = hasWon ? 'Victoire' : 'Défaite';
            const contextLabel = session.context === 'attack' ? 'Attaque' : 'Défense';
            const myCount = hasWon ? session.winners.length : session.losers.length;
            const enCount = hasWon ? session.losers.length : session.winners.length;
            const scoreLabel = `${myCount}vs${enCount}`;
            const allianceLine = `**${resultLabel}** vs **${session.allianceName || session.allianceTier}** (${contextLabel}) — ${scoreLabel}`;

            const multiGroups = {};
            const allAllyPseudos = hasWon ? session.winners : session.losers;
            const allyRows = await pool.query(`
                SELECT dofus_pseudo, discord_id FROM players 
                WHERE LOWER(dofus_pseudo) = ANY($1::text[]) AND discord_id IS NOT NULL
            `, [allAllyPseudos.map(x=>x.toLowerCase())]);
            for (const r of allyRows.rows) {
                if (!multiGroups[r.discord_id]) multiGroups[r.discord_id] = [];
                multiGroups[r.discord_id].push(r.dofus_pseudo);
            }
            const multiAccountLines = Object.values(multiGroups).filter(g => g.length > 1);
            
            let msg;
            if (paid.length > 0 && defeated.length > 0) {
                msg = `${allianceLine}\n**+${pts} pts** : ${paid.join(', ')}\n**+${pts} pts** (défaite) : ${defeated.join(', ')}`;
            } else if (paid.length > 0) {
                msg = `${allianceLine}\n**+${pts} pts** : ${paid.join(', ')}`;
            } else if (defeated.length > 0) {
                msg = `${allianceLine}\n**+${pts} pts** : ${defeated.join(', ')}`;
            } else {
                msg = `${allianceLine}\nAucun joueur crédité.`;
            }
            if (skipped.length > 0) msg += `\n⚠️ Multi-comptes ignorés : ${skipped.join(', ')}`;
            if (multiAccountLines.length > 0) msg += `\n🔗 Comptes liés : ${multiAccountLines.map(g => g.join(' = ')).join(' | ')}`;
            
            await interaction.editReply({ content: msg, components: [] });
        }

    } catch (e) { console.error(e); }
});

async function ensureCurrentSeason() {
    const { seasons, currentSeason } = getSeasons();
    const cur = seasons.find(s => s.id === currentSeason);
    if(cur) await pool.query('INSERT INTO seasons (id, start_date, end_date) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING', [cur.id, cur.start, cur.end]);
    return currentSeason;
}

async function snapshotRanks(seasonId) {
    await pool.query(`
        WITH ranked AS (
            SELECT ss.player_id, ss.season_id,
                ROW_NUMBER() OVER (ORDER BY ss.points DESC, ss.wins DESC) as current_rank
            FROM season_stats ss
            WHERE ss.season_id = $1 AND (ss.wins + ss.losses) > 0
        )
        UPDATE season_stats SET previous_rank = ranked.current_rank
        FROM ranked
        WHERE season_stats.player_id = ranked.player_id AND season_stats.season_id = ranked.season_id
    `, [seasonId]);
}

async function updateSeasonStats(pid, sid, { points=0, wins=0, losses=0, nuggets=0 }) {
    await pool.query(`
        INSERT INTO season_stats (player_id, season_id, points, wins, losses, nuggets) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (player_id, season_id) DO UPDATE SET 
        points = season_stats.points + EXCLUDED.points,
        wins = season_stats.wins + EXCLUDED.wins,
        losses = season_stats.losses + EXCLUDED.losses,
        nuggets = season_stats.nuggets + EXCLUDED.nuggets
    `, [pid, sid, points, wins, losses, nuggets]);
}

client.login(process.env.DISCORD_TOKEN);