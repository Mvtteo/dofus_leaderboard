require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto'); // Important pour l'anti-doublon
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
    StringSelectMenuOptionBuilder 
} = require('discord.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- IMPORTS ---
const { pool } = require('./db');
const config = require('./config');

// --- GEMINI AI ---
// ATTENTION : On utilise bien 'gemini-1.5-flash' (2.5 n'existe pas !)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const response = await fetch(imageUrl);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        
        const result = await model.generateContent([
            { inlineData: { data: base64, mimeType: "image/png" } },
            `Analyse ce screenshot de fin de combat Dofus.
             Extrait UNIQUEMENT les pseudos des joueurs.
             
             Regles :
             - Les pseudos sous "GAGNANTS" ou "WINNERS" vont dans winners
             - Les pseudos sous "PERDANTS" ou "LOSERS" vont dans losers
             - EXCLURE : Percepteur, Prisme, tout ce qui contient "Do'" ou "Dofus"
             - IGNORER : niveaux, XP, kamas, butin, classes
             
             Reponds UNIQUEMENT en JSON valide : {"winners": [], "losers": []}`
        ]);
        
        const text = result.response.text();
        const clean = text.replace(/```json\n?|```\n?/g, '').trim();
        return JSON.parse(clean);
    } catch (error) {
        console.error("Erreur Gemini PvP:", error.message);
        return null;
    }
}

// ============================================
// 2. IA : LECTURE DES PÉPITES (MÉTHODE OCR + REGEX)
// ============================================
async function parseNuggetsWithAI(imageUrl) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const response = await fetch(imageUrl);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');

        // On demande juste le texte brut, sans réfléchir
        const result = await model.generateContent([
            { inlineData: { data: base64, mimeType: "image/png" } },
            `Transcris tout le texte visible sur cette image de chat Dofus, mot pour mot.`
        ]);

        const text = result.response.text();
        console.log("Gemini OCR:", text); // Tu verras le texte lu dans la console

        // REGEX MAGIQUE : Cherche un nombre situé juste après "et" et avant "ont été ajoutées"
        // Fonctionne même si l'IA rajoute des espaces ou des sauts de ligne
        const regex = /et\s*(\d+)\s*ont\s*été\s*ajoutées/i;
        const match = text.match(regex);

        if (match && match[1]) {
            return { alliance_amount: parseInt(match[1]) };
        }
        
        return null;

    } catch (error) { 
        console.error("Erreur Gemini Pépites:", error.message);
        return null; 
    }
}

// ============================================
// 3. SERVEUR WEB (SITE)
// ============================================
const app = express();
app.set('view engine', 'ejs');
app.set('views', __dirname);
app.use(express.static(__dirname));
app.use('/assets', express.static(path.join(__dirname, 'web/assets')));

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
                SUM(ss.losses) as losses
            FROM players p
            JOIN season_stats ss ON ss.player_id = p.id
            GROUP BY COALESCE(p.discord_id, p.dofus_pseudo)
            HAVING SUM(ss.points) > 0
            ORDER BY total_points DESC
        `;
        const result = await pool.query(query);
        const players = result.rows.map(p => {
            const wins = Number(p.wins) || 0;
            const losses = Number(p.losses) || 0;
            const totalGames = wins + losses;
            return {
                dofus_pseudo: p.display_name,
                total_points: parseInt(p.total_points),
                wins, losses,
                winrate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0
            };
        });

        const totalPoints = players.reduce((sum, p) => sum + p.total_points, 0);
        const countRes = await pool.query('SELECT COUNT(*) as c FROM matches');
        const { seasons, currentSeason } = getSeasons();

        res.render('index', { 
            players, totalPoints, seasons, currentSeason, 
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
                SUM(ss.losses) as losses
            FROM players p
            JOIN season_stats ss ON ss.player_id = p.id
            WHERE ss.season_id = $1
            GROUP BY COALESCE(p.discord_id, p.dofus_pseudo)
            HAVING SUM(ss.points) > 0
            ORDER BY total_points DESC
        `;
        const result = await pool.query(query, [seasonId]);
        const players = result.rows.map(p => {
            const wins = Number(p.wins) || 0;
            const losses = Number(p.losses) || 0;
            const totalGames = wins + losses;
            return {
                dofus_pseudo: p.dofus_pseudo,
                total_points: p.total_points,
                wins, losses,
                winrate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0
            };
        });
        res.json(players);
    } catch (error) { res.status(500).json({ error: 'Erreur serveur' }); }
});

app.listen(config.WEB_PORT, () => { console.log(`Web server running on port ${config.WEB_PORT}`); });

// ============================================
// 4. BOT DISCORD
// ============================================
client.once('ready', async () => { 
    console.log(`Bot Connecte : ${client.user.tag}`);
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS nuggets (id SERIAL PRIMARY KEY, discord_id TEXT, amount INT, image_hash TEXT, created_at TIMESTAMP DEFAULT NOW())`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS bank_nuggets INTEGER DEFAULT 0`);
        console.log('[Startup] DB verifiee.');
    } catch (e) { console.error(e); }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.channel.id === config.CHANNEL_ID) {
        try {
            const nickname = message.member ? message.member.displayName : message.author.username;
            await pool.query('UPDATE players SET discord_nickname = $1 WHERE discord_id = $2', [nickname, message.author.id]);
        } catch (e) {}
    }

    if (message.content.startsWith('!addplayer') && message.member.permissions.has('Administrator')) {
        const args = message.content.split(' ');
        if (args.length < 2) return message.reply("Usage : `!addplayer <PseudoExact>`");
        try {
            await pool.query('INSERT INTO players (dofus_pseudo) VALUES ($1) ON CONFLICT (dofus_pseudo) DO NOTHING', [args[1]]);
            return message.reply(`**${args[1]}** ajoute !`);
        } catch (err) { return message.reply("Erreur ajout."); }
    }

    if (message.content === '!setup_profile' && message.member.permissions.has('Administrator')) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_link_char').setLabel('Lier un Personnage').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('btn_unlink_char').setLabel('Delier un Personnage').setStyle(ButtonStyle.Danger)
        );
        const embed = new EmbedBuilder().setTitle('Gestion de vos Personnages').setDescription("Liez vos personnages Dofus a votre compte Discord !").setColor(0x00FF00);
        const ch = await client.channels.fetch(config.PROFILE_CHANNEL_ID);
        if(ch) ch.send({ embeds: [embed], components: [row] });
    }

    // --- LOGIQUE PÉPITES ---
    if (config.NUGGETS_CHANNEL_ID && message.channel.id === config.NUGGETS_CHANNEL_ID) {
        const attachments = message.attachments.filter(a => a.contentType && a.contentType.startsWith('image/'));
        if (attachments.size === 0) return;
        const msgRef = await message.reply('Analyse pepites...');
        
        try {
            for (const [id, attachment] of attachments) {
                const imgResponse = await fetch(attachment.url);
                const imgBuffer = await imgResponse.arrayBuffer();
                const imageHash = crypto.createHash('sha256').update(Buffer.from(imgBuffer)).digest('hex');
                
                const dup = await pool.query('SELECT id FROM nuggets WHERE image_hash = $1', [imageHash]);
                if (dup.rows.length > 0) { await msgRef.edit('Deja traite.'); return; }

                const parsed = await parseNuggetsWithAI(attachment.url);
                
                if (!parsed || !parsed.alliance_amount) { 
                    await msgRef.edit('Montant introuvable. Verifiez que la phrase "ont ete ajoutees" est visible.'); 
                    return; 
                }

                const playerShare = Math.floor(parsed.alliance_amount * 0.5);
                const mentionedMember = message.mentions.members?.first();
                const recipientId = mentionedMember ? mentionedMember.id : message.author.id;
                const recipientName = mentionedMember ? mentionedMember.displayName : (message.member?.displayName || message.author.username);
                
                await pool.query('INSERT INTO nuggets (discord_id, amount, image_hash) VALUES ($1, $2, $3)', [recipientId, parsed.alliance_amount, imageHash]);
                await pool.query('UPDATE players SET bank_nuggets = COALESCE(bank_nuggets, 0) + $1 WHERE discord_id = $2', [playerShare, recipientId]);

                await msgRef.edit(`**${parsed.alliance_amount}** pepites alliance.\n**${playerShare}** ajoutees a la banque de ${recipientName} !`);
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
    const msgRef = await message.reply(`Analyse PvP...`);

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
                new ButtonBuilder().setCustomId('defense').setLabel('Defense').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('correct').setLabel('Corriger').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('reset').setLabel('Reset').setStyle(ButtonStyle.Secondary)
            );
            await msgRef.edit({ content: `**Complet !**\nGagnants: ${userSession.winners.join(', ')}\nPerdants: ${userSession.losers.join(', ')}`, components: [row] });
        } else {
            await msgRef.edit(`**Partiel** : Gagnants ${userSession.winners.length} / Perdants ${userSession.losers.length}. Envoyez la suite.`);
        }
    } catch (error) { msgRef.edit("Erreur analyse."); }
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
                const w = interaction.fields.getTextInputValue('winnersInput').split(',').map(s=>s.trim()).filter(s=>s);
                const l = interaction.fields.getTextInputValue('losersInput').split(',').map(s=>s.trim()).filter(s=>s);
                const session = activeSessions.get(interaction.user.id);
                if(session) {
                    session.winners = w; session.losers = l;
                    activeSessions.set(interaction.user.id, session);
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('attack').setLabel('Attaque').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('defense').setLabel('Defense').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('correct').setLabel('Corriger').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('reset').setLabel('Reset').setStyle(ButtonStyle.Secondary)
                    );
                    await interaction.reply({ content: `**Corrige !**\nGagnants: ${w.join(', ')}\nPerdants: ${l.join(', ')}`, components: [row] });
                }
                return;
            }

            const pseudo = interaction.fields.getTextInputValue('pseudoInput').trim();
            const { id: discordId, username: discordName } = interaction.user;
            const discordNickname = interaction.member.displayName;

            if (interaction.customId === 'modal_link') {
                const check = await pool.query('SELECT * FROM players WHERE LOWER(dofus_pseudo) = LOWER($1)', [pseudo]);
                if (check.rows.length === 0) {
                    await pool.query('INSERT INTO players (dofus_pseudo, discord_id, discord_username, discord_nickname) VALUES ($1, $2, $3, $4)', [pseudo, discordId, discordName, discordNickname]);
                } else {
                    const ex = check.rows[0];
                    if (ex.discord_id && ex.discord_id !== discordId) return interaction.reply({ content: 'Deja lie a un autre compte.', ephemeral: true });
                    await pool.query('UPDATE players SET discord_id = $1, discord_username = $2, discord_nickname = $3 WHERE LOWER(dofus_pseudo) = LOWER($4)', [discordId, discordName, discordNickname, pseudo]);
                }
                await interaction.reply({ content: `**${pseudo}** lie !`, ephemeral: true });
            }
            if (interaction.customId === 'modal_unlink') {
                await pool.query('UPDATE players SET discord_id = NULL WHERE LOWER(dofus_pseudo) = LOWER($1) AND discord_id = $2', [pseudo, discordId]);
                await interaction.reply({ content: `**${pseudo}** delie.`, ephemeral: true });
            }
            return;
        }

        const session = activeSessions.get(interaction.user.id);
        if (!session && ['attack','defense','result_win','result_lose'].includes(interaction.customId)) return interaction.reply({ content: "Session expiree.", ephemeral: true });

        if (interaction.customId === 'reset') { activeSessions.delete(interaction.user.id); return interaction.update({ content: "Annule.", components: [] }); }
        
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
                new StringSelectMenuOptionBuilder().setLabel(config.POOL_NAMES.pool_1).setValue('pool_1'),
                new StringSelectMenuOptionBuilder().setLabel(config.POOL_NAMES.pool_2).setValue('pool_2')
            ));
            await interaction.update({ content: `Mode: **${interaction.customId}**. Adversaire ?`, components: [row] });
        }

        else if (interaction.isStringSelectMenu() && interaction.customId === 'select_alliance_bonus') {
            session.allianceTier = interaction.values[0];
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('result_win').setLabel('VICTOIRE').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('result_lose').setLabel('DEFAITE').setStyle(ButtonStyle.Danger)
            );
            await interaction.update({ content: `Adversaire: **${session.allianceTier}**. Resultat ?`, components: [row] });
        }

        else if (interaction.customId === 'result_win' || interaction.customId === 'result_lose') {
            activeSessions.delete(interaction.user.id);
            await interaction.deferUpdate();

            const hasWon = interaction.customId === 'result_win';
            const myTeam = hasWon ? session.winners : session.losers;
            const enTeam = hasWon ? session.losers : session.winners;
            
            const myC = Math.min(Math.max(myTeam.length, 1), 5); 
            const enC = Math.min(Math.max(enTeam.length, 1), 5);
            
            const PTS = {
                WIN: [[2,4,5,5,5],[1,4,5,5,5],[1,2,6,6,6],[1,2,3,8,8],[1,2,3,5,8]],
                LOSE: [[1,2,3,3,3],[1,2,3,3,3],[0,2,3,3,3],[0,0,3,4,4],[0,0,0,4,5]]
            };
            let pts = hasWon ? PTS.WIN[myC-1][enC-1] : PTS.LOSE[myC-1][enC-1];
            if (session.allianceTier === 'pool_1') pts += config.BONUSES.pool_1;
            if (session.allianceTier === 'pool_2') pts += config.BONUSES.pool_2;

            const seasonId = await ensureCurrentSeason();
            await pool.query("INSERT INTO matches (season_id, alliance_tier, points_awarded) VALUES ($1, $2, $3)", [seasonId, session.allianceTier, pts]);
            
            const rewardedDiscordIds = new Set();
            const paid = [], skipped = [];

            for (const p of session.winners) await pool.query('INSERT INTO players (dofus_pseudo) VALUES ($1) ON CONFLICT DO NOTHING', [p]);
            const winRows = await pool.query(`SELECT id, dofus_pseudo, discord_id FROM players WHERE LOWER(dofus_pseudo) = ANY($1::text[])`, [session.winners.map(x=>x.toLowerCase())]);
            
            for (const pName of session.winners) {
                const pData = winRows.rows.find(r => r.dofus_pseudo.toLowerCase() === pName.toLowerCase());
                if (!pData) continue;

                let givePoints = true;
                if (pData.discord_id) {
                    if (rewardedDiscordIds.has(pData.discord_id)) givePoints = false;
                    else rewardedDiscordIds.add(pData.discord_id);
                }

                if (givePoints) {
                    paid.push(pName);
                    await updateSeasonStats(pData.id, seasonId, { points: pts, wins: 1 });
                } else {
                    skipped.push(pName);
                    await updateSeasonStats(pData.id, seasonId, { wins: 1 });
                }
            }

            for (const p of session.losers) {
                await pool.query('INSERT INTO players (dofus_pseudo) VALUES ($1) ON CONFLICT DO NOTHING', [p]);
                const pRes = await pool.query('SELECT id FROM players WHERE LOWER(dofus_pseudo) = LOWER($1)', [p]);
                if (pRes.rows[0]) await updateSeasonStats(pRes.rows[0].id, seasonId, { losses: 1 });
            }

            let msg = `**Match Enregistre !**\n${hasWon ? 'Victoire' : 'Defaite'} (${myC}v${enC})\nPoints: **${pts}**`;
            msg += `\nJoueurs recompenses : ${paid.join(', ')}`;
            if (skipped.length) msg += `\n(Non cumule : ${skipped.join(', ')})`;
            
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