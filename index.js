require('dotenv').config();
const express = require('express');
const path = require('path');
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
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

if (!config.CHANNEL_ID) {
    console.error("ERREUR : CHANNEL_ID manquant dans le .env");
    process.exit(1);
}

if (!process.env.GEMINI_API_KEY) {
    console.error("ERREUR : GEMINI_API_KEY manquant dans le .env");
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const activeSessions = new Map();

// ============================================
// GEMINI VISION - PARSING SCREENSHOTS
// ============================================
async function parseScreenWithAI(imageUrl) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        // Telecharger l'image
        const response = await fetch(imageUrl);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        
        const result = await model.generateContent([
            {
                inlineData: {
                    data: base64,
                    mimeType: "image/png"
                }
            },
            `Analyse ce screenshot de fin de combat Dofus.
             Extrait UNIQUEMENT les pseudos des joueurs.
             
             Regles :
             - Les pseudos sous "GAGNANTS" ou "WINNERS" vont dans winners
             - Les pseudos sous "PERDANTS" ou "LOSERS" vont dans losers
             - EXCLURE : Percepteur, Prisme, tout ce qui commence par "Do'" ou "Dofus"
             - IGNORER : niveaux, XP, kamas, butin, classes
             - Les pseudos peuvent contenir des tirets, apostrophes et chiffres
             
             Reponds UNIQUEMENT en JSON valide : {"winners": [], "losers": []}`
        ]);
        
        const text = result.response.text();
        console.log("Gemini raw response:", text);
        
        // Nettoyer le JSON si entoure de backticks
        const clean = text.replace(/```json\n?|```\n?/g, '').trim();
        return JSON.parse(clean);
        
    } catch (error) {
        console.error("Erreur Gemini:", error.message);
        return null;
    }
}

// ============================================
// SERVEUR WEB
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

        seasons.push({ 
            id: id, 
            label: `Saison ${id} (${startStr} - ${endStr})`, 
            start: start, 
            end: end, 
            isCurrent: isCurrent 
        });

        loopDate.setDate(loopDate.getDate() + DAYS_PER_SEASON);
        id++;
        
        if (id > 1000) break;
    }

    if (seasons.length === 0) {
        const end = new Date(INITIAL_DATE);
        end.setDate(end.getDate() + DAYS_PER_SEASON);
        seasons.push({ id: 1, label: `Saison 1 (Bientot)`, start: INITIAL_DATE, end: end, isCurrent: true });
        currentSeasonId = 1;
    }

    return { seasons, currentSeason: currentSeasonId };
}

app.get('/', async (req, res) => {
    try {
        const query = `
            SELECT 
                COALESCE(MAX(discord_nickname), MAX(discord_username), MAX(dofus_pseudo)) as display_name,
                SUM(total_points) as total_points,
                MAX(dofus_pseudo) as main_char,
                MAX(wins) as wins,
                MAX(losses) as losses
            FROM players 
            GROUP BY COALESCE(discord_id, dofus_pseudo)
            HAVING SUM(total_points) > 0
            ORDER BY total_points DESC
        `;

        const result = await pool.query(query);
        
        const players = result.rows.map(p => {
            const wins = p.wins || 0;
            const losses = p.losses || 0;
            const totalGames = wins + losses;
            const winrate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;
            
            return {
                dofus_pseudo: p.display_name,
                total_points: parseInt(p.total_points),
                wins: wins,
                losses: losses,
                winrate: winrate
            };
        });

        const totalPoints = players.reduce((sum, p) => sum + p.total_points, 0);
        const countRes = await pool.query('SELECT COUNT(*) as c FROM matches');
        const totalCombats = parseInt(countRes.rows[0].c);

        const { seasons, currentSeason } = getSeasons();

        res.render('index', { 
            players, 
            totalPoints, 
            seasons, 
            currentSeason,
            totalCombats
        });

    } catch (error) {
        console.error('Erreur page leaderboard:', error);
        res.status(500).send('Erreur serveur');
    }
});

app.get('/api/leaderboard/:seasonId', async (req, res) => {
    try {
        const seasonId = req.params.seasonId;
        const query = `
            SELECT 
                COALESCE(MAX(p.discord_nickname), MAX(p.discord_username), MAX(sp.dofus_pseudo)) as dofus_pseudo,
                SUM(sp.points) as total_points,
                MAX(p.wins) as wins,
                MAX(p.losses) as losses
            FROM season_points sp
            LEFT JOIN players p ON sp.dofus_pseudo = p.dofus_pseudo
            WHERE sp.season_id = $1
            GROUP BY COALESCE(p.discord_id, sp.dofus_pseudo)
            ORDER BY total_points DESC
        `;
        const result = await pool.query(query, [seasonId]);
        
        const players = result.rows.map(p => {
            const wins = p.wins || 0;
            const losses = p.losses || 0;
            const totalGames = wins + losses;
            const winrate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;
            return {
                dofus_pseudo: p.dofus_pseudo,
                total_points: p.total_points,
                wins: wins,
                losses: losses,
                winrate: winrate
            };
        });
        
        res.json(players);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.listen(config.WEB_PORT, () => {
    console.log(`Web server running on port ${config.WEB_PORT}`);
});

// ============================================
// BOT DISCORD
// ============================================
client.once('ready', () => { 
    console.log(`Bot Connecte : ${client.user.tag}`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // --- MISE A JOUR SILENCIEUSE DU SURNOM ---
    if (message.channel.id === config.CHANNEL_ID) {
        try {
            const nickname = message.member ? message.member.displayName : message.author.username;
            await pool.query(
                'UPDATE players SET discord_nickname = $1 WHERE discord_id = $2', 
                [nickname, message.author.id]
            );
        } catch (e) {}
    }

    // --- 1. AJOUT MANUEL JOUEUR ---
    if (message.content.startsWith('!addplayer') && message.member.permissions.has('Administrator')) {
        const args = message.content.split(' ');
        if (args.length < 2) return message.reply("Usage : `!addplayer <PseudoExact>`");
        const pseudo = args[1]; 
        try {
            await pool.query('INSERT INTO players (dofus_pseudo) VALUES ($1) ON CONFLICT (dofus_pseudo) DO NOTHING', [pseudo]);
            return message.reply(`**${pseudo}** ajoute !`);
        } catch (err) { return message.reply("Erreur ajout."); }
    }

    // --- 2. GESTION PROFIL (Admin) ---
    if (message.content === '!setup_profile' && message.member.permissions.has('Administrator')) {
        const profileChannel = await client.channels.fetch(config.PROFILE_CHANNEL_ID);
        if (!profileChannel) return message.reply(`Erreur ID Channel Profil.`);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_link_char').setLabel('Lier un Personnage').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('btn_unlink_char').setLabel('Delier un Personnage').setStyle(ButtonStyle.Danger)
        );
        const embed = new EmbedBuilder()
            .setTitle('Gestion de vos Personnages')
            .setDescription("Liez vos personnages Dofus a votre compte Discord pour cumuler vos points !\n\n1. Cliquez sur **Lier**.\n2. Entrez le pseudo exact.\n3. Vos points seront fusionnes.")
            .setColor(0x00FF00);

        await profileChannel.send({ embeds: [embed], components: [row] });
        if (message.channel.id !== config.PROFILE_CHANNEL_ID) message.reply(`Panneau envoye.`);
        return;
    }

    // --- 3. SCAN LEADERBOARD (PvP) ---
    if (message.channel.id !== config.CHANNEL_ID) return;
    const attachments = message.attachments.filter(a => a.contentType && a.contentType.startsWith('image/'));
    if (attachments.size === 0) return;

    let userSession = activeSessions.get(message.author.id) || { winners: [], losers: [], context: null, allianceTier: null };
    const msgRef = await message.reply(`Analyse en cours...`);

    try {
        for (const [id, attachment] of attachments) {
            const parsed = await parseScreenWithAI(attachment.url);
            
            if (parsed) {
                console.log("Parsed result:", parsed);
                if (parsed.winners && parsed.winners.length > 0) {
                    userSession.winners = [...new Set([...userSession.winners, ...parsed.winners])];
                }
                if (parsed.losers && parsed.losers.length > 0) {
                    userSession.losers = [...new Set([...userSession.losers, ...parsed.losers])];
                }
            } else {
                await msgRef.edit("Erreur lors de l'analyse de l'image.");
                return;
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
        } else if (userSession.winners.length > 0 || userSession.losers.length > 0) {
            await msgRef.edit(`**Resultat partiel** - Envoyez l'autre screenshot\nGagnants: ${userSession.winners.length} | Perdants: ${userSession.losers.length}`);
        } else {
            await msgRef.edit("Aucun joueur detecte. Verifiez que c'est bien un ecran de fin de combat.");
        }
    } catch (error) { 
        console.error(error); 
        msgRef.edit("Erreur technique."); 
    }
});

client.on('interactionCreate', async interaction => {
    try {
        // --- GESTION PROFIL ---
        if (interaction.isButton() && ['btn_link_char', 'btn_unlink_char'].includes(interaction.customId)) {
            if (interaction.customId === 'btn_link_char') {
                const modal = new ModalBuilder().setCustomId('modal_link').setTitle('Lier un personnage');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pseudoInput').setLabel("Pseudo Dofus").setStyle(TextInputStyle.Short)));
                await interaction.showModal(modal); return;
            }
            if (interaction.customId === 'btn_unlink_char') {
                const modal = new ModalBuilder().setCustomId('modal_unlink').setTitle('Delier un personnage');
                modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pseudoInput').setLabel("Pseudo Dofus").setStyle(TextInputStyle.Short)));
                await interaction.showModal(modal); return;
            }
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'modal_correct') {
                const winnersRaw = interaction.fields.getTextInputValue('winnersInput');
                const losersRaw = interaction.fields.getTextInputValue('losersInput');
                const newWinners = winnersRaw.split(',').map(p => p.trim()).filter(p => p.length > 0);
                const newLosers = losersRaw.split(',').map(p => p.trim()).filter(p => p.length > 0);
                
                const userSession = activeSessions.get(interaction.user.id);
                if (userSession) {
                    userSession.winners = newWinners;
                    userSession.losers = newLosers;
                    activeSessions.set(interaction.user.id, userSession);
                    
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('attack').setLabel('Attaque').setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId('defense').setLabel('Defense').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('correct').setLabel('Corriger').setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId('reset').setLabel('Reset').setStyle(ButtonStyle.Secondary)
                    );
                    await interaction.reply({ content: `**Corrige !**\nGagnants: ${newWinners.join(', ')}\nPerdants: ${newLosers.join(', ')}`, components: [row] });
                }
                return;
            }
            
            // --- MODALS PROFIL ---
            const pseudo = interaction.fields.getTextInputValue('pseudoInput').trim();
            const discordId = interaction.user.id;
            const discordName = interaction.user.username;
            const discordNickname = interaction.member.displayName;

            if (interaction.customId === 'modal_link') {
                const check = await pool.query('SELECT * FROM players WHERE LOWER(dofus_pseudo) = LOWER($1)', [pseudo]);
                if (check.rows.length === 0) {
                    await pool.query('INSERT INTO players (dofus_pseudo, discord_id, discord_username, discord_nickname) VALUES ($1, $2, $3, $4)', [pseudo, discordId, discordName, discordNickname]);
                } else {
                    const existing = check.rows[0];
                    if (existing.discord_id && existing.discord_id !== discordId) return interaction.reply({ content: `Personnage deja lie a un autre compte.`, ephemeral: true });
                    await pool.query('UPDATE players SET discord_id = $1, discord_username = $2, discord_nickname = $3 WHERE LOWER(dofus_pseudo) = LOWER($4)', [discordId, discordName, discordNickname, pseudo]);
                }
                await interaction.reply({ content: `**${pseudo}** lie a **${discordNickname}** !`, ephemeral: true });
            }
            if (interaction.customId === 'modal_unlink') {
                const res = await pool.query('UPDATE players SET discord_id = NULL, discord_username = NULL WHERE LOWER(dofus_pseudo) = LOWER($1) AND discord_id = $2', [pseudo, discordId]);
                await interaction.reply({ content: res.rowCount > 0 ? `**${pseudo}** delie.` : `Erreur ou ce n'est pas votre perso.`, ephemeral: true });
            }
            return;
        }

        // --- LOGIQUE COMBAT ---
        const userSession = activeSessions.get(interaction.user.id);
        if (!userSession) {
            if (interaction.isButton() && ['attack', 'defense', 'result_win', 'result_lose'].includes(interaction.customId)) {
                return interaction.reply({ content: "Session expiree. Renvoyez les screens.", ephemeral: true });
            }
            return;
        }

        if (interaction.isButton() && interaction.customId === 'reset') {
            activeSessions.delete(interaction.user.id);
            return interaction.update({ content: "Session effacee.", components: [] });
        }

        if (interaction.isButton() && interaction.customId === 'correct') {
            const modal = new ModalBuilder().setCustomId('modal_correct').setTitle('Corriger pseudos');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('winnersInput').setLabel('Gagnants').setStyle(TextInputStyle.Short).setValue(userSession.winners.join(', '))),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('losersInput').setLabel('Perdants').setStyle(TextInputStyle.Short).setValue(userSession.losers.join(', ')))
            );
            await interaction.showModal(modal);
            return;
        }

        if (interaction.isButton() && (interaction.customId === 'attack' || interaction.customId === 'defense')) {
            userSession.context = interaction.customId; 
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_alliance_bonus')
                .setPlaceholder('Choisissez l\'Alliance adverse')
                .addOptions(
                    new StringSelectMenuOptionBuilder().setLabel('Standard / Autre').setValue('standard'),
                    new StringSelectMenuOptionBuilder().setLabel(config.POOL_NAMES.pool_1.substring(0, 100)).setValue('pool_1'),
                    new StringSelectMenuOptionBuilder().setLabel(config.POOL_NAMES.pool_2.substring(0, 100)).setValue('pool_2'),
                );
            const row = new ActionRowBuilder().addComponents(selectMenu);
            await interaction.update({ content: `Mode : **${interaction.customId === 'attack' ? 'Attaque' : 'Defense'}**.\nContre quel type d'alliance ?`, components: [row] });
        }

        else if (interaction.isStringSelectMenu() && interaction.customId === 'select_alliance_bonus') {
            userSession.allianceTier = interaction.values[0]; 
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('result_win').setLabel('VICTOIRE').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('result_lose').setLabel('DEFAITE').setStyle(ButtonStyle.Danger)
            );
            let allianceLabel = "Standard";
            if (userSession.allianceTier === 'pool_1') allianceLabel = config.POOL_NAMES.pool_1;
            if (userSession.allianceTier === 'pool_2') allianceLabel = config.POOL_NAMES.pool_2;
            await interaction.update({ content: `Config : **${userSession.context}** vs **${allianceLabel}**.\nResultat du combat ?`, components: [row] });
        }

        else if (interaction.isButton() && (interaction.customId === 'result_win' || interaction.customId === 'result_lose')) {
            if (!activeSessions.has(interaction.user.id)) return interaction.reply({ content: "Deja traite.", ephemeral: true });
            activeSessions.delete(interaction.user.id);
            await interaction.deferUpdate();
            
            const hasWon = interaction.customId === 'result_win';
            const myTeam = hasWon ? userSession.winners : userSession.losers;
            const enemyTeam = hasWon ? userSession.losers : userSession.winners;
            
            if (!myTeam || myTeam.length === 0) return interaction.editReply({ content: "Erreur equipe.", components: [] });

            const myCount = Math.min(Math.max(myTeam.length, 1), 5); 
            const enemyCount = Math.min(Math.max(enemyTeam.length, 1), 5);

            const POINTS_MATRIX = {
                WIN:  [[ 2, 4, 5, 5, 5 ], [ 1, 4, 5, 5, 5 ], [ 1, 2, 6, 6, 6 ], [ 1, 2, 3, 8, 8 ], [ 1, 2, 3, 5, 8 ]],
                LOSE: [[ 1, 2, 3, 3, 3 ], [ 1, 2, 3, 3, 3 ], [ 0, 2, 3, 3, 3 ], [ 0, 0, 3, 4, 4 ], [ 0, 0, 0, 4, 5 ]]
            };

            let pointsToAdd = hasWon ? POINTS_MATRIX.WIN[myCount - 1][enemyCount - 1] : POINTS_MATRIX.LOSE[myCount - 1][enemyCount - 1];
            let allianceBonus = 0;
            if (userSession.allianceTier === 'pool_1') allianceBonus = config.BONUSES.pool_1;
            if (userSession.allianceTier === 'pool_2') allianceBonus = config.BONUSES.pool_2;
            const totalPoints = pointsToAdd + allianceBonus;

            // GAGNANTS - Detection doublons discord_id
            const winnersData = await pool.query(
                `SELECT dofus_pseudo, discord_id FROM players WHERE LOWER(dofus_pseudo) = ANY($1::text[])`,
                [userSession.winners]
            );
            
            const discordIdsRewarded = new Set();
            const pseudosRewarded = [];
            const pseudosSkipped = [];
            
            for (const pseudo of userSession.winners) {
                const playerRow = winnersData.rows.find(r => r.dofus_pseudo.toLowerCase() === pseudo.toLowerCase());
                const discordId = playerRow?.discord_id;
                
                // Si le joueur a un discord_id et qu'on l'a deja recompense, skip
                if (discordId && discordIdsRewarded.has(discordId)) {
                    pseudosSkipped.push(pseudo);
                    // On compte quand meme la win pour les stats du perso
                    await pool.query(`INSERT INTO players (dofus_pseudo, wins) VALUES ($1, 1) ON CONFLICT (dofus_pseudo) DO UPDATE SET wins = players.wins + 1`, [pseudo]);
                    continue;
                }
                
                if (discordId) discordIdsRewarded.add(discordId);
                pseudosRewarded.push(pseudo);
                
                await updatePlayerPoints(pseudo, totalPoints);
                await pool.query(`INSERT INTO players (dofus_pseudo, wins) VALUES ($1, 1) ON CONFLICT (dofus_pseudo) DO UPDATE SET wins = players.wins + 1`, [pseudo]);
            }

            // PERDANTS - Meme logique pour les stats (pas de points)
            const losersData = await pool.query(
                `SELECT dofus_pseudo, discord_id FROM players WHERE dofus_pseudo = ANY($1)`,
                [userSession.losers]
            );
            
            const discordIdsLoss = new Set();
            
            for (const pseudo of userSession.losers) {
                const playerRow = losersData.rows.find(r => r.dofus_pseudo.toLowerCase() === pseudo.toLowerCase());
                const discordId = playerRow?.discord_id;
                
                // Si deja compte une loss pour ce discord_id, skip la stat
                if (discordId && discordIdsLoss.has(discordId)) {
                    continue;
                }
                
                if (discordId) discordIdsLoss.add(discordId);
                await pool.query(`INSERT INTO players (dofus_pseudo, losses) VALUES ($1, 1) ON CONFLICT (dofus_pseudo) DO UPDATE SET losses = players.losses + 1`, [pseudo]);
            }

            try {
                await pool.query("INSERT INTO matches (winners, losers) VALUES ($1, $2)", [userSession.winners.join(','), userSession.losers.join(',')]);
            } catch (err) { console.error("Erreur save match:", err); }

            // REPONSE FINALE
            let finalMsg = `**Enregistré !** ${totalPoints} points attribués a ${pseudosRewarded.join(', ')}`;
            if (pseudosSkipped.length > 0) {
                finalMsg += `\n(${pseudosSkipped.join(', ')} : meme compte, points non cumules)`;
            }
            await interaction.editReply({ 
                content: finalMsg, 
                components: [] 
            });
        }
    } catch (err) {
        console.error("Erreur interaction:", err);
    }
});

// --- FONCTIONS DB ---
async function updatePlayerPoints(pseudo, points) {
    const { currentSeason } = getSeasons();
    const queryGlobal = `INSERT INTO players (dofus_pseudo, total_points) VALUES ($1, $2) ON CONFLICT (dofus_pseudo) DO UPDATE SET total_points = players.total_points + $2;`;
    await pool.query(queryGlobal, [pseudo, points]);
    const querySeason = `INSERT INTO season_points (dofus_pseudo, season_id, points) VALUES ($1, $2, $3) ON CONFLICT (dofus_pseudo, season_id) DO UPDATE SET points = season_points.points + $3;`;
    await pool.query(querySeason, [pseudo, currentSeason, points]);
}

client.login(process.env.DISCORD_TOKEN);