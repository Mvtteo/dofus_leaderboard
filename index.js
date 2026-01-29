require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder 
} = require('discord.js');
const Tesseract = require('tesseract.js');
const { Pool } = require('pg');

// --- CHARGEMENT JIMP ---
let Jimp;
try {
    const jimpLib = require('jimp');
    Jimp = jimpLib.Jimp || jimpLib;
} catch (e) {
    console.error("❌ Erreur critique : Jimp mal installé.");
    process.exit(1);
}

// --- CONFIGURATION ---
const POINTS_WIN = 50;
const POINTS_LOSE = 15;
const CHANNEL_ID = process.env.CHANNEL_ID;
const LEADERBOARD_CHANNEL_ID = process.env.LEADERBOARD_CHANNEL_ID || CHANNEL_ID;

const STOP_WORDS = [
    'niveau', 'level', 'lvl', 'xp', 'oxp', 'orp', 'okp', 'kamas', 'butin', 'total', 
    'challenge', 'revanche', 'groupe', 'team', 'combat', 'fin'
];

const BANNED_WORDS = [
    'percepteur', 'prisme', 'prism', 'tax', 'collector', 'archimonstre', 'gardien',
    'gagnant', 'gagnants', 'perdant', 'perdants', 'winners', 'losers', 'vs',
    'nom', 'personnage', 'personage', 'character', 'name', 'exp', 'experience'
];

if (!CHANNEL_ID) {
    console.error("❌ ERREUR : CHANNEL_ID manquant.");
    // On ne coupe pas le process ici pour laisser le bot démarrer et on verra l'erreur dans les logs
}

// --- 1. CONNEXION BASE DE DONNÉES ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // OBLIGATOIRE pour Railway
    }
});

// --- 2. CRÉATION DU CLIENT (C'est ce qui manquait !) ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const activeSessions = new Map();

// --- 3. DÉMARRAGE ET CRÉATION TABLE AUTO ---
client.once('ready', async () => { 
    console.log(`✅ Bot Connecté : ${client.user.tag}`);

    // Création automatique de la table si elle n'existe pas
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS players (
                dofus_pseudo VARCHAR(255) PRIMARY KEY,
                dofus_class VARCHAR(50),
                total_points INT DEFAULT 0
            );
        `);
        console.log("📂 Table 'players' vérifiée/créée.");
    } catch (err) {
        console.error("❌ Erreur BDD (Table):", err);
    }

    updateLeaderboard(); 
});

// --- 4. RÉCEPTION DES IMAGES ---
client.on('messageCreate', async message => {
    if (message.author.bot || message.channel.id !== CHANNEL_ID) return;

    const attachments = message.attachments.filter(a => a.contentType && a.contentType.startsWith('image/'));
    if (attachments.size === 0) return;

    let userSession = activeSessions.get(message.author.id) || { winners: [], losers: [] };
    const msgRef = await message.reply(`🧐 Lecture du classement...`);

    try {
        for (const [id, attachment] of attachments) {
            console.log(`\n--- LECTURE : ${attachment.name} ---`);
            
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
                new ButtonBuilder().setCustomId('attack').setLabel('🗡️ Attaque').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('defense').setLabel('🛡️ Défense').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('reset').setLabel('🗑️ Reset').setStyle(ButtonStyle.Secondary)
            );
            await msgRef.edit({ 
                content: `✅ **Complet !**\nGagnants: ${userSession.winners.join(', ')}\nPerdants: ${userSession.losers.join(', ')}`, 
                components: [row] 
            });
        } else {
            await msgRef.edit(`🔍 **Résultat partiel**\nGagnants: ${userSession.winners.length} | Perdants: ${userSession.losers.length}`);
        }

    } catch (error) {
        console.error(error);
        msgRef.edit("❌ Erreur technique.");
    }
});

// --- 5. INTERACTION BOUTONS ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    const userSession = activeSessions.get(interaction.user.id);
    
    // Si pas de session, on vérifie si c'est un bouton "Attaque/Défense" ou un bouton de résultat
    if (!userSession) {
        return interaction.reply({ content: "❌ Session expirée ou inconnue.", ephemeral: true });
    }

    if (interaction.customId === 'reset') {
        activeSessions.delete(interaction.user.id);
        return interaction.update({ content: "🗑️ Session effacée.", components: [] });
    }

    if (interaction.customId === 'attack' || interaction.customId === 'defense') {
        userSession.context = interaction.customId;
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('result_win').setLabel('🏆 GAGNÉ').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('result_lose').setLabel('💀 PERDU').setStyle(ButtonStyle.Danger)
        );
        await interaction.update({ content: `Mode : **${interaction.customId}**. Résultat ?`, components: [row] });
    }

    else if (interaction.customId === 'result_win' || interaction.customId === 'result_lose') {
        const hasWon = interaction.customId === 'result_win';
        
        // Logique de points inversée selon Attaque ou Défense ? (A toi de voir, ici je laisse simple)
        // Si je suis en attaque et que je gagne -> +50 aux gagnants
        const finalPlayers = hasWon ? userSession.winners : userSession.losers;
        const pointsToAdd = hasWon ? POINTS_WIN : POINTS_LOSE;

        if (!finalPlayers || finalPlayers.length === 0) return interaction.update({ content: "⚠️ Liste vide.", components: [] });

        for (const pseudo of finalPlayers) await updatePlayerPoints(pseudo, pointsToAdd);
        await updateLeaderboard();

        activeSessions.delete(interaction.user.id);
        await interaction.update({ content: `✅ **Enregistré !**\n${finalPlayers.length} joueurs ont reçu +${pointsToAdd} pts.`, components: [] });
    }
});

// --- FONCTIONS BASE DE DONNÉES ---

async function updatePlayerPoints(pseudo, points) {
    // Requête sécurisée (si le joueur n'existe pas, on le crée)
    const query = `
        INSERT INTO players (dofus_pseudo, total_points) 
        VALUES ($1, $2) 
        ON CONFLICT (dofus_pseudo) 
        DO UPDATE SET total_points = players.total_points + $2;
    `;
    await pool.query(query, [pseudo, points]);
}

async function updateLeaderboard() {
    try {
        const res = await pool.query(`SELECT dofus_pseudo, total_points FROM players ORDER BY total_points DESC LIMIT 10`);
        if (res.rows.length === 0) return;

        let description = "";
        const medals = ['🥇', '🥈', '🥉'];
        res.rows.forEach((row, index) => {
            const medal = index < 3 ? medals[index] : `**${index + 1}.**`;
            description += `${medal} **${row.dofus_pseudo}** — \`${row.total_points} pts\`\n`;
        });

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('🏆 CLASSEMENT ALLIANCE')
            .setDescription(description)
            .setFooter({ text: `Mis à jour le ${new Date().toLocaleString('fr-FR')}` })
            .setThumbnail('https://upload.wikimedia.org/wikipedia/fr/3/3a/Dofus_Logo.png');

        const channel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID);
        if (!channel) return;
        const pinnedMessages = await channel.messages.fetchPinned();
        const botPin = pinnedMessages.find(msg => msg.author.id === client.user.id);

        if (botPin) await botPin.edit({ embeds: [embed] });
        else { const msg = await channel.send({ embeds: [embed] }); await msg.pin(); }

    } catch (error) {
        console.error("Erreur Leaderboard:", error);
    }
}

// --- FONCTION DE LECTURE ---
function parseScreenData(text) {
    const lines = text.split('\n');
    const winners = [];
    const losers = [];
    let currentSection = 'winners';
    
    // Détection basique si l'image commence direct par les perdants
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
            let word = w.replace(/[^a-zA-Z0-9-]/g, '');
            word = word.replace(/^\d+/, ''); 

            if (word.length < 3) continue;
            if (STOP_WORDS.includes(word.toLowerCase())) break;
            if (BANNED_WORDS.includes(word.toLowerCase())) return;

            if (word.length <= 4 && /\d/.test(word)) continue;
            if (/^\d/.test(word)) continue;

            validNameParts.push(word);
        }

        if (validNameParts.length === 1) {
            const pseudo = validNameParts[0];
            if (!/^\d+$/.test(pseudo)) {
                console.log(`✅ Joueur trouvé : ${pseudo}`);
                if (currentSection === 'winners') winners.push(pseudo);
                else losers.push(pseudo);
            }
        }
    });

    return { winners, losers };
}

client.login(process.env.DISCORD_TOKEN);