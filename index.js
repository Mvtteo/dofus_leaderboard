require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
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
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- IMPORTS ---
const { pool } = require('./db');
const config = require('./config');

// --- GEMINI AI ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

// ============================================
// 1. IA : LECTURE DES SCREENS PVP
// ============================================
async function parseScreenWithAI(imageUrl) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        
        const response = await fetch(imageUrl);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        
        const result = await model.generateContent([
            { inlineData: { data: base64, mimeType: "image/png" } },
            `Analyse ce screenshot de fin de combat Dofus (Alliance vs Alliance).
             Extrait UNIQUEMENT les pseudos des joueurs HUMAINS.
             
             Regles STRICTES :
             - Les pseudos sous "GAGNANTS" ou "WINNERS" vont dans winners
             - Les pseudos sous "PERDANTS" ou "LOSERS" vont dans losers
             - MAXIMUM 5 joueurs par equipe (un combat AvA est 5v5 max)
             - EXCLURE absolument : Percepteur, Prisme, tout ce qui contient "Do'", "Dofus", "Gardien", "Protecteur"
             - EXCLURE les monstres, invocations, et PNJ
             - IGNORER : niveaux, XP, kamas, butin, classes, objets, sorts
             - Ne prendre QUE les noms qui apparaissent dans les colonnes GAGNANTS/PERDANTS
             - Si tu vois plus de 5 pseudos dans une equipe, garde uniquement les 5 premiers
             
             Reponds UNIQUEMENT en JSON valide : {"winners": [], "losers": []}`
        ]);
        
        const text = result.response.text();
        const clean = text.replace(/```json\n?|```\n?/g, '').trim();
        const parsed = JSON.parse(clean);

        // Nettoyage automatique des accents
        if (parsed.winners) parsed.winners = parsed.winners.map(name => removeAccents(name));
        if (parsed.losers) parsed.losers = parsed.losers.map(name => removeAccents(name));

        // Cap a 5 joueurs par equipe (AvA = 5v5 max)
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
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        const response = await fetch(imageUrl);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');

        const result = await model.generateContent([
            { inlineData: { data: base64, mimeType: "image/png" } },
            `Transcris tout le texte visible sur cette image de chat Dofus, mot pour mot.`
        ]);

        const text = result.response.text();
        
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
app.use(express.static(__dirname));
app.use('/assets', express.static(path.join(__dirname, 'web/assets')));

// --- ADMIN AUTH ---
const adminTokens = new Set();

function adminAuth(req, res, next) {
    const token = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('admin_token='))?.split('=')[1];
    if (token && adminTokens.has(token)) { req.adminAuth = true; return next(); }
    req.adminAuth = false; next();
}

// --- LIVE SETTINGS (pool bonuses en DB) ---
const liveConfig = {
    pool_1_name: config.POOL_NAMES?.pool_1 || 'Pool 1',
    pool_1_bonus: config.BONUSES?.pool_1 || 0,
    pool_2_name: config.POOL_NAMES?.pool_2 || 'Pool 2',
    pool_2_bonus: config.BONUSES?.pool_2 || 0
};

async function loadSettings() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
        const res = await pool.query('SELECT key, value FROM settings');
        for (const row of res.rows) {
            if (row.key in liveConfig) {
                liveConfig[row.key] = row.key.includes('bonus') ? parseInt(row.value) || 0 : row.value;
            }
        }
        console.log('[Settings] Chargés depuis la DB:', liveConfig);
    } catch (e) { console.error('[Settings] Fallback config.js:', e.message); }
}

async function saveSetting(key, value) {
    await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, String(value)]);
    liveConfig[key] = key.includes('bonus') ? parseInt(value) || 0 : value;
}

// Charger les settings au demarrage
loadSettings();

function getSeasons() {
    const INITIAL_DATE = new Date('2026-02-01T00:00:00'); 
    const DAYS_PER_SEASON = 14;
    const now = new Date();
    const seasons = [];
    let loopDate = new Date(INITIAL_DATE);
    let id = 1;
    let currentSeasonId = 1;

    while (true) {
        const start = new Date(loopDate);
        if (start > now) break;
        const end = new Date(start);
        end.setDate(end.getDate() + DAYS_PER_SEASON);
        end.setMilliseconds(-1); 

        const isCurrent = (now >= start && now <= end);
        if (isCurrent) currentSeasonId = id;

        const startStr = start.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
        const endStr = end.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
        seasons.push({ id, label: `Saison ${id} (${startStr} - ${endStr})`, start, end, isCurrent });
        
        loopDate.setDate(loopDate.getDate() + DAYS_PER_SEASON);
        id++;
        if (id > 1000) break;
    }
    if (seasons.length === 0) {
        const end = new Date(INITIAL_DATE);
        end.setDate(end.getDate() + DAYS_PER_SEASON);
        seasons.push({ id: 1, label: `Saison 1 (Bientot)`, start: INITIAL_DATE, end, isCurrent: true });
    }
    return { seasons, currentSeason: currentSeasonId };
}

app.get('/', async (req, res) => {
    try {
        const query = `
            SELECT 
                COALESCE(MAX(p.discord_nickname), MAX(p.discord_username), MAX(p.dofus_pseudo)) as display_name,
                SUM(ss.points) as total_points,
                SUM(ss.wins) as wins,
                SUM(ss.losses) as losses,
                MIN(ss.previous_rank) as previous_rank
            FROM players p
            JOIN season_stats ss ON ss.player_id = p.id
            GROUP BY COALESCE(p.discord_id, p.dofus_pseudo)
            HAVING SUM(ss.wins) + SUM(ss.losses) > 0
            ORDER BY total_points DESC
        `;
        const result = await pool.query(query);
        const players = result.rows.map((p, index) => {
            const wins = Number(p.wins) || 0;
            const losses = Number(p.losses) || 0;
            const totalGames = wins + losses;
            const currentRank = index + 1;
            const prevRank = p.previous_rank ? Number(p.previous_rank) : null;
            let rankChange = 0;
            if (prevRank !== null) rankChange = prevRank - currentRank; // positif = monte
            return {
                dofus_pseudo: p.display_name,
                total_points: parseInt(p.total_points),
                wins, losses,
                winrate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
                rank_change: rankChange
            };
        });

        const countRes = await pool.query('SELECT COUNT(*) as c FROM matches');
        const { seasons, currentSeason } = getSeasons();

        res.render('index', { 
            players, seasons, currentSeason, 
            totalCombats: parseInt(countRes.rows[0].c) 
        });
    } catch (error) { console.error(error); res.status(500).send('Erreur serveur'); }
});

app.get('/api/leaderboard/:seasonId', async (req, res) => {
    try {
        const seasonId = req.params.seasonId;
        const query = `
            SELECT 
                COALESCE(MAX(p.discord_nickname), MAX(p.discord_username), MAX(p.dofus_pseudo)) as dofus_pseudo,
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
            return {
                dofus_pseudo: p.dofus_pseudo,
                total_points: p.total_points,
                wins, losses,
                winrate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
                rank_change: rankChange
            };
        });
        res.json(players);
    } catch (error) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ============================================
// 3b. ROUTES ADMIN
// ============================================
app.get('/admin', adminAuth, async (req, res) => {
    if (!req.adminAuth) return res.render('admin', { authenticated: false, error: null });
    try {
        const nuggetsRes = await pool.query(`
            SELECT 
                COALESCE(MAX(discord_nickname), MAX(dofus_pseudo)) as name, 
                SUM(bank_nuggets) as bank_nuggets 
            FROM players 
            WHERE bank_nuggets > 0 
            GROUP BY COALESCE(discord_id, dofus_pseudo)
            ORDER BY bank_nuggets DESC
        `);
        res.render('admin', { 
            authenticated: true, error: null,
            settings: liveConfig,
            nuggets: nuggetsRes.rows
        });
    } catch (e) { 
        console.error(e);
        res.render('admin', { authenticated: true, error: null, settings: liveConfig, nuggets: [] });
    }
});

// --- ADMIN RATE LIMIT ---
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

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
        const { pool_1_name, pool_1_bonus, pool_2_name, pool_2_bonus } = req.body;
        await saveSetting('pool_1_name', pool_1_name);
        await saveSetting('pool_1_bonus', pool_1_bonus);
        await saveSetting('pool_2_name', pool_2_name);
        await saveSetting('pool_2_bonus', pool_2_bonus);
        res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Erreur serveur.' }); }
});

app.get('/admin/api/players', adminAuth, async (req, res) => {
    if (!req.adminAuth) return res.status(401).json([]);
    try {
        const r = await pool.query(`SELECT COALESCE(discord_nickname, dofus_pseudo) as name FROM players ORDER BY name`);
        res.json(r.rows.map(p => p.name));
    } catch { res.json([]); }
});

app.post('/admin/api/player-points', adminAuth, async (req, res) => {
    if (!req.adminAuth) return res.status(401).json({ error: 'Non autorisé.' });
    try {
        const { pseudo, points } = req.body;
        const pts = parseInt(points);
        if (!pseudo || isNaN(pts)) return res.status(400).json({ error: 'Pseudo ou points invalides.' });

        // Trouver le joueur
        const playerRes = await pool.query(`
            SELECT id, COALESCE(discord_nickname, dofus_pseudo) as name 
            FROM players WHERE LOWER(COALESCE(discord_nickname, dofus_pseudo)) = LOWER($1)
        `, [pseudo]);
        if (playerRes.rows.length === 0) return res.status(404).json({ error: 'Joueur introuvable.' });

        const playerId = playerRes.rows[0].id;
        const playerName = playerRes.rows[0].name;
        const seasonId = await ensureCurrentSeason();

        await updateSeasonStats(playerId, seasonId, { points: pts, wins: 0, losses: 0 });

        // Recalculer le total
        const totalRes = await pool.query('SELECT SUM(points) as total FROM season_stats WHERE player_id = $1', [playerId]);
        const newTotal = parseInt(totalRes.rows[0].total) || 0;

        res.json({ ok: true, pseudo: playerName, delta: pts, newTotal });
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
        console.log('[Startup] DB verifiee.');
    } catch (e) { console.error(e); }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.channel.id === config.CHANNEL_ID) {
        try {
            const rawNickname = message.member ? message.member.displayName : message.author.username;
            const cleanNickname = removeAccents(rawNickname);
            await pool.query('UPDATE players SET discord_nickname = $1 WHERE discord_id = $2', [cleanNickname, message.author.id]);
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
    // --- CLASSEMENT PEPITES (STAFF) ---
    if (message.content === '!pepites') {
        if (!hasStaffRole(message.member)) {
            return message.reply("[REFUS] Cette commande est réservée au STAFF.");
        }

        try {
            const res = await pool.query(`
                SELECT 
                    COALESCE(MAX(discord_nickname), MAX(dofus_pseudo)) as name, 
                    SUM(bank_nuggets) as bank_nuggets 
                FROM players 
                WHERE bank_nuggets > 0 
                GROUP BY COALESCE(discord_id, dofus_pseudo)
                ORDER BY bank_nuggets DESC 
            `);

            if (res.rows.length === 0) return message.reply("Aucune pépite en banque.");

            const lines = res.rows.map((p, i) => {
                let rank = `${i + 1}.`;
                return `${rank} **${p.name}** : ${p.bank_nuggets}`;
            });

            // On coupe le message si trop long (Discord limite à 4096 caractères)
            // Ici on affiche max les 20 premiers dans l'embed, le reste en texte si besoin
            const topList = lines.slice(0, 20).join('\n');
            
            const embed = new EmbedBuilder()
                .setTitle('Banque des Pépites (Alliance)')
                .setColor(0xFFD700)
                .setDescription(topList)
                .setFooter({ text: `Total accumulé - Top 20 sur ${res.rows.length} comptes` });

            return message.reply({ embeds: [embed] });

        } catch (e) {
            console.error(e);
            return message.reply("Erreur récupération pépites.");
        }
    }

    // --- RESET PEPITES (STAFF) ---
    if (message.content === '!resetpepites') {
        if (!hasStaffRole(message.member)) {
            return message.reply("[REFUS] Cette commande est réservée au STAFF.");
        }
        try {
            await pool.query('UPDATE players SET bank_nuggets = 0 WHERE bank_nuggets > 0');
            await pool.query('DELETE FROM nuggets');
            return message.reply("[OK] Toutes les pépites ont été remises à zéro.");
        } catch (e) {
            console.error(e);
            return message.reply("Erreur reset pépites.");
        }
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
                
                if (!parsed || !parsed.alliance_amount) { 
                    await msgRef.edit('Montant introuvable.'); 
                    return; 
                }

                const playerShare = Math.floor(parsed.alliance_amount * 0.5);
                const mentionedMember = message.mentions.members?.first();
                const recipientId = mentionedMember ? mentionedMember.id : message.author.id;
                const recipientName = mentionedMember ? mentionedMember.displayName : (message.member?.displayName || message.author.username);
                const displayName = recipientName.toLowerCase() === 'duma' ? 'Gros orteils' : recipientName;
                
                await pool.query('INSERT INTO nuggets (discord_id, amount, image_hash) VALUES ($1, $2, $3)', [recipientId, parsed.alliance_amount, imageHash]);
                await pool.query('UPDATE players SET bank_nuggets = COALESCE(bank_nuggets, 0) + $1 WHERE discord_id = $2', [playerShare, recipientId]);

                await msgRef.edit(`[OK] ${parsed.alliance_amount} pépites alliance.\n[+] ${playerShare} pour ${displayName}.`);
            }
        } catch (e) { 
            console.error(e);
            await msgRef.edit('Erreur technique.'); 
        }
        return;
    }

    // --- LOGIQUE PVP ---
    if (message.channel.id !== config.CHANNEL_ID) return;
    const attachments = message.attachments.filter(a => a.contentType && a.contentType.startsWith('image/'));
    if (attachments.size === 0) return;

    let userSession = activeSessions.get(message.author.id) || { winners: [], losers: [], context: null, allianceTier: null };
    const msgRef = await message.reply(`Analyse PvP en cours...`);

    try {
        for (const [id, attachment] of attachments) {
            const parsed = await parseScreenWithAI(attachment.url);
            if (parsed) {
                if (parsed.winners) userSession.winners = [...new Set([...userSession.winners, ...parsed.winners])];
                if (parsed.losers) userSession.losers = [...new Set([...userSession.losers, ...parsed.losers])];
            }
        }
        activeSessions.set(message.author.id, userSession);

        if (userSession.winners.length > 0 && userSession.losers.length > 0) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('attack').setLabel('Attaque').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('defense').setLabel('Défense').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('correct').setLabel('Corriger').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('reset').setLabel('Reset').setStyle(ButtonStyle.Secondary)
            );
            await msgRef.edit({ content: `[COMPLET]\nGagnants: ${userSession.winners.join(', ')}\nPerdants: ${userSession.losers.join(', ')}`, components: [row] });
        } else {
            await msgRef.edit(`[PARTIEL] Gagnants ${userSession.winners.length} / Perdants ${userSession.losers.length}. Envoyez la suite.`);
        }
    } catch (error) { msgRef.edit("Erreur d'analyse."); }
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
        if (!session && ['attack','defense','result_win','result_lose'].includes(interaction.customId)) return interaction.reply({ content: "Session expirée.", ephemeral: true });

        if (interaction.customId === 'reset') { activeSessions.delete(interaction.user.id); return interaction.update({ content: "Annulé.", components: [] }); }
        
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
            const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('select_alliance_bonus').setPlaceholder("Alliance Adverse").addOptions(
                new StringSelectMenuOptionBuilder().setLabel('Standard').setValue('standard'),
                new StringSelectMenuOptionBuilder().setLabel(liveConfig.pool_1_name).setValue('pool_1'),
                new StringSelectMenuOptionBuilder().setLabel(liveConfig.pool_2_name).setValue('pool_2')
            ));
            await interaction.update({ content: `Mode : **${interaction.customId}**. Adversaire ?`, components: [row] });
        }

        else if (interaction.isStringSelectMenu() && interaction.customId === 'select_alliance_bonus') {
            session.allianceTier = interaction.values[0];
            const tierName = session.allianceTier === 'standard' ? 'Standard' : (liveConfig[session.allianceTier + '_name'] || session.allianceTier);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('result_win').setLabel('VICTOIRE').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('result_lose').setLabel('DÉFAITE').setStyle(ButtonStyle.Danger)
            );
            await interaction.update({ content: `Adversaire : **${tierName}**. Résultat ?`, components: [row] });
        }

        else if (interaction.customId === 'result_win' || interaction.customId === 'result_lose') {
            activeSessions.delete(interaction.user.id);
            await interaction.deferUpdate();

            const hasWon = interaction.customId === 'result_win';
            
            // 1. NETTOYAGE DES PSEUDOS
            const cleanWinners = session.winners.map(n => removeAccents(n));
            const cleanLosers = session.losers.map(n => removeAccents(n));

            const myTeam = hasWon ? cleanWinners : cleanLosers;
            const enTeam = hasWon ? cleanLosers : cleanWinners;
            
            const myC = Math.min(Math.max(myTeam.length, 1), 5); 
            const enC = Math.min(Math.max(enTeam.length, 1), 5);
            
            // Calcul Points
            const PTS = {
                WIN: [[2,4,5,5,5],[1,4,5,5,5],[1,2,6,6,6],[1,2,3,8,8],[1,2,3,5,8]],
                LOSE: [[1,2,3,3,3],[1,2,3,3,3],[0,2,3,3,3],[0,0,3,4,4],[0,0,0,4,5]]
            };
            let pts = hasWon ? PTS.WIN[myC-1][enC-1] : PTS.LOSE[myC-1][enC-1];
            if (session.allianceTier === 'pool_1') pts += liveConfig.pool_1_bonus;
            if (session.allianceTier === 'pool_2') pts += liveConfig.pool_2_bonus;

            const seasonId = await ensureCurrentSeason();
            await snapshotRanks(seasonId); // Snapshot des rangs avant modification
            const matchRes = await pool.query("INSERT INTO matches (season_id, alliance_tier, points_awarded) VALUES ($1, $2, $3) RETURNING id", [seasonId, session.allianceTier, pts]);
            const matchId = matchRes.rows[0].id;
            
            // --- LOGIQUE MULTI-COMPTE ---
            const processedDiscordIds = new Set();
            const paid = [], skipped = [], defeated = [];

            // ON AJOUTE LE PARAMETRE 'isAlly'
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

                    // On enregistre TOUJOURS la participation (pour l'historique)
                    await pool.query('INSERT INTO match_participants (match_id, player_id, is_winner) VALUES ($1, $2, $3)', [matchId, pData.id, isWinner]);

                    // MAIS on ne met a jour le classement QUE si c'est un ALLIE
                    if (isAlly) {
                        let shouldCountStats = true;

                        if (pData.discord_id) {
                            if (processedDiscordIds.has(pData.discord_id)) {
                                shouldCountStats = false; // Doublon Discord
                            } else {
                                processedDiscordIds.add(pData.discord_id);
                            }
                        }

                        if (shouldCountStats) {
                            // Victoire -> toujours les points. Defaite -> points LOSE en defense, 0 en attaque
                            let pointsToAdd;
                            if (isWinner) {
                                pointsToAdd = pts;
                            } else {
                                pointsToAdd = session.context === 'defense' ? pts : 0;
                            }
                            const winsToAdd = isWinner ? 1 : 0;
                            const lossesToAdd = isWinner ? 0 : 1;
                            
                            await updateSeasonStats(pData.id, seasonId, { points: pointsToAdd, wins: winsToAdd, losses: lossesToAdd });
                            
                            if (isWinner) paid.push(pName);
                            else defeated.push(pName);
                        } else {
                            if (isWinner) skipped.push(pName);
                        }
                    }
                }
            };

            // APPEL LOGIQUE :
            // Si j'ai gagné (hasWon=true) -> Les Winners sont mes Alliés (true).
            // Si j'ai perdu (hasWon=false) -> Les Winners sont mes Ennemis (false).
            await processPlayers(cleanWinners, true, hasWon); // Traitement des gagnants
            
            // Inverse pour les perdants
            await processPlayers(cleanLosers, false, !hasWon); // Traitement des perdants

            const allCredited = [...paid, ...defeated];
            const defPts = session.context === 'defense' ? pts : 0;
            
            let msg;
            if (paid.length > 0 && defeated.length > 0) {
                msg = `**+${pts} pts** : ${paid.join(', ')}\n**+${defPts} pts** (défaite) : ${defeated.join(', ')}`;
            } else if (paid.length > 0) {
                msg = `**+${pts} pts** : ${paid.join(', ')}`;
            } else if (defeated.length > 0) {
                msg = `**+${defPts} pts** : ${defeated.join(', ')}`;
            } else {
                msg = `Aucun joueur crédité.`;
            }
            
            if (skipped.length > 0) {
                msg += `\n[Ignorés - Multi] : ${skipped.join(', ')}`;
            }
            
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
    // Capture les rangs actuels avant modification
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

async function updateSeasonStats(pid, sid, { points=0, wins=0, losses=0 }) {
    await pool.query(`
        INSERT INTO season_stats (player_id, season_id, points, wins, losses) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (player_id, season_id) DO UPDATE SET 
        points = season_stats.points + EXCLUDED.points,
        wins = season_stats.wins + EXCLUDED.wins,
        losses = season_stats.losses + EXCLUDED.losses
    `, [pid, sid, points, wins, losses]);
}

client.login(process.env.DISCORD_TOKEN);