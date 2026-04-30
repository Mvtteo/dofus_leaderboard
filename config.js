module.exports = {
    // --- CONFIGURATION GENERALE ---
    WEB_PORT: process.env.PORT || 3000,
    CHANNEL_ID: process.env.CHANNEL_ID, // Leaderboard
    LEADERBOARD_CHANNEL_ID: process.env.LEADERBOARD_CHANNEL_ID || process.env.CHANNEL_ID,
    PROFILE_CHANNEL_ID: process.env.PROFILE_CHANNEL_ID || process.env.CHANNEL_ID,
    OWNER_ID: process.env.OWNER_ID,
    
    NUGGETS_CHANNEL_ID: process.env.NUGGETS_CHANNEL_ID, 

    // Pools dynamiques (max 5) - valeurs par defaut si rien en DB
    DEFAULT_POOLS: [
        { id: "pool_1", name: "CXO / Dawnfall / Razia", bonus: 8 },
        { id: "pool_2", name: "Captain / ABBA / Tenebris", bonus: 1 }
    ],
    MAX_POOLS: 5,

    BASE_SCORES: {
        attack: 5, 
        defense: 5
    },
    STOP_WORDS: ['niveau', 'level', 'lvl', 'xp', 'oxp', 'orp', 'okp', 'kamas', 'butin', 'total', 'challenge', 'revanche', 'groupe', 'team', 'combat', 'fin'],
    BANNED_WORDS: ['prisme', 'prism', 'tax', 'collector', 'archimonstre', 'gardien', 'gagnant', 'gagnants', 'perdant', 'perdants', 'winners', 'losers', 'vs', 'nom', 'personnage', 'personage', 'character', 'name', 'exp', 'experience']
};