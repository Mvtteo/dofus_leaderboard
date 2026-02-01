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

        const result = await pool.query(query);
        
        // 2. Récupérer tous les matches pour calculer le winrate
        const matchesResult = await pool.query('SELECT winners, losers FROM matches');
        
        // 3. Calculer wins/losses pour chaque pseudo
        const playerStats = {};
        for (const match of matchesResult.rows) {
            const winners = match.winners ? match.winners.split(',').map(p => p.trim().toLowerCase()) : [];
            const losers = match.losers ? match.losers.split(',').map(p => p.trim().toLowerCase()) : [];
            
            for (const pseudo of winners) {
                if (!playerStats[pseudo]) playerStats[pseudo] = { wins: 0, losses: 0 };
                playerStats[pseudo].wins++;
            }
            for (const pseudo of losers) {
                if (!playerStats[pseudo]) playerStats[pseudo] = { wins: 0, losses: 0 };
                playerStats[pseudo].losses++;
            }
        }
        
        // 4. Construire la liste des joueurs avec winrate
        const players = result.rows.map(p => {
            const pseudoLower = (p.main_char || p.display_name).toLowerCase();
            const stats = playerStats[pseudoLower] || { wins: 0, losses: 0 };
            const totalGames = stats.wins + stats.losses;
            const winrate = totalGames > 0 ? Math.round((stats.wins / totalGames) * 100) : 0;
            
            return {
                dofus_pseudo: p.display_name,
                total_points: parseInt(p.total_points),
                wins: stats.wins,
                losses: stats.losses,
                winrate: winrate
            };
        });

        // 5. Calcul des totaux
        const totalPoints = players.reduce((sum, p) => sum + p.total_points, 0);
        const totalCombats = matchesResult.rows.length;

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

app.listen(config.WEB_PORT, () => {
    console.log(`Web server running on port ${config.WEB_PORT}`);
});

app.get('/api/leaderboard/:seasonId', async (req, res) => {
    try {
        const seasonId = req.params.seasonId;
        const query = `
            SELECT 
                COALESCE(MAX(p.discord_username), MAX(sp.dofus_pseudo)) as dofus_pseudo,
                SUM(sp.points) as total_points,
                MAX(sp.dofus_pseudo) as main_char
            FROM season_points sp
            LEFT JOIN players p ON sp.dofus_pseudo = p.dofus_pseudo
            WHERE sp.season_id = $1
            GROUP BY COALESCE(p.discord_id, sp.dofus_pseudo)
            ORDER BY total_points DESC
        `;
        const result = await pool.query(query, [seasonId]);
        
        // Calculer le winrate (global, pas par saison)
        const matchesResult = await pool.query('SELECT winners, losers FROM matches');
        const playerStats = {};
        for (const match of matchesResult.rows) {
            const winners = match.winners ? match.winners.split(',').map(p => p.trim().toLowerCase()) : [];
            const losers = match.losers ? match.losers.split(',').map(p => p.trim().toLowerCase()) : [];
            for (const pseudo of winners) {
                if (!playerStats[pseudo]) playerStats[pseudo] = { wins: 0, losses: 0 };
                playerStats[pseudo].wins++;
            }
            for (const pseudo of losers) {
                if (!playerStats[pseudo]) playerStats[pseudo] = { wins: 0, losses: 0 };
                playerStats[pseudo].losses++;
            }
        }
        
        const players = result.rows.map(p => {
            const pseudoLower = (p.main_char || p.dofus_pseudo).toLowerCase();
            const stats = playerStats[pseudoLower] || { wins: 0, losses: 0 };
            const totalGames = stats.wins + stats.losses;
            const winrate = totalGames > 0 ? Math.round((stats.wins / totalGames) * 100) : 0;
            return {
                dofus_pseudo: p.dofus_pseudo,
                total_points: p.total_points,
                wins: stats.wins,
                losses: stats.losses,
                winrate: winrate
            };
        });
        
        res.json(players);
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

            image.scale(3);
            image.greyscale();
            image.invert();
            image.threshold({ max: 180 });
            
            const processedBuffer = await image.getBufferAsync("image/png");
            
            const result = await Tesseract.recognize(processedBuffer, 'eng');
            
            // Nettoyage : tout sur une seule ligne pour gérer les sauts de ligne
            const text = result.data.text.toLowerCase().replace(/é/g, 'e');
            const fullText = text.replace(/[\n\r]+/g, ' ');

            // 1. DÉTECTION TYPE "ALLIANCE" (ex: "L'alliance a généré 2000 pépites")
            let allianceAmount = 0;
            if (fullText.includes('alliance')) {
                const numbers = fullText.match(/\d+/g);
                if (numbers) {
                    // On prend le plus grand nombre trouvé
                    allianceAmount = Math.max(...numbers.map(n => parseInt(n, 10)));
                }
            }

            // 2. DÉTECTION TYPE "PERSONNEL" (ex: "[pepite] et 500")
            // On utilise fullText pour que ça marche même si "et 500" est à la ligne
            let extractedAmount = 0;
            // Regex améliorée : cherche "[pepite]" suivi éventuellement de texte, puis un nombre
            const regex = /\[\s*p.pite\s*\]\s*.*?(\d+)/;
            const match = fullText.match(regex);
            
            if (match) {
                extractedAmount = parseInt(match[1], 10);
            }

            // 3. CHOIX DU MONTANT FINAL
            // On priorise le montant précis ([pepite]), sinon on prend le montant Alliance
            let finalBaseAmount = 0;
            if (extractedAmount > 0) {
                finalBaseAmount = extractedAmount;
            } else if (allianceAmount > 0) {
                finalBaseAmount = allianceAmount;
            }

            if (finalBaseAmount > 0) {
                const amountToAdd = Math.floor(finalBaseAmount / 2);
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

                // Message propre
                await msgRef.edit(`<@${message.author.id}> **Pépites enregistrées !**\nMontant lu : ${finalBaseAmount}\nVotre part (50%) : **${amountToAdd}**\n\n💰 **Banque totale : ${newTotal}**`);

                try {
                    await message.delete();
                } catch (delError) {
                    console.error("Erreur suppression message pépites :", delError);
                }

            } else {
                await msgRef.edit("⚠️ Je n'ai pas réussi à lire le montant (Alliance ou Personnel). Assurez-vous que le screen est clair.");
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

            // --- TRAITEMENT OPTIMISÉ (Douceur + Résolution) ---
            // 1. Zoom x4 : Crucial pour que "Bella" soit assez gros
            image.scale(4); 
            
            // 2. Noir et Blanc
            image.greyscale();
            
            // 3. Inversion (Texte noir sur fond blanc)
            image.invert();
            
            // 4. Contraste MOYEN (0.5 au lieu de 1). 
            // 1 détruisait les lettres fines ('l', 'i', 'T'). 0.5 nettoie le gris sans casser les lettres.
            image.contrast(0.5); 
            
            // 5. On enlève un peu de luminosité pour que le texte noir soit bien noir
            image.brightness(-0.1);

            const processedBuffer = await image.getBufferAsync("image/png");

            // --- TESSERACT ---
            const result = await Tesseract.recognize(processedBuffer, 'eng', {
                logger: m => {},
                // On garde la whitelist pour forcer la propreté
                tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
                // PSM 11 est toujours le meilleur pour les listes éparpillées
                tessedit_pageseg_mode: '11' 
            });

            console.log("========================================");
            console.log("📸 TEXTE LU (Zoom x4 / Soft Contrast) :");
            console.log(result.data.text);
            console.log("========================================");

            // ... (Après le Tesseract.recognize et le console.log du texte brut) ...

            const parsedPart = parseScreenData(result.data.text);

            // --- AJOUT : AFFICHAGE DEBUG DES JOUEURS RECONNUS ---
            console.log("----------------------------------------");
            console.log("✅ RÉSULTAT DU PARSING :");
            console.log("🏆 GAGNANTS :", parsedPart.winners.join(', '));
            console.log("☠️ PERDANTS :", parsedPart.losers.join(', '));
            console.log("----------------------------------------");
            // ----------------------------------------------------

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
    // --- BLOC DE SÉCURITÉ GLOBAL (Empêche le crash) ---
    try {
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
            }
            if (interaction.customId === 'modal_unlink') {
                const res = await pool.query('UPDATE players SET discord_id = NULL, discord_username = NULL WHERE LOWER(dofus_pseudo) = LOWER($1) AND discord_id = $2', [pseudo, discordId]);
                await interaction.reply({ content: res.rowCount > 0 ? `✅ **${pseudo}** délié.` : `❌ Erreur ou ce n'est pas votre perso.`, ephemeral: true });
                updateLeaderboard();
            }
            return;
        }

        // --- LOGIQUE COMBAT ---
        const userSession = activeSessions.get(interaction.user.id);

        const combatButtons = ['attack', 'defense', 'reset', 'result_win', 'result_lose'];
        
        // Gestion des sessions expirées ou inexistantes
        if (!userSession && (
            (interaction.isButton() && combatButtons.includes(interaction.customId)) ||
            interaction.isStringSelectMenu()
        )) {
            // On répond proprement pour que Discord n'affiche pas "Echec"
            return interaction.reply({ 
                content: "**Session expirée.**\nLe bot a redémarré ou l'attente a été trop longue.\n👉 **Renvoyez vos screens.**", 
                ephemeral: true 
            });
        }
        
        if (!userSession) return; // Sécurité finale

        if (interaction.isButton() && interaction.customId === 'reset') {
            activeSessions.delete(interaction.user.id);
            return interaction.update({ content: "Session effacee.", components: [] });
        }

        // ETAPE 1 : CHOIX ATTAQUE / DEFENSE
        if (interaction.isButton() && (interaction.customId === 'attack' || interaction.customId === 'defense')) {
            userSession.context = interaction.customId; 
            
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_alliance_bonus')
                .setPlaceholder('Choisissez l\'Alliance adverse')
                .addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel('Standard / Autre')
                        .setDescription('Combat classique')
                        .setValue('standard'),
                    
                    // MODIFICATION ICI : On affiche directement le nom de l'alliance (sans le barème)
                    new StringSelectMenuOptionBuilder()
                        .setLabel(config.POOL_NAMES.pool_1.substring(0, 100)) // .substring évite le crash si nom > 100 caractères
                        .setValue('pool_1'), // On garde l'ID technique pour le code

                    new StringSelectMenuOptionBuilder()
                        .setLabel(config.POOL_NAMES.pool_2.substring(0, 100))
                        .setValue('pool_2'),
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);
            await interaction.update({ content: `Mode : **${interaction.customId === 'attack' ? 'Attaque' : 'Défense'}**.\nContre quel type d'alliance ?`, components: [row] });
        }

        // ETAPE 2 : CHOIX ALLIANCE
        else if (interaction.isStringSelectMenu() && interaction.customId === 'select_alliance_bonus') {
            userSession.allianceTier = interaction.values[0]; 

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('result_win').setLabel('🏆 VICTOIRE').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('result_lose').setLabel('☠️ DÉFAITE').setStyle(ButtonStyle.Danger)
            );

            let allianceLabel = "Standard";
            // On récupère le nom propre directement de la config
            if (userSession.allianceTier === 'pool_1') allianceLabel = config.POOL_NAMES.pool_1;
            if (userSession.allianceTier === 'pool_2') allianceLabel = config.POOL_NAMES.pool_2;

            await interaction.update({ content: `Config : **${userSession.context}** vs **${allianceLabel}**.\nRésultat du combat ?`, components: [row] });
        }

        // ETAPE 3 : CALCULE ET SAUVEGARDE
        else if (interaction.isButton() && (interaction.customId === 'result_win' || interaction.customId === 'result_lose')) {
            await interaction.deferUpdate(); // Indique à Discord qu'on réfléchit (évite le timeout)
            
            const hasWon = interaction.customId === 'result_win';
            const myTeam = hasWon ? userSession.winners : userSession.losers;
            const enemyTeam = hasWon ? userSession.losers : userSession.winners;
            
            if (!myTeam || myTeam.length === 0) return interaction.editReply({ content: "Erreur: Impossible d'identifier votre équipe.", components: [] });

            const myCount = myTeam.length;
            const enemyCount = enemyTeam.length;
            const gap = myCount - enemyCount; 

            if (gap >= config.MAX_PLAYER_GAP_FOR_CANCEL) {
                return interaction.editReply({ content: `🛑 **Combat non comptabilisé** (Écart trop grand: ${myCount} vs ${enemyCount}).`, components: [] });
            }

            let basePoints = 0;
            try { basePoints = config.BASE_SCORES[userSession.context]; } catch (e) { basePoints = 0; }
            if (hasWon) basePoints += config.WIN_MODIFIER; else basePoints -= config.LOSE_MODIFIER;

            let heroBonus = (gap < 0) ? config.INFERIORITY_BONUS : 0;
            let allianceBonus = 0;
            if (userSession.allianceTier === 'pool_1') allianceBonus = config.BONUSES.pool_1;
            if (userSession.allianceTier === 'pool_2') allianceBonus = config.BONUSES.pool_2;

            let pointsToAdd = Math.max(0, basePoints + heroBonus + allianceBonus);

            for (const pseudo of myTeam) await updatePlayerPoints(pseudo, pointsToAdd);

            // Sauvegarde historique
            const winnersStr = userSession.winners.join(',');
            const losersStr = userSession.losers.join(',');
            await pool.query("INSERT INTO matches (winners, losers) VALUES ($1, $2)", [winnersStr, losersStr]);

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
    } catch (error) {
        // --- C'EST ICI QUE LE CRASH EST EVITÉ ---
        // Si Discord renvoie "Unknown interaction" (10062), on l'ignore juste.
        if (error.code === 10062) {
            console.warn(`⚠️ Interaction expirée ou inconnue (User: ${interaction.user.username}). Pas grave.`);
        } else {
            console.error("❌ Erreur critique dans interactionCreate :", error);
            // On essaie de prévenir l'utilisateur si possible
            try {
                if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: "Une erreur est survenue.", ephemeral: true });
            } catch (e) {}
        }
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

    // Détection large de la section perdants
    if (text.substring(0, 300).toUpperCase().includes('PERDANTS') || text.substring(0, 300).toUpperCase().includes('LOSERS')) {
        // La gestion se fera ligne par ligne ci-dessous
    }

    lines.forEach((line) => {
        const upperLine = line.toUpperCase().trim();
        if (!upperLine) return;

        // 1. Détection des sections
        if (upperLine.includes('GAGNANT') || upperLine.includes('WINNER')) { currentSection = 'winners'; return; }
        if (upperLine.includes('PERDANT') || upperLine.includes('LOSER')) { currentSection = 'losers'; return; }
        
        // 2. Ignorer les en-têtes
        if (upperLine.includes('NIVEAU') || upperLine.includes('EXPERIENCE') || upperLine.includes('BUTIN')) return;

        // --- 🛡️ BOUCLIER ANTI-MOB (Perco / Prisme) ---
        // Règle 1 : Si ça contient "PRISME", on jette.
        // Règle 2 : Si ça contient "DO'" (le nom des percepteurs contient toujours Do'), on jette.
        // Règle 3 : Les pseudos de joueurs n'ont jamais d'apostrophe. Si on voit une apostrophe, c'est un mob.
        if (upperLine.includes('PRISME') || upperLine.includes("DO'") || line.includes("'")) {
            console.log(`🚫 Entité ignorée (Mob/Perco/Prisme) : ${line}`);
            return; 
        }
        // ----------------------------------------------

        // 3. Nettoyage de la ligne
        // On enlève les caractères spéciaux MAIS on garde les tirets (-) car les joueurs en ont.
        const cleanLine = line.replace(/[\[\]\(\)\|\@\:\.\,\*\+\!\?\/\\_]/g, ' '); 
        const rawWords = cleanLine.split(/\s+/); 
        
        let candidates = []; 
        let foundKnownPlayer = null; 

        for (const w of rawWords) {
            // Nettoyage individuel
            let word = w.replace(/[^a-zA-Z0-9-]/g, ''); 
            word = word.replace(/^\d+/, ''); // Vire les chiffres au début (ex: 199Pseudo)
            let lowerWord = word.toLowerCase();

            // Filtres de base
            if (word.length < 3) continue;
            if (config.STOP_WORDS.includes(lowerWord) || config.BANNED_WORDS.includes(lowerWord)) continue;
            
            // On vire les nombres isolés (ex: "200")
            if (/^\d+$/.test(word)) continue; 
            if (word.length <= 3 && /\d/.test(word)) continue; 

            // --- RECHERCHE INTELLIGENTE (DB) ---
            if (typeof knownPlayerNames !== 'undefined' && knownPlayerNames.length > 0) {
                // Exact match
                if (knownPlayerNames.includes(lowerWord)) {
                    foundKnownPlayer = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
                    break; 
                }

                // Match approximatif (Levenshtein)
                let bestMatch = null;
                let minDist = 3; 
                for (const knownName of knownPlayerNames) {
                    if (Math.abs(knownName.length - lowerWord.length) > 2) continue; 
                    const dist = levenshteinDistance(lowerWord, knownName);
                    if (dist < minDist) {
                        minDist = dist;
                        bestMatch = knownName;
                    }
                }

                if (bestMatch) {
                    console.log(`🔧 Correction auto : ${word} -> ${bestMatch}`);
                    foundKnownPlayer = bestMatch; 
                    break; 
                }
            }
            
            // Si pas connu, on l'ajoute aux candidats
            const formattedCandidate = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
            candidates.push(formattedCandidate);
        }

        // --- DÉCISION FINALE ---
        let finalName = null;

        if (foundKnownPlayer) {
            finalName = foundKnownPlayer;
        } else if (candidates.length > 0) {
            // Si on ne connait personne, on prend le premier candidat valide
            finalName = candidates[0];
        }

        if (finalName) {
            if (currentSection === 'winners') winners.push(finalName); 
            else losers.push(finalName);
        }
    });

    return { winners, losers };
}

client.login(process.env.DISCORD_TOKEN);