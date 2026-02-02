module.exports = {
    // --- CONFIGURATION GENERALE ---
    WEB_PORT: process.env.PORT || 3000,
    CHANNEL_ID: process.env.CHANNEL_ID, // Leaderboard
    LEADERBOARD_CHANNEL_ID: process.env.LEADERBOARD_CHANNEL_ID || process.env.CHANNEL_ID,
    PROFILE_CHANNEL_ID: process.env.PROFILE_CHANNEL_ID || process.env.CHANNEL_ID,
    
    NUGGETS_CHANNEL_ID: process.env.NUGGETS_CHANNEL_ID, 

    POOL_NAMES: {
        pool_1: "CXO",
        pool_2: "Captain / ABBA / Tenebris",
    },
    BONUSES: {
        pool_1: 4,
        pool_2: 1,
        standard: 0
    },
    BASE_SCORES: {
        attack: 5, 
        defense: 5
    },
    STOP_WORDS: ['niveau', 'level', 'lvl', 'xp', 'oxp', 'orp', 'okp', 'kamas', 'butin', 'total', 'challenge', 'revanche', 'groupe', 'team', 'combat', 'fin'],
    BANNED_WORDS: ['percepteur', 'prisme', 'prism', 'tax', 'collector', 'archimonstre', 'gardien', 'gagnant', 'gagnants', 'perdant', 'perdants', 'winners', 'losers', 'vs', 'nom', 'personnage', 'personage', 'character', 'name', 'exp', 'experience']
};