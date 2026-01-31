module.exports = {
    // --- CONFIGURATION GENERALE ---
    WEB_PORT: process.env.PORT || 3000,
    CHANNEL_ID: process.env.CHANNEL_ID, // Leaderboard
    LEADERBOARD_CHANNEL_ID: process.env.LEADERBOARD_CHANNEL_ID || process.env.CHANNEL_ID,
    PROFILE_CHANNEL_ID: process.env.PROFILE_CHANNEL_ID || process.env.CHANNEL_ID,
    
    // NOUVEAU : Le channel dédié aux pépites
    // Ajoute NUGGETS_CHANNEL_ID=... dans ton fichier .env aussi !
    NUGGETS_CHANNEL_ID: process.env.NUGGETS_CHANNEL_ID, 

    // ... (Le reste de ton fichier config.js ne change pas) ...
    // ... garde bien tout le reste (MODIFICATEURS, POOL_NAMES, BASE_SCORES etc.)
    // ...
    // Je remets juste la suite pour être sûr que tu ne perdes rien
    WIN_MODIFIER: 1,  
    LOSE_MODIFIER: 1, 
    INFERIORITY_BONUS: 5, 
    MAX_PLAYER_GAP_FOR_CANCEL: 3, 

    POOL_NAMES: {
        pool_1: "Grosses Alliances (Dominantes)",
        pool_2: "Alliances Moyennes / Outsiders"
    },
    BONUSES: {
        pool_1: 5,
        pool_2: 3,
        standard: 0
    },
    BASE_SCORES: {
        attack: 4, 
        defense: 6
    },
    STOP_WORDS: ['niveau', 'level', 'lvl', 'xp', 'oxp', 'orp', 'okp', 'kamas', 'butin', 'total', 'challenge', 'revanche', 'groupe', 'team', 'combat', 'fin'],
    BANNED_WORDS: ['percepteur', 'prisme', 'prism', 'tax', 'collector', 'archimonstre', 'gardien', 'gagnant', 'gagnants', 'perdant', 'perdants', 'winners', 'losers', 'vs', 'nom', 'personnage', 'personage', 'character', 'name', 'exp', 'experience']
};