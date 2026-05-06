require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once('ready', async () => {
    console.log(`🤖 Connecté en tant que ${client.user.tag}. Début de la synchro...`);

    try {
        // 1. Récupérer le serveur (Guild)
        // On prend le premier serveur où le bot se trouve (ton serveur)
        const guild = client.guilds.cache.first();
        if (!guild) throw new Error("Le bot n'est sur aucun serveur !");
        
        console.log(`📂 Serveur trouvé : ${guild.name}`);
        console.log("⏳ Chargement de tous les membres Discord...");
        
        // On force le chargement de TOUS les membres (même hors ligne)
        const members = await guild.members.fetch();
        console.log(`✅ ${members.size} membres récupérés.`);

        // 2. Récupérer les joueurs de la BDD qui ont un ID Discord
        const res = await pool.query('SELECT id, dofus_pseudo, discord_id FROM players WHERE discord_id IS NOT NULL');
        console.log(`📋 ${res.rows.length} joueurs liés trouvés en BDD.`);

        let updatedCount = 0;

        for (const player of res.rows) {
            const member = members.get(player.discord_id);

            if (member) {
                // On met à jour avec les infos fraiches du Discord
                // nickname = Surnom sur le serveur (ex: Zologo)
                // user.username = Vrai pseudo unique (ex: zologo993)
                const nickname = member.nickname || member.user.globalName || member.user.username;
                const username = member.user.username;

                await pool.query(
                    `UPDATE players SET discord_nickname = $1, discord_username = $2 WHERE id = $3`,
                    [nickname, username, player.id]
                );
                
                // Petit log pour voir ce qu'il fait
                // console.log(`🔄 Mis à jour : ${player.dofus_pseudo} -> ${nickname} (${username})`);
                updatedCount++;
            } else {
                console.log(`⚠️ Attention : Le joueur ${player.dofus_pseudo} (ID: ${player.discord_id}) n'est plus sur le serveur Discord.`);
            }
        }

        console.log(`\n🎉 TERMINÉ ! ${updatedCount} profils Discord mis à jour dans la base de données.`);
        console.log("👉 Tu peux relancer 'node check_links_v2.js' pour vérifier.");

    } catch (e) {
        console.error("❌ Erreur :", e);
    } finally {
        await client.destroy();
        await pool.end();
    }
});

client.login(process.env.DISCORD_TOKEN);