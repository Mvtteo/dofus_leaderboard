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
    // ⚙️ DATE DE LANCEMENT (Saison 1)
    const INITIAL_DATE = new Date('2026-02-01T00:00:00'); 
    const DAYS_PER_SEASON = 14; // 2 semaines

    const now = new Date();
    const seasons = [];
    
    let loopDate = new Date(INITIAL_DATE);
    let id = 1;
    let currentSeasonId = 1;

    while (true) {
        const start = new Date(loopDate);

        // 🛑 STOP STRICT : Si la saison commence dans le futur, on ne l'affiche PAS.
        // C'est cette ligne qui empêche la "Saison 2" d'apparaître tant qu'on n'est pas le 15 février.
        if (start > now) break;

        // Calcul de la fin (Début + 14 jours - 1ms)
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

        // On avance de 14 jours pour le prochain tour de boucle
        loopDate.setDate(loopDate.getDate() + DAYS_PER_SEASON);
        id++;
        
        // Sécurité anti-crash
        if (id > 1000) break;
    }

    // Cas particulier : Si on est AVANT le lancement du serveur (date < INITIAL_DATE),
    // la liste "seasons" est vide. On force l'affichage de la Saison 1 (futur) pour ne pas buguer.
    if (seasons.length === 0) {
        const end = new Date(INITIAL_DATE);
        end.setDate(end.getDate() + DAYS_PER_SEASON);
        seasons.push({ id: 1, label: `Saison 1 (Bientôt)`, start: INITIAL_DATE, end: end, isCurrent: true });
        currentSeasonId = 1;
    }

    return { seasons, currentSeason: currentSeasonId };
}

app.get('/', async (req, res) => {
    try {
        // 1. Récupération du classement (Filtré > 0)
        const query = `
            SELECT 
                COALESCE(MAX(discord_nickname), MAX(discord_username), MAX(dofus_pseudo)) as display_name,
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
        if (message.channel.id !== config.PROFILE_CHANNEL_ID) message.reply(`Panneau envoyé.`);
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
            description += `**Top Contributeurs :**\n`;

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
                .setTitle('Banque des Pépites (Alliance)')
                .setColor(0xFFA500) // Orange
                .setDescription(description)
                .setTimestamp();

            return message.reply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            return message.reply("Erreur lors de la récupération de la banque.");
        }
    }

    // --- 3. GESTION DES PEPITES (Scan) ---
    // --- 3. GESTION DES PEPITES (Scan) ---
    if (config.NUGGETS_CHANNEL_ID && message.channel.id === config.NUGGETS_CHANNEL_ID) {
        const attachments = message.attachments.filter(a => a.contentType && a.contentType.startsWith('image/'));
        if (attachments.size === 0) return;

        const msgRef = await message.reply("Analyse des pépites en cours...");
        
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
                await msgRef.edit(`<@${message.author.id}> **Pépites enregistrées !**\nMontant lu : ${finalBaseAmount}\nVotre part (50%) : **${amountToAdd}**\n\n **Banque totale : ${newTotal}**`);

                try {
                    await message.delete();
                } catch (delError) {
                    console.error("Erreur suppression message pépites :", delError);
                }

            } else {
                await msgRef.edit("Je n'ai pas réussi à lire le montant (Alliance ou Personnel). Assurez-vous que le screen est clair.");
            }

        } catch (error) {
            console.error(error);
            await msgRef.edit("Erreur lors de l'analyse.");
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

            // --- TRAITEMENT OPTIMISÉ V2 ---
            // 1. Zoom x5 (augmenté de x4) - meilleure resolution pour les petits caracteres
            image.scale(5); 
            
            // 2. Noir et Blanc
            image.greyscale();
            
            // 3. Augmenter le contraste AVANT inversion
            image.contrast(0.6);
            
            // 4. Inversion (Texte noir sur fond blanc)
            image.invert();
            
            // 5. Seuillage - force le noir/blanc (Jimp threshold)
            image.threshold({ max: 150 });

            const processedBuffer = await image.getBufferAsync("image/png");

            // --- TESSERACT ---
            const result = await Tesseract.recognize(processedBuffer, 'eng', {
                logger: m => {},
                // Whitelist avec apostrophe et tiret pour les pseudos Dofus
                tessedit_char_whitelist: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'",
                // PSM 6 = bloc de texte uniforme (meilleur pour les tableaux)
                tessedit_pageseg_mode: '6'
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
                new ButtonBuilder().setCustomId('attack').setLabel('Attaque').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('defense').setLabel('Defense').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('correct').setLabel('Corriger').setStyle(ButtonStyle.Secondary),
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
            // --- MODAL CORRECTION PSEUDOS ---
            if (interaction.customId === 'modal_correct') {
                const winnersRaw = interaction.fields.getTextInputValue('winnersInput');
                const losersRaw = interaction.fields.getTextInputValue('losersInput');
                
                const newWinners = winnersRaw.split(',').map(p => p.trim()).filter(p => p.length > 0);
                const newLosers = losersRaw.split(',').map(p => p.trim()).filter(p => p.length > 0);
                
                const userSession = activeSessions.get(interaction.user.id);
                if (!userSession) {
                    return interaction.reply({ content: "Session expirée. Renvoyez vos screens.", ephemeral: true });
                }
                
                userSession.winners = newWinners;
                userSession.losers = newLosers;
                activeSessions.set(interaction.user.id, userSession);
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('attack').setLabel('Attaque').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('defense').setLabel('Defense').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('correct').setLabel('Corriger').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('reset').setLabel('Reset').setStyle(ButtonStyle.Secondary)
                );
                
                await interaction.reply({ 
                    content: `**Corrige !**\nGagnants: ${newWinners.join(', ')}\nPerdants: ${newLosers.join(', ')}`, 
                    components: [row] 
                });
                return;
            }
            
            // --- MODALS PROFIL (link/unlink) ---
            const pseudo = interaction.fields.getTextInputValue('pseudoInput').trim();
            const discordId = interaction.user.id;
            const discordName = interaction.user.username;

            if (interaction.customId === 'modal_link') {
                // On récupère le Surnom (Display Name) au lieu du Username
                const discordNickname = interaction.member.displayName; // <--- C'est ici que la magie opère (Sino)
                
                const check = await pool.query('SELECT * FROM players WHERE LOWER(dofus_pseudo) = LOWER($1)', [pseudo]);
                
                if (check.rows.length === 0) {
                    // Création
                    await pool.query(
                        'INSERT INTO players (dofus_pseudo, discord_id, discord_username, discord_nickname) VALUES ($1, $2, $3, $4)', 
                        [pseudo, discordId, discordName, discordNickname]
                    );
                } else {
                    // Mise à jour
                    const existing = check.rows[0];
                    if (existing.discord_id && existing.discord_id !== discordId) return interaction.reply({ content: `Personnage déjà lié à un autre compte.`, ephemeral: true });
                    
                    await pool.query(
                        'UPDATE players SET discord_id = $1, discord_username = $2, discord_nickname = $3 WHERE LOWER(dofus_pseudo) = LOWER($4)', 
                        [discordId, discordName, discordNickname, pseudo]
                    );
                }
                await interaction.reply({ content: `**${pseudo}** lié à **${discordNickname}** !`, ephemeral: true });
            }
            if (interaction.customId === 'modal_unlink') {
                const res = await pool.query('UPDATE players SET discord_id = NULL, discord_username = NULL WHERE LOWER(dofus_pseudo) = LOWER($1) AND discord_id = $2', [pseudo, discordId]);
                await interaction.reply({ content: res.rowCount > 0 ? `**${pseudo}** délié.` : `Erreur ou ce n'est pas votre perso.`, ephemeral: true });
            }
            return;
        }

        // --- LOGIQUE COMBAT ---
        const userSession = activeSessions.get(interaction.user.id);

        const combatButtons = ['attack', 'defense', 'reset', 'correct', 'result_win', 'result_lose'];
        
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

        // BOUTON CORRIGER - Ouvre un modal pour editer les pseudos
        if (interaction.isButton() && interaction.customId === 'correct') {
            const modal = new ModalBuilder()
                .setCustomId('modal_correct')
                .setTitle('Corriger les pseudos');
            
            const winnersInput = new TextInputBuilder()
                .setCustomId('winnersInput')
                .setLabel('Gagnants (separes par des virgules)')
                .setStyle(TextInputStyle.Short)
                .setValue(userSession.winners.join(', '))
                .setRequired(true);
            
            const losersInput = new TextInputBuilder()
                .setCustomId('losersInput')
                .setLabel('Perdants (separes par des virgules)')
                .setStyle(TextInputStyle.Short)
                .setValue(userSession.losers.join(', '))
                .setRequired(true);
            
            modal.addComponents(
                new ActionRowBuilder().addComponents(winnersInput),
                new ActionRowBuilder().addComponents(losersInput)
            );
            
            await interaction.showModal(modal);
            return;
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
        
        // 🔒 SÉCURITÉ ANTI-DOUBLE CLIC
        if (!activeSessions.has(interaction.user.id)) {
            return interaction.reply({ content: "🚫 Action déjà traitée ou expirée.", ephemeral: true });
        }
        activeSessions.delete(interaction.user.id); // On verrouille immédiatement

        await interaction.deferUpdate();
        const hasWon = interaction.customId === 'result_win';
        
        const myTeam = hasWon ? userSession.winners : userSession.losers;
        const enemyTeam = hasWon ? userSession.losers : userSession.winners;
        
        if (!myTeam || myTeam.length === 0) return interaction.editReply({ content: "Erreur: Impossible d'identifier votre équipe.", components: [] });

        // --- 📊 NOUVELLE LOGIQUE : MATRICE DE POINTS ---
        
        // On s'assure que les nombres sont entre 1 et 5 (limite du tableau)
        // Si jamais il y a 6 joueurs, on compte comme 5 pour éviter un crash
        const myCount = Math.min(Math.max(myTeam.length, 1), 5); 
        const enemyCount = Math.min(Math.max(enemyTeam.length, 1), 5);

        // Transcription exacte de ton tableau Excel
        const POINTS_MATRIX = {
            WIN: [
                // CXO (Ennemis) -> 1  2  3  4  5
                /* Nous (1) */    [ 2, 4, 5, 5, 5 ],
                /* Nous (2) */    [ 1, 4, 5, 5, 5 ],
                /* Nous (3) */    [ 1, 2, 6, 6, 6 ],
                /* Nous (4) */    [ 1, 2, 3, 8, 8 ],
                /* Nous (5) */    [ 1, 2, 3, 5, 8 ]
            ],
            LOSE: [
                // CXO (Ennemis) -> 1  2  3  4  5
                /* Nous (1) */    [ 1, 2, 3, 3, 3 ],
                /* Nous (2) */    [ 1, 2, 3, 3, 3 ],
                /* Nous (3) */    [ 0, 2, 3, 3, 3 ],
                /* Nous (4) */    [ 0, 0, 3, 4, 4 ],
                /* Nous (5) */    [ 0, 0, 0, 4, 5 ]
            ]
        };

        // On récupère les points de base dans la matrice
        // (On fait -1 car les tableaux informatiques commencent à 0)
        let pointsToAdd = 0;
        if (hasWon) {
            pointsToAdd = POINTS_MATRIX.WIN[myCount - 1][enemyCount - 1];
        } else {
            pointsToAdd = POINTS_MATRIX.LOSE[myCount - 1][enemyCount - 1];
        }

        // --- GESTION DES BONUS ALLIANCE (Pool 1 / Pool 2) ---
        // Ce bonus s'ajoute EN PLUS du tableau si une grosse alliance est sélectionnée
        let allianceBonus = 0;
        if (userSession.allianceTier === 'pool_1') allianceBonus = config.BONUSES.pool_1; // +5
        if (userSession.allianceTier === 'pool_2') allianceBonus = config.BONUSES.pool_2; // +3

        const totalPoints = pointsToAdd + allianceBonus;

        // 💾 SAUVEGARDE EN BDD
        for (const pseudo of myTeam) await updatePlayerPoints(pseudo, totalPoints);

        try {
            const winnersStr = userSession.winners.join(',');
            const losersStr = userSession.losers.join(',');
            await pool.query(
                "INSERT INTO matches (winners, losers) VALUES ($1, $2)", 
                [winnersStr, losersStr]
            );
        } catch (err) { console.error("Erreur save match:", err); }

        // 📝 RÉPONSE FINALE
        const resultText = hasWon ? "VICTOIRE" : "DÉFAITE";
        const alliText = allianceBonus > 0 ? ` (+${allianceBonus} Bonus Alli)` : '';
        
        await interaction.editReply({ 
            content: `✅ **Enregistré !**\n` +
                     `Situation : **${myCount} vs ${enemyCount}** | Résultat : ${resultText}\n` +
                     `Points Tableau : **${pointsToAdd}** pts${alliText}\n` +
                     `👉 **Total : ${totalPoints} pts** attribués à : ${myTeam.join(', ')}`, 
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

function parseScreenData(text) {
    const lines = text.split('\n');
    const winners = []; const losers = [];
    let currentSection = 'winners';

    // Détection section perdants
    if (text.substring(0, 300).toUpperCase().includes('PERDANTS') || text.substring(0, 300).toUpperCase().includes('LOSERS')) {
        // La gestion se fait ligne par ligne ci-dessous
    }

    lines.forEach((line) => {
        const upperLine = line.toUpperCase().trim();
        if (!upperLine) return;

        // 1. Détection des sections
        if (upperLine.includes('GAGNANT') || upperLine.includes('WINNER')) { currentSection = 'winners'; return; }
        if (upperLine.includes('PERDANT') || upperLine.includes('LOSER')) { currentSection = 'losers'; return; }
        
        // 2. Ignorer les en-têtes et le bruit
        if (upperLine.includes('NIVEAU') || upperLine.includes('EXPERIENCE') || upperLine.includes('BUTIN')) return;
        if (upperLine.includes('PERSONNAGE') || upperLine.includes('NOM DE')) return;
        if (upperLine.includes('PRISME') || upperLine.includes("DO'")) return; // Anti-Mob

        // Sécurité : Une ligne de joueur DOIT avoir des stats (XP/KP/RP/PD)
        if (!upperLine.includes('XP') && !upperLine.includes('KP') && !upperLine.includes('RP') && !upperLine.includes('PD')) return;

        // 3. Nettoyage de la ligne
        const cleanLine = line.replace(/[\[\]\(\)\|\@\:\.\,\*\+\!\?\/\\_]/g, ' '); 
        const rawWords = cleanLine.split(/\s+/); 
        
        let candidates = []; 
        let foundKnownPlayer = null; 

        for (const w of rawWords) {
            let word = w.replace(/[^a-zA-Z0-9-]/g, ''); // Garde lettres, chiffres, tirets
            
            // --- 🧹 NETTOYAGE UNIVERSEL ---
            
            // 1. Fix générique pour les pseudos commençant par "I" massacrés (I1, l1, 1z...)
            // Si ça commence par (I, l ou 1) suivi d'un (1) puis d'une lettre...
            // Exemple : "I1zo" -> "Izo", "l1zo" -> "Izo"
            if (/^[Il1]1[a-zA-Z]/.test(word)) {
                word = word.replace(/^[Il1]1/, 'I');
            }
            // Si ça commence par un "1" tout seul suivi d'une lettre (ex: "1zo") -> "Izo"
            else if (/^1[a-zA-Z]{3,}/.test(word)) { 
                // On vérifie qu'il y a au moins 3 lettres derrière pour pas casser les niveaux
                word = 'I' + word.substring(1);
            }

            // 2. Suppression des niveaux collés (ex: "199Nasso" -> "Nasso")
            // (On le fait APRÈS le fix du I pour ne pas transformer "1zo" en "zo")
            word = word.replace(/^\d+/, ''); 
            
            // -----------------------------

            let lowerWord = word.toLowerCase();

            // Filtres de base
            if (word.length < 3) continue;
            if (config.STOP_WORDS.includes(lowerWord) || config.BANNED_WORDS.includes(lowerWord)) continue;
            
            // --- RECHERCHE INTELLIGENTE (DB) ---
            if (typeof knownPlayerNames !== 'undefined' && knownPlayerNames.length > 0) {
                // Exact match
                if (knownPlayerNames.includes(lowerWord)) {
                    foundKnownPlayer = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
                    break; 
                }

                // Match approximatif (Levenshtein)
                // Utile si le nettoyage n'a pas suffit (ex: "Izo" lu "Ize")
                let bestMatch = null;
                let maxErrors = word.length < 5 ? 1 : 2; 
                let minDist = maxErrors + 1; 

                for (const knownName of knownPlayerNames) {
                    if (Math.abs(knownName.length - lowerWord.length) > 2) continue; 
                    const dist = levenshteinDistance(lowerWord, knownName);
                    if (dist < minDist) {
                        minDist = dist;
                        bestMatch = knownName;
                    }
                }

                if (bestMatch && minDist <= maxErrors) {
                    console.log(`🔧 Correction auto : ${word} -> ${bestMatch}`);
                    foundKnownPlayer = bestMatch.charAt(0).toUpperCase() + bestMatch.slice(1).toLowerCase();
                    break; 
                }
            }
            
            // Si inconnu, on l'ajoute aux candidats
            const formattedCandidate = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
            candidates.push(formattedCandidate);
        }

        // --- DÉCISION FINALE ---
        let finalName = null;
        if (foundKnownPlayer) {
            finalName = foundKnownPlayer;
        } else if (candidates.length > 0) {
            // On prend le plus long
            finalName = candidates.reduce((a, b) => a.length >= b.length ? a : b);
        }

        if (finalName) {
            if (currentSection === 'winners') winners.push(finalName); 
            else losers.push(finalName);
        }
    });

    return { winners, losers };
}

client.login(process.env.DISCORD_TOKEN);