require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const Tesseract = require('tesseract.js');
const fs = require('fs');

// Gestion JIMP
let Jimp;
try { const jimpLib = require('jimp'); Jimp = jimpLib.Jimp || jimpLib; } 
catch (e) { console.error("❌ Erreur Jimp."); process.exit(1); }

const CHANNEL_ID = process.env.CHANNEL_ID;

// --- RÉGLAGES (Ajustés pour Dofus) ---
// On scanne LARGE à gauche du texte pour être sûr de choper l'icône
const SCAN_WIDTH = 100; 
const SCAN_HEIGHT = 50;
const OFFSET_X_START = 110; // On commence à découper 110px à gauche du texte

// Création dossier
if (!fs.existsSync('./ref_icons')) fs.mkdirSync('./ref_icons');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once('ready', () => console.log(`✅ Bot EXTRACTEUR (Version Couleur) connecté.`));

client.on('messageCreate', async message => {
    if (message.author.bot || message.channel.id !== CHANNEL_ID) return;
    const attachments = message.attachments.filter(a => a.contentType && a.contentType.startsWith('image/'));
    if (attachments.size === 0) return;

    await message.reply(`🎨 Extraction des icônes en COULEUR...`);

    try {
        for (const [id, attachment] of attachments) {
            console.log(`\n--- TRAITEMENT : ${attachment.name} ---`);
            
            // 1. Image Originale (pour la découpe)
            const originalImage = await Jimp.read(attachment.url);
            
            // 2. Image Robot (pour la lecture)
            const robotImage = originalImage.clone();
            robotImage.greyscale().invert().contrast(0.25).scale(1.5); // Zoom x1.5 pour lire

            const buffer = await robotImage.getBufferAsync("image/png");
            const result = await Tesseract.recognize(buffer, 'eng');
            
            // On utilise 'words' pour être précis
            const words = result.data.words || [];

            let count = 0;
            for (const word of words) {
                const text = word.text.replace(/[^a-zA-Z0-9-]/g, '');
                
                // Filtres de base
                if (text.length < 3) continue;
                if (['NIVEAU', 'LEVEL', 'GAGNANT', 'PERDANT', 'NOM', 'XP', 'TOTAL'].some(b => text.toUpperCase().includes(b))) continue;
                if (/^\d/.test(text)) continue; // Commence par chiffre

                // 3. DÉCOUPE SUR L'IMAGE ORIGINALE (Non zoomée)
                // Il faut ajuster les coordonnées car robotImage est x1.5
                const bbox = word.bbox; // Coordonnées sur l'image x1.5
                
                // On remet à l'échelle x1
                const realX = bbox.x0 / 1.5;
                const realY = bbox.y0 / 1.5;

                // Zone de découpe estimée
                let cropX = realX - 60; // On recule de 60px
                let cropY = realY - 5;  // On remonte un peu
                
                if (cropX < 0) cropX = 0;
                if (cropY < 0) cropY = 0;

                // On découpe un carré sur l'image ORIGINALE
                const icon = originalImage.clone();
                icon.crop(cropX, cropY, 50, 50); // Carré de 50x50

                const filename = `./ref_icons/${text}_${Date.now()}.png`;
                await icon.writeAsync(filename);
                console.log(`💾 Icône extraite pour : ${text}`);
                count++;
            }
        }
        message.channel.send("✅ Extraction terminée ! Vérifie le dossier `ref_icons`.");
    } catch (e) { console.error(e); }
});

client.login(process.env.DISCORD_TOKEN);