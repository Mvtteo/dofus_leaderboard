require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Tesseract = require('tesseract.js');
const { Pool } = require('pg');

// CONFIGURATION
const CHANNEL_ID = '1465273536875724970'; // Ton ID channel récupéré du log
const POINTS_WIN = 50;
const POINTS_LOSE = 15;

// Connexion Base de Données
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once('ready', () => {
    console.log(`✅ Bot connecté : ${client.user.tag}`);
});

client.on('messageCreate', async message => {
    if (message.author.bot || message.channel.id !== CHANNEL_ID) return;

    const attachment = message.attachments.first();
    if (!attachment || !attachment.contentType.startsWith('image/')) return;

    const msgRef = await message.reply('⏳ Analyse en cours...');

    try {
        console.log(`Analyse image : ${attachment.url}`);
        
        // OCR
        const { data: { text } } = await Tesseract.recognize(attachment.url, 'eng');
        console.log("--- TEXTE BRUT ---");
        console.log(text);
        console.log("------------------");

        // Parsing
        const parsedData = parseDofusScreen(text);

        if (parsedData.winners.length === 0) {
            return msgRef.edit("❌ Je n'ai pas réussi à lire les pseudos. L'image est-elle rognée ?");
        }

        // Sauvegarde DB
        let summary = "✅ **Leaderboard mis à jour !**\n\n";

        // GAGNANTS
        if (parsedData.winners.length > 0) {
            summary += "**🏆 GAGNANTS (+50 pts)**\n";
            for (const pseudo of parsedData.winners) {
                await updatePlayerPoints(pseudo, POINTS_WIN);
                summary += `- ${pseudo}\n`;
            }
        }

        // PERDANTS (Si détectés)
        if (parsedData.losers.length > 0) {
            summary += "\n**💀 PERDANTS (+15 pts)**\n";
            for (const pseudo of parsedData.losers) {
                await updatePlayerPoints(pseudo, POINTS_LOSE);
                summary += `- ${pseudo}\n`;
            }
        }

        msgRef.edit(summary);

    } catch (error) {
        console.error("Erreur critique :", error);
        msgRef.edit(`❌ Erreur technique : ${error.message}`);
    }
});

// Fonction DB
async function updatePlayerPoints(pseudo, points) {
    const cleanPseudo = pseudo.trim();
    // On ignore les pseudos trop courts (erreurs OCR souvent)
    if (cleanPseudo.length < 3) return; 

    const query = `
        INSERT INTO players (dofus_pseudo, total_points)
        VALUES ($1, $2)
        ON CONFLICT (dofus_pseudo)
        DO UPDATE SET total_points = players.total_points + $2;
    `;
    await pool.query(query, [cleanPseudo, points]);
}

// Fonction Parsing (Nettoyage Intelligent)
function parseDofusScreen(text) {
    const lines = text.split('\n');
    const winners = [];
    const losers = [];
    
    // Regex magique : Ignore les symboles au début (^[\W\d_]*), capture le mot ([a-zA-Z0-9-]+)
    const pseudoRegex = /^[\W\d_]*([a-zA-Z0-9-]+)/;

    let section = 'winners'; // Par défaut on commence en haut (Gagnants)

    for (const line of lines) {
        const l = line.trim();
        
        // 1. Détection des sections (Si jamais tu as les Perdants plus bas)
        if (l.toUpperCase().includes('PERDANTS') || l.includes('VS')) {
            section = 'losers';
            continue;
        }

        // 2. Ignorer les lignes inutiles (Entêtes, Kamas, etc.)
        if (l.length < 3 || l.includes('Niveau') || l.includes('GAGNANTS') || l.includes('Kamas')) continue;

        // 3. Extraction du pseudo
        const match = l.match(pseudoRegex);
        if (match && match[1]) {
            const pseudo = match[1];
            // Filtre anti-bruit (parfois l'OCR lit "oRp" comme un mot)
            if (pseudo.toLowerCase() === 'orp' || pseudo.toLowerCase() === 'oxp') continue;

            if (section === 'winners') winners.push(pseudo);
            else losers.push(pseudo);
        }
    }

    return { winners, losers };
}

client.login(process.env.DISCORD_TOKEN);