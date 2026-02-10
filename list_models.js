require('dotenv').config();

async function checkAvailableModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("❌ Pas de clé API trouvée dans le fichier .env");
        return;
    }

    console.log("🔍 Interrogation de Google pour lister tes modèles...");
    
    try {
        // On tape directement sur l'API REST de Google pour avoir la vérité absolue
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();

        if (data.error) {
            console.error("❌ Erreur API :", data.error.message);
            return;
        }

        console.log("\n✅ MODÈLES DISPONIBLES POUR TA CLÉ :");
        console.log("-------------------------------------");
        
        // On filtre pour ne montrer que les modèles "Gemini" et "Flash"
        const models = data.models
            .filter(m => m.name.toLowerCase().includes('gemini') && m.name.toLowerCase().includes('flash'))
            .map(m => m.name.replace('models/', '')); // On enlève le préfixe inutile

        if (models.length === 0) {
            console.log("⚠️ Aucun modèle 'Flash' trouvé. Voici tout ce qui est dispo :");
            data.models.forEach(m => console.log(`- ${m.name.replace('models/', '')}`));
        } else {
            models.forEach(name => console.log(`👉 ${name}`));
        }
        
        console.log("-------------------------------------");
        console.log("Utilise un de ces noms exacts dans ton index.js !");

    } catch (e) {
        console.error("Erreur script :", e);
    }
}

checkAvailableModels();