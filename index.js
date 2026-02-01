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
const Tesseract = require('tesseract.js');

// --- IMPORTS ---
const { pool } = require('./db');
const config = require('./config');

let Jimp;
try {
    const jimpLib = require('jimp');
    Jimp = jimpLib.Jimp || jimpLib;
} catch (e) {
    console.error("Erreur critique : Jimp mal installe.");
    process.exit(1);
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
// SERVEUR WEB
// ============================================
const app = express();
app.set('view engine', 'ejs');
app.set('views', __dirname);
app.use(express.static(__dirname));
app.use('/assets', express.static(path.join(__dirname, 'web/assets')));

function getSeasons() {
    const startDate = new Date('2026-02-01T00:00:00'); 
    const now = new Date();
    const limitDate = new Date(now);
    const seasons = [];
    let loopDate = new Date(startDate);
    let id = 1;
    let currentSeasonId = 1;

    while (true) {
        const year = loopDate.getFullYear();
        const month = loopDate.getMonth(); 
        const startA = new Date(year, month, 1, 0, 0, 0);
        const endA = new Date(year, month, 15, 23, 59, 59);

        if (startA > limitDate) break;
        if (now >= startA && now <= endA) currentSeasonId = id;
        seasons.push({ id: id++, label: `Saison ${id-1} (01/${month+1} - 15/${month+1})`, start: startA, end: endA, isCurrent: (now >= startA && now <= endA) });

        const startB = new Date(year, month, 16, 0, 0, 0);
        const endB = new Date(year, month + 1, 0, 23, 59, 59);

        if (startB > limitDate) break;
        if (now >= startB && now <= endB) currentSeasonId = id;
        seasons.push({ id: id++, label: `Saison ${id-1} (16/${month+1} - ${endB.getDate()}/${month+1})`, start: startB, end: endB, isCurrent: (now >= startB && now <= endB) });

        loopDate.setMonth(loopDate.getMonth() + 1);
        if (id > 240) break;
    }
    return { seasons, currentSeason: currentSeasonId };
}

app.get('/', async (req, res) => {
    try {
        // 1. Récupération du classement (Filtré > 0)
        const query = `
            SELECT 
                COALESCE(MAX(discord_username), MAX(dofus_pseudo)) as display_name,
                SUM(total_points) as total_points,
                MAX(dofus_pseudo) as main_char
            FROM players 
            GROUP BY COALESCE(discord_id, dofus_pseudo)
            HAVING SUM(total_points) > 0
            ORDER BY total_points DESC
        `;
        // ^^^ J'ai ajouté la ligne "HAVING..." juste au-dessus ^^^

        const result = await pool.query(query);
        
        const players = result.rows.map(p => ({
            dofus_pseudo: p.display_name,
            total_points: parseInt(p.total_points)
        }));

        // 2. Calcul des totaux
        const totalPoints = players.reduce((sum, p) => sum + p.total_points, 0);

        // --- GESTION DU COMPTEUR DE COMBATS (Pour éviter le crash) ---
        // Si tu as une table 'matches', décommente les lignes ci-dessous :
        const resultCombats = await pool.query('SELECT COUNT(*) as count FROM matches');
        const totalCombats = parseInt(resultCombats.rows[0].count);
        
        // -------------------------------------------------------------

        const { seasons, currentSeason } = getSeasons();

        res.render('index', { 
            players, 
            totalPoints, 
            seasons, 
            currentSeason,
            totalCombats // Indispensable pour que EJS ne plante pas
        });

    } catch (error) {
        console.error('Erreur page leaderboard:', error);
        res.status(500).send('Erreur serveur');
    }
});

app.listen(config.WEB_PORT, () => {
    console.log(`Web server running on port ${config.WEB_PORT}`);
});

app.get('/api/leaderboard/:seasonId', async (req, res) => {
    try {
        const seasonId = req.params.seasonId;
        const query = `
            SELECT 
                COALESCE(MAX(p.discord_username), MAX(sp.dofus_pseudo)) as dofus_pseudo,
                SUM(sp.points) as total_points
            FROM season_points sp
            LEFT JOIN players p ON sp.dofus_pseudo = p.dofus_pseudo
            WHERE sp.season_id = $1
            GROUP BY COALESCE(p.discord_id, sp.dofus_pseudo)
            ORDER BY total_points DESC
        `;
        const result = await pool.query(query, [seasonId]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ============================================
// BOT DISCORD
// ============================================
client.once('ready', () => { 
    console.log(`Bot Connecte : ${client.user.tag}`);
    updateLeaderboard(); 
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // --- 1. GESTION PROFIL (Admin) ---
    if (message.content === '!setup_profile' && message.member.permissions.has('Administrator')) {
        const profileChannel = await client.channels.fetch(config.PROFILE_CHANNEL_ID);
        if (!profileChannel) return message.reply(`❌ Erreur ID Channel Profil.`);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_link_char').setLabel('➕ Lier un Personnage').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('btn_unlink_char').setLabel('➖ Délier un Personnage').setStyle(ButtonStyle.Danger)
        );
        const embed = new EmbedBuilder()
            .setTitle('Gestion de vos Personnages')
            .setDescription("Liez vos personnages Dofus à votre compte Discord pour cumuler vos points !\n\n1. Cliquez sur **Lier**.\n2. Entrez le pseudo exact.\n3. Vos points seront fusionnés.")
            .setColor(0x00FF00);

        await profileChannel.send({ embeds: [embed], components: [row] });
        if (message.channel.id !== config.PROFILE_CHANNEL_ID) message.reply(`✅ Panneau envoyé.`);
        return;
    }

    // --- 2. COMMANDE BANQUE PEPITES (Admin) ---
    // Affiche le total de l'alliance et la liste des joueurs
    if (message.content === '!banque' && message.member.permissions.has('Administrator')) {
        try {
            // On récupère tous les joueurs qui ont des pépites, triés par montant
            const res = await pool.query(`
                SELECT dofus_pseudo, bank_nuggets 
                FROM players 
                WHERE bank_nuggets > 0 
                ORDER BY bank_nuggets DESC
            `);

            // Calcul du total cumulé (Part Joueurs = Part Alliance théorique car 50/50)
            const total = res.rows.reduce((acc, row) => acc + row.bank_nuggets, 0);

            // Construction de la liste (Top 20 pour éviter la limite de caractères Discord)
            let description = `**Total cumulé (Part Joueurs) :** ${total.toLocaleString()} 💎\n`;
            description += `*(Cela signifie que l'Alliance a également reçu ~${total.toLocaleString()} pépites)*\n\n`;
            description += `**🏆 Top Contributeurs :**\n`;

            if (res.rows.length === 0) {
                description += "_Aucune pépite enregistrée pour le moment._";
            } else {
                res.rows.slice(0, 20).forEach((p, i) => {
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`;
                    description += `${medal} **${p.dofus_pseudo}** : ${p.bank_nuggets.toLocaleString()} 💎\n`;
                });
                
                if (res.rows.length > 20) {
                    description += `\n... et ${res.rows.length - 20} autres joueurs.`;
                }
            }

            const embed = new EmbedBuilder()
                .setTitle('🏦 Banque des Pépites (Alliance)')
                .setColor(0xFFA500) // Orange
                .setDescription(description)
                .setTimestamp();

            return message.reply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            return message.reply("❌ Erreur lors de la récupération de la banque.");
        }
    }

    // --- 3. GESTION DES PEPITES (Scan) ---
    // --- 3. GESTION DES PEPITES (Scan) ---
    if (config.NUGGETS_CHANNEL_ID && message.channel.id === config.NUGGETS_CHANNEL_ID) {
        const attachments = message.attachments.filter(a => a.contentType && a.contentType.startsWith('image/'));
        if (attachments.size === 0) return;

        const msgRef = await message.reply("💎 Analyse des pépites en cours...");
        
        try {
            const attachment = attachments.first();
            const image = await Jimp.read(attachment.url);
            
            // Pré-traitement image
            image.greyscale().invert().contrast(0.25).scale(1.5);
            const processedBuffer = await image.getBufferAsync("image/png");
            
            const result = await Tesseract.recognize(processedBuffer, 'eng');
            
            // Nettoyage du texte : tout en minuscule + remplacement des accents
            const text = result.data.text.toLowerCase().replace(/é/g, 'e');

            console.log("--- OCR TEXTE LU ---");
            console.log(text);
            console.log("--------------------");

            let extractedAmount = 0;
            const lines = text.split('\n');
            
            for (const line of lines) {
                // REGEX STRICTE : [pepite] et 123
                // \[      -> Crochet ouvrant
                // \s* -> Espaces possibles
                // p.pite  -> Mot clé (le . accepte 'a' ou 'e' si mal lu)
                // \s* -> Espaces possibles
                // \]      -> Crochet fermant
                // \s*et   -> Mot "et" avec espaces avant
                // \s* -> Espaces après
                // (\d+)   -> Le montant (Chiffres)
                const regex = /\[\s*p.pite\s*\]\s*et\s*(\d+)/;
                
                const match = line.match(regex);
                if (match) {
                    extractedAmount = parseInt(match[1], 10);
                    break;
                }
            }

            if (extractedAmount > 0) {
                const amountToAdd = Math.floor(extractedAmount / 2);
                const discordId = message.author.id;
                
                let targetPseudo = message.author.username;
                const linkCheck = await pool.query('SELECT dofus_pseudo FROM players WHERE discord_id = $1 LIMIT 1', [discordId]);
                if (linkCheck.rows.length > 0) {
                    targetPseudo = linkCheck.rows[0].dofus_pseudo;
                }

                const query = `
                    INSERT INTO players (dofus_pseudo, discord_id, discord_username, bank_nuggets) 
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (dofus_pseudo) 
                    DO UPDATE SET 
                        bank_nuggets = players.bank_nuggets + $4,
                        discord_id = COALESCE(players.discord_id, $2),
                        discord_username = COALESCE(players.discord_username, $3)
                    RETURNING bank_nuggets;
                `;
                
                const res = await pool.query(query, [targetPseudo, discordId, message.author.username, amountToAdd]);
                const newTotal = res.rows[0].bank_nuggets;

                // Message propre avec mention et sans emoji validé
                await msgRef.edit(`<@${message.author.id}> **Pépites enregistrées !**\nMontant lu : ${extractedAmount}\nVotre part (50%) : **${amountToAdd}**\n\n💰 **Banque totale : ${newTotal}**`);

                try {
                    await message.delete();
                } catch (delError) {
                    console.error("Erreur suppression message pépites :", delError);
                }

            } else {
                await msgRef.edit("⚠️ Je n'ai pas trouvé le format exact `[Pépite] et ...`. Vérifiez le screen.");
            }

        } catch (error) {
            console.error(error);
            await msgRef.edit("❌ Erreur lors de l'analyse.");
        }
        return;
    }

    // --- 4. SCAN LEADERBOARD (PvP) ---
    if (message.channel.id !== config.CHANNEL_ID) return;
    const attachments = message.attachments.filter(a => a.contentType && a.contentType.startsWith('image/'));
    if (attachments.size === 0) return;

    let userSession = activeSessions.get(message.author.id) || { winners: [], losers: [], context: null, allianceTier: null };
    const msgRef = await message.reply(`Lecture du classement...`);

    try {
        for (const [id, attachment] of attachments) {
            const image = await Jimp.read(attachment.url);
            image.greyscale().invert().contrast(0.25).scale(1.5);
            const processedBuffer = await image.getBufferAsync("image/png");
            const result = await Tesseract.recognize(processedBuffer, 'eng');
            const parsedPart = parseScreenData(result.data.text);
            if (parsedPart.winners.length > 0) userSession.winners = [...new Set([...userSession.winners, ...parsedPart.winners])];
            if (parsedPart.losers.length > 0) userSession.losers = [...new Set([...userSession.losers, ...parsedPart.losers])];
        }
        activeSessions.set(message.author.id, userSession);

        if (userSession.winners.length > 0 && userSession.losers.length > 0) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('attack').setLabel('⚔️ Attaque').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('defense').setLabel('🛡️ Défense').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('reset').setLabel('Reset').setStyle(ButtonStyle.Secondary)
            );
            await msgRef.edit({ content: `**Complet !**\nGagnants: ${userSession.winners.join(', ')}\nPerdants: ${userSession.losers.join(', ')}`, components: [row] });
        } else {
            await msgRef.edit(`**Resultat partiel**\nGagnants: ${userSession.winners.length} | Perdants: ${userSession.losers.length}`);
        }
    } catch (error) { console.error(error); msgRef.edit("Erreur technique."); }
});

client.on('interactionCreate', async interaction => {
    // --- GESTION PROFIL ---
    if (interaction.isButton() && ['btn_link_char', 'btn_unlink_char'].includes(interaction.customId)) {
        if (interaction.customId === 'btn_link_char') {
            const modal = new ModalBuilder().setCustomId('modal_link').setTitle('Lier un personnage');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pseudoInput').setLabel("Pseudo Dofus").setStyle(TextInputStyle.Short)));
            await interaction.showModal(modal); return;
        }
        if (interaction.customId === 'btn_unlink_char') {
            const modal = new ModalBuilder().setCustomId('modal_unlink').setTitle('Délier un personnage');
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('pseudoInput').setLabel("Pseudo Dofus").setStyle(TextInputStyle.Short)));
            await interaction.showModal(modal); return;
        }
    }

    if (interaction.isModalSubmit()) {
        const pseudo = interaction.fields.getTextInputValue('pseudoInput').trim();
        const discordId = interaction.user.id;
        const discordName = interaction.user.username;

        if (interaction.customId === 'modal_link') {
            try {
                const check = await pool.query('SELECT * FROM players WHERE LOWER(dofus_pseudo) = LOWER($1)', [pseudo]);
                if (check.rows.length === 0) {
                    await pool.query('INSERT INTO players (dofus_pseudo, discord_id, discord_username) VALUES ($1, $2, $3)', [pseudo, discordId, discordName]);
                } else {
                    const existing = check.rows[0];
                    if (existing.discord_id && existing.discord_id !== discordId) return interaction.reply({ content: `❌ Personnage déjà lié à un autre compte.`, ephemeral: true });
                    await pool.query('UPDATE players SET discord_id = $1, discord_username = $2 WHERE LOWER(dofus_pseudo) = LOWER($3)', [discordId, discordName, pseudo]);
                }
                await interaction.reply({ content: `✅ **${pseudo}** lié !`, ephemeral: true });
                updateLeaderboard();
            } catch (err) { console.error(err); interaction.reply({content: "Erreur.", ephemeral: true}); }
        }
        if (interaction.customId === 'modal_unlink') {
            try {
                const res = await pool.query('UPDATE players SET discord_id = NULL, discord_username = NULL WHERE LOWER(dofus_pseudo) = LOWER($1) AND discord_id = $2', [pseudo, discordId]);
                await interaction.reply({ content: res.rowCount > 0 ? `✅ **${pseudo}** délié.` : `❌ Erreur ou ce n'est pas votre perso.`, ephemeral: true });
                updateLeaderboard();
            } catch (err) { console.error(err); interaction.reply({content: "Erreur.", ephemeral: true}); }
        }
        return;
    }

    // --- LOGIQUE COMBAT ---
    const userSession = activeSessions.get(interaction.user.id);
    if ((!userSession && interaction.isButton() && interaction.customId === 'reset') || 
        (interaction.isStringSelectMenu() && !userSession)) {
        return interaction.reply({ content: "Session expirée.", ephemeral: true });
    }
    if (!userSession) return;

    if (interaction.isButton() && interaction.customId === 'reset') {
        activeSessions.delete(interaction.user.id);
        return interaction.update({ content: "Session effacee.", components: [] });
    }

    // ETAPE 1 : CHOIX ATTAQUE / DEFENSE -> AFFICHE MENU SELECTEUR
    if (interaction.isButton() && (interaction.customId === 'attack' || interaction.customId === 'defense')) {
        userSession.context = interaction.customId; 
        
        // On crée le menu déroulant
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_alliance_bonus')
            .setPlaceholder('Choisissez l\'Alliance adverse')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Standard / Autre')
                    .setDescription('Combat classique (Aucun bonus)')
                    .setValue('standard'),
                new StringSelectMenuOptionBuilder()
                    .setLabel(`Pool 1 (+${config.BONUSES.pool_1} pts)`)
                    .setDescription(config.POOL_NAMES.pool_1.substring(0, 100))
                    .setValue('pool_1'),
                new StringSelectMenuOptionBuilder()
                    .setLabel(`Pool 2 (+${config.BONUSES.pool_2} pts)`)
                    .setDescription(config.POOL_NAMES.pool_2.substring(0, 100))
                    .setValue('pool_2'),
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);
        await interaction.update({ content: `Mode : **${interaction.customId === 'attack' ? 'Attaque' : 'Défense'}**.\nContre quel type d'alliance ?`, components: [row] });
    }

    // ETAPE 2 : CHOIX ALLIANCE (SELECTEUR) -> AFFICHE BOUTONS RESULTAT
    else if (interaction.isStringSelectMenu() && interaction.customId === 'select_alliance_bonus') {
        userSession.allianceTier = interaction.values[0]; 

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('result_win').setLabel('🏆 VICTOIRE').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('result_lose').setLabel('☠️ DÉFAITE').setStyle(ButtonStyle.Danger)
        );

        let allianceLabel = "Standard";
        if (userSession.allianceTier === 'pool_1') allianceLabel = "Pool 1";
        if (userSession.allianceTier === 'pool_2') allianceLabel = "Pool 2";

        await interaction.update({ content: `Config : **${userSession.context}** vs **${allianceLabel}**.\nRésultat du combat ?`, components: [row] });
    }

    // ETAPE 3 : CALCULE ET SAUVEGARDE
    else if (interaction.isButton() && (interaction.customId === 'result_win' || interaction.customId === 'result_lose')) {
        await interaction.deferUpdate();
        const hasWon = interaction.customId === 'result_win';
        
        const myTeam = hasWon ? userSession.winners : userSession.losers;
        const enemyTeam = hasWon ? userSession.losers : userSession.winners;
        
        if (!myTeam || myTeam.length === 0) return interaction.editReply({ content: "Erreur: Impossible d'identifier votre équipe.", components: [] });

        const myCount = myTeam.length;
        const enemyCount = enemyTeam.length;
        const gap = myCount - enemyCount; 

        // 1. REGLE ANTI-FARMING (Annulation)
        if (gap >= config.MAX_PLAYER_GAP_FOR_CANCEL) {
             return interaction.editReply({ 
                content: `🛑 **Combat non comptabilisé**.\nÉcart de joueurs trop important (${myCount} vs ${enemyCount}). Combat considéré comme déséquilibré.`, 
                components: [] 
            });
        }

        let pointsToAdd = 0;
        let basePoints = 0;

        // 2. Score de BASE (Fixe selon config.js)
        try {
            basePoints = config.BASE_SCORES[userSession.context]; // 4 ou 6
        } catch (e) { basePoints = 0; }

        // 3. Modificateur Victoire/Défaite
        if (hasWon) {
            basePoints += config.WIN_MODIFIER;
        } else {
            basePoints -= config.LOSE_MODIFIER;
        }

        // 4. Bonus d'Infériorité numérique
        let heroBonus = 0;
        if (gap < 0) {
            heroBonus = config.INFERIORITY_BONUS;
        }

        // 5. Bonus Alliance
        let allianceBonus = 0;
        if (userSession.allianceTier === 'pool_1') allianceBonus = config.BONUSES.pool_1;
        if (userSession.allianceTier === 'pool_2') allianceBonus = config.BONUSES.pool_2;

        pointsToAdd = basePoints + heroBonus + allianceBonus;

        if (pointsToAdd < 0) pointsToAdd = 0;

        for (const pseudo of myTeam) await updatePlayerPoints(pseudo, pointsToAdd);

        try {
            // On convertit les tableaux de pseudos en texte (ex: "Joueur1,Joueur2")
            const winnersStr = userSession.winners.join(',');
            const losersStr = userSession.losers.join(',');
            
            // On insère le combat dans la BDD
            await pool.query(
                "INSERT INTO matches (winners, losers) VALUES ($1, $2)", 
                [winnersStr, losersStr]
            );
            console.log("Combat sauvegardé dans l'historique.");
        } catch (err) {
            console.error("Erreur sauvegarde match:", err);
        }

        await updateLeaderboard();

        activeSessions.delete(interaction.user.id);
        
        const resultText = hasWon ? "VICTOIRE" : "DÉFAITE";
        const heroText = heroBonus > 0 ? `+ Bonus Héroïque (${heroBonus})` : '';
        const alliText = allianceBonus > 0 ? `+ Bonus Alli (${allianceBonus})` : '';
        
        await interaction.editReply({ 
            content: `✅ **Enregistré !**\n` +
                     `Résultat: ${resultText} | Mode: ${userSession.context} | Joueurs: ${myCount} vs ${enemyCount}\n` +
                     `Calcul: Base ${hasWon ? '(Victoire)' : '(Défaite)'} ${heroText} ${alliText}\n` +
                     `👉 **${pointsToAdd} pts** attribués à : ${myTeam.join(', ')}`, 
            components: [] 
        });
    }
});

// --- FONCTIONS DB & UTILS ---
async function updatePlayerPoints(pseudo, points) {
    const { currentSeason } = getSeasons();
    const queryGlobal = `INSERT INTO players (dofus_pseudo, total_points) VALUES ($1, $2) ON CONFLICT (dofus_pseudo) DO UPDATE SET total_points = players.total_points + $2;`;
    await pool.query(queryGlobal, [pseudo, points]);
    const querySeason = `INSERT INTO season_points (dofus_pseudo, season_id, points) VALUES ($1, $2, $3) ON CONFLICT (dofus_pseudo, season_id) DO UPDATE SET points = season_points.points + $3;`;
    await pool.query(querySeason, [pseudo, currentSeason, points]);
}

async function updateLeaderboard() {
    try {
        const query = `SELECT COALESCE(MAX(discord_username), MAX(dofus_pseudo)) as display_name, SUM(total_points) as total_points FROM players GROUP BY COALESCE(discord_id, dofus_pseudo) ORDER BY total_points DESC LIMIT 10`;
        const res = await pool.query(query);
        if (res.rows.length === 0) return;
        let description = "";
        const medals = ['1.', '2.', '3.'];
        res.rows.forEach((row, index) => {
            const medal = index < 3 ? medals[index] : `**${index + 1}.**`;
            description += `${medal} **${row.display_name}** - \`${row.total_points} pts\`\n`;
        });
        const embed = new EmbedBuilder().setColor(0x0099FF).setTitle('CLASSEMENT ALLIANCE (Joueurs)').setDescription(description).setFooter({ text: `Update: ${new Date().toLocaleString('fr-FR')}` }).setThumbnail('https://upload.wikimedia.org/wikipedia/fr/3/3a/Dofus_Logo.png');
        const channel = await client.channels.fetch(config.LEADERBOARD_CHANNEL_ID);
        if (!channel) return;
        const messages = await channel.messages.fetch({ limit: 10 });
        const lastBotMessage = messages.find(msg => msg.author.id === client.user.id && !msg.system && msg.embeds.length > 0);
        if (lastBotMessage) await lastBotMessage.edit({ embeds: [embed] });
        else await channel.send({ embeds: [embed] });
    } catch (error) { console.error("Erreur Leaderboard:", error); }
}

function parseScreenData(text) {
    const lines = text.split('\n');
    const winners = []; const losers = [];
    let currentSection = 'winners';
    if (text.substring(0, 100).toUpperCase().includes('PERDANTS')) currentSection = 'losers';
    lines.forEach((line) => {
        const upperLine = line.toUpperCase().trim();
        if (!upperLine) return;
        if (upperLine.includes('GAGNANT') || upperLine.includes('WINNER')) { currentSection = 'winners'; return; }
        if (upperLine.includes('PERDANT') || upperLine.includes('LOSER')) { currentSection = 'losers'; return; }
        if (line.length < 3) return;
        const cleanLine = line.replace(/[\[\]\(\)\|\@\:\.\,\*\+\!]/g, ' '); 
        const rawWords = cleanLine.split(/\s+/);
        let validNameParts = [];
        for (const w of rawWords) {
            let word = w.replace(/[^a-zA-Z0-9-]/g, '').replace(/^\d+/, '');
            if (word.length < 3 || config.STOP_WORDS.includes(word.toLowerCase()) || config.BANNED_WORDS.includes(word.toLowerCase())) continue;
            if (word.length <= 4 && /\d/.test(word)) continue;
            validNameParts.push(word);
        }
        if (validNameParts.length === 1 && !/^\d+$/.test(validNameParts[0])) {
            if (currentSection === 'winners') winners.push(validNameParts[0]); else losers.push(validNameParts[0]);
        }
    });
    return { winners, losers };
}

client.login(process.env.DISCORD_TOKEN);