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
const express = require('express');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM players ORDER BY total_points DESC');
        const players = result.rows;
        const totalPoints = players.reduce((acc, p) => acc + p.total_points, 0);
        res.render('index', { 
            players: players,
            totalPoints: totalPoints
        });
    } catch (err) {
        console.error(err);
        res.send("Erreur lors du chargement du classement.");
    }
});

app.listen(PORT, () => {
    console.log(`Site Web actif sur le port ${PORT}`);
});

// --- CHARGEMENT JIMP ---
let Jimp;
try {
    const jimpLib = require('jimp');
    Jimp = jimpLib.Jimp || jimpLib;
} catch (e) {
    console.error("Erreur critique : Jimp mal installe.");
    process.exit(1);
}

// --- CONFIGURATION ---
const POINTS_WIN = 50;
const POINTS_LOSE = 15;
const CHANNEL_ID = process.env.CHANNEL_ID;
const LEADERBOARD_CHANNEL_ID = process.env.LEADERBOARD_CHANNEL_ID || CHANNEL_ID;

const STOP_WORDS = [
    'niveau', 'level', 'lvl', 'xp', 'oxp', 'orp', 'okp', 'kamas', 'butin', 'total', 
    'challenge', 'revanche', 'groupe', 'team', 'combat', 'fin', 'experience', 'gagnee'
];

const BANNED_WORDS = [
    'percepteur', 'prisme', 'prism', 'tax', 'collector', 'archimonstre', 'gardien',
    'gagnant', 'gagnants', 'perdant', 'perdants', 'winners', 'losers', 'vs',
    'nom', 'personnage', 'personage', 'character', 'name', 'exp'
];

if (!CHANNEL_ID) {
    console.error("ERREUR : CHANNEL_ID manquant.");
}

// --- 1. CONNEXION BASE DE DONNEES ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// --- 2. CREATION DU CLIENT ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const activeSessions = new Map();

// --- 3. DEMARRAGE ET CREATION TABLE AUTO ---
client.once('ready', async () => { 
    console.log(`Bot Connecte : ${client.user.tag}`);

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS players (
                dofus_pseudo VARCHAR(255) PRIMARY KEY,
                dofus_class VARCHAR(50),
                total_points INT DEFAULT 0
            );
        `);
        console.log("Table 'players' verifiee/creee.");
    } catch (err) {
        console.error("Erreur BDD (Table):", err);
    }

    updateLeaderboard(); 
});

// --- 4. RECEPTION DES IMAGES ---
client.on('messageCreate', async message => {
    if (message.author.bot || message.channel.id !== CHANNEL_ID) return;

    const attachments = message.attachments.filter(a => a.contentType && a.contentType.startsWith('image/'));
    if (attachments.size === 0) return;

    let userSession = activeSessions.get(message.author.id) || { winners: [], losers: [] };
    const msgRef = await message.reply(`Lecture du classement...`);

    try {
        for (const [id, attachment] of attachments) {
            console.log(`\n--- LECTURE : ${attachment.name} ---`);
            
            // 1. Charger l'image
            const image = await Jimp.read(attachment.url);

            // 2. Pretraitement optimise (sans invert/threshold qui detruisent le texte)
            image.greyscale()
                 .scale(3)
                 .contrast(0.3);
            
            // 3. Envoyer a Tesseract
            const processedBuffer = await image.getBufferAsync("image/png");
            const result = await Tesseract.recognize(processedBuffer, 'fra', {
                tessedit_pageseg_mode: '6'
            });
            
            console.log("--- TEXTE BRUT ---");
            console.log(result.data.text);
            
            const parsedPart = parseScreenData(result.data.text);
            
            if (parsedPart.winners.length > 0) userSession.winners = [...new Set([...userSession.winners, ...parsedPart.winners])];
            if (parsedPart.losers.length > 0) userSession.losers = [...new Set([...userSession.losers, ...parsedPart.losers])];
        }

        activeSessions.set(message.author.id, userSession);

        if (userSession.winners.length > 0 && userSession.losers.length > 0) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('attack').setLabel('Attaque').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('defense').setLabel('Defense').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('reset').setLabel('Reset').setStyle(ButtonStyle.Secondary)
            );
            await msgRef.edit({ 
                content: `**Complet !**\nGagnants: ${userSession.winners.join(', ')}\nPerdants: ${userSession.losers.join(', ')}`, 
                components: [row] 
            });
        } else {
            await msgRef.edit(`**Resultat partiel**\nGagnants: ${userSession.winners.length} | Perdants: ${userSession.losers.length}\nDetectes: W=${userSession.winners.join(',')} L=${userSession.losers.join(',')}`);
        }

    } catch (error) {
        console.error(error);
        msgRef.edit("Erreur technique.");
    }
});

// --- 5. INTERACTION BOUTONS ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    const userSession = activeSessions.get(interaction.user.id);
    
    if (!userSession) {
        return interaction.reply({ content: "Session expiree ou inconnue.", ephemeral: true });
    }

    if (interaction.customId === 'reset') {
        activeSessions.delete(interaction.user.id);
        return interaction.update({ content: "Session effacee.", components: [] });
    }

    if (interaction.customId === 'attack' || interaction.customId === 'defense') {
        userSession.context = interaction.customId;
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('result_win').setLabel('GAGNE').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('result_lose').setLabel('PERDU').setStyle(ButtonStyle.Danger)
        );
        await interaction.update({ content: `Mode : **${interaction.customId}**. Resultat ?`, components: [row] });
    }

    else if (interaction.customId === 'result_win' || interaction.customId === 'result_lose') {
        const hasWon = interaction.customId === 'result_win';
        const finalPlayers = hasWon ? userSession.winners : userSession.losers;
        const pointsToAdd = hasWon ? POINTS_WIN : POINTS_LOSE;

        if (!finalPlayers || finalPlayers.length === 0) return interaction.update({ content: "Liste vide.", components: [] });

        for (const pseudo of finalPlayers) await updatePlayerPoints(pseudo, pointsToAdd);
        await updateLeaderboard();

        activeSessions.delete(interaction.user.id);
        await interaction.update({ content: `**Enregistre !**\n${finalPlayers.length} joueurs ont recu +${pointsToAdd} pts.`, components: [] });
    }
});

// --- FONCTIONS BASE DE DONNEES ---

async function updatePlayerPoints(pseudo, points) {
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
        const medals = ['1.', '2.', '3.'];
        res.rows.forEach((row, index) => {
            const medal = index < 3 ? medals[index] : `**${index + 1}.**`;
            description += `${medal} **${row.dofus_pseudo}** - \`${row.total_points} pts\`\n`;
        });

        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('CLASSEMENT ALLIANCE')
            .setDescription(description)
            .setFooter({ text: `Mis a jour le ${new Date().toLocaleString('fr-FR')}` })
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
    
    // Detection de la section initiale
    const firstChunk = text.substring(0, 150).toUpperCase();
    if (firstChunk.includes('PERDANT')) currentSection = 'losers';

    lines.forEach((line) => {
        const upperLine = line.toUpperCase().trim();
        if (!upperLine || upperLine.length < 3) return;

        // Changement de section
        if (upperLine.includes('GAGNANT') || upperLine.includes('WINNER')) { 
            currentSection = 'winners'; 
            return; 
        }
        if (upperLine.includes('PERDANT') || upperLine.includes('LOSER')) { 
            currentSection = 'losers'; 
            return; 
        }

        // Verifier si la ligne contient un mot banni (entete, etc.)
        if (BANNED_WORDS.some(b => upperLine.includes(b.toUpperCase()))) {
            return;
        }

        // === FILTRE PERCEPTEUR ===
        // Pattern Ankama : "Prenom Do'Quelquechose" (ex: Johmy Do'Rorboreal, Enflam Do'Ert, Jerry Do'Bradiga)
        if (/Do'/i.test(line)) {
            console.log(`[SKIP PERCEPTEUR] ${line.trim()}`);
            return;
        }

        // Nettoyer la ligne
        const cleanLine = line.replace(/[\[\]\(\)\|\@\:\.\,\*\+\!\?\#\%\&]/g, ' '); 
        const rawWords = cleanLine.split(/\s+/).filter(w => w.length > 0);
        
        let validNameParts = [];

        for (const w of rawWords) {
            let word = w.replace(/[^a-zA-Z0-9\-]/g, '');
            
            if (word.length < 2) continue;
            
            // Stop words = on arrete de parser cette ligne
            if (STOP_WORDS.includes(word.toLowerCase())) break;
            
            // Ignorer les nombres purs
            if (/^\d+$/.test(word)) continue;
            
            // Ignorer si c'est juste des chiffres avec quelques lettres (niveaux mal lus)
            if (/^\d+[a-zA-Z]{1,2}$/.test(word) || /^[a-zA-Z]{1,2}\d+$/.test(word)) continue;

            validNameParts.push(word);
        }

        // Pas de mots valides trouves
        if (validNameParts.length === 0) return;

        // EXTRACTION DU PSEUDO (premier mot valide)
        const pseudo = validNameParts[0];
        
        // Validations finales
        if (pseudo.length < 3) return;
        if (/^\d+$/.test(pseudo)) return;
        if (/^\d/.test(pseudo) && pseudo.length < 5) return;
        
        console.log(`[${currentSection.toUpperCase()}] Joueur : ${pseudo}`);
        
        if (currentSection === 'winners') {
            if (!winners.includes(pseudo)) winners.push(pseudo);
        } else {
            if (!losers.includes(pseudo)) losers.push(pseudo);
        }
    });

    console.log(`\n=== RESULTAT ===`);
    console.log(`Gagnants (${winners.length}): ${winners.join(', ')}`);
    console.log(`Perdants (${losers.length}): ${losers.join(', ')}`);

    return { winners, losers };
}

client.login(process.env.DISCORD_TOKEN);