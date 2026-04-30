require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function exportDetailedView() {
    const client = await pool.connect();
    try {
        console.log("🔍 Analyse détaillée des comptes...");

        const query = `
            SELECT 
                discord_id,
                MAX(discord_username) as Username,  -- Le "vrai" nom de compte (ex: zologo993)
                MAX(discord_nickname) as Surnom,    -- Le nom affiché sur le serveur (ex: Zologo)
                STRING_AGG(dofus_pseudo, ', ') as Persos_Dofus,
                SUM(total_points) as Points_Total
            FROM players
            WHERE discord_id IS NOT NULL
            GROUP BY discord_id
            ORDER BY Surnom NULLS LAST, Username;
        `;

        const res = await client.query(query);

        // En-tête du CSV
        let csvContent = "Username (Unique);Surnom (Serveur);Liste des Persos;Points\n";
        
        res.rows.forEach(r => {
            // On nettoie les nulls pour l'affichage
            const u = r.username || "Inconnu";
            const n = r.surnom || "(Pas encore enregistré)";
            csvContent += `${u};${n};${r.persos_dofus};${r.points_total}\n`;
        });

        fs.writeFileSync('verif_liens_v2.csv', csvContent);
        
        console.log("\n✅ FICHIER GÉNÉRÉ : 'verif_liens_v2.csv'");
        console.log("👉 Regarde la colonne 'Surnom'. Si elle est vide, c'est que le bot n'a pas encore vu ce joueur parler.");

    } catch (e) {
        console.error("❌ Erreur :", e);
    } finally {
        client.release();
        pool.end();
    }
}

exportDetailedView();