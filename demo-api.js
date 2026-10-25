/*
 * Démo GitHub Pages : l'API FastAPI n'est pas déployée. Les routes /api/* publiques sont simulées
 * avec des joueurs et des combats FICTIFS (aucune donnée réelle de la communauté).
 */
(function () {
  var seed = 7;
  var rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  var NAMES = ['Aurelyn', 'Brakmor', 'Cendrelune', 'Dakkar', 'Elyndra', 'Fenrik', 'Gorvak', 'Hysia', 'Ilvarn', 'Jorah-Pandala',
    'Kaelith', 'Lunerys', 'Morvak', 'Nyssa', 'Orikan', 'Pyralis', 'Quorn', 'Rhazel', 'Sylvanor', 'Tharok', 'Ulyra', 'Vexmor'];
  var POOLS = [{ id: 1, name: 'Alliance A' }, { id: 2, name: 'Alliance B' }, { id: 3, name: 'Alliance C' }];
  var players = NAMES.map(function (n) {
    var wins = 4 + Math.floor(rnd() * 40), losses = 2 + Math.floor(rnd() * 25);
    var atk = Math.floor(rnd() * 900) + wins * 20, def = Math.floor(rnd() * 700) + wins * 15;
    return { dofus_pseudo: n, avatar_url: null, wins: wins, losses: losses, winrate: Math.round(wins / (wins + losses) * 100),
      atk_points: atk, def_points: def, total_points: String(atk + def) };
  }).sort(function (a, b) { return b.total_points - a.total_points; });
  var now = Date.now();
  var matches = Array.from({ length: 30 }, function (_, i) {
    var won = rnd() > 0.4, team = players.slice().sort(function () { return rnd() - 0.5; }).slice(0, 4).map(function (p) { return p.dofus_pseudo; });
    return { id: i + 1, has_won: won, context: rnd() > 0.5 ? 'defense' : 'attack', alliance: POOLS[i % 3].name,
      created_at: new Date(now - i * 47 * 60000).toISOString(), winners: won ? team : [], losers: won ? [] : team, points: won ? 30 : 10 };
  });
  var hours = Array.from({ length: 24 }, function (_, h) { return Math.round((Math.sin((h - 6) / 24 * Math.PI * 2) + 1.2) * 10 * rnd()); });
  var stats = { hours: hours, pools: POOLS.map(function (p) {
    var w = 20 + Math.floor(rnd() * 30), l = 10 + Math.floor(rnd() * 25);
    return { name: p.name, wins: w, losses: l, total: w + l, winrate: Math.round(w / (w + l) * 100),
      atk_winrate: 40 + Math.floor(rnd() * 40), def_winrate: 40 + Math.floor(rnd() * 40), total_points: w * 30 + l * 10,
      top_players: players.slice(0, 3).map(function (pl) { return { name: pl.dofus_pseudo, wins: pl.wins }; }) };
  }) };
  var routes = [
    [/^\/api\/seasons$/, { seasons: [{ id: 1, label: 'Saison démo', isCurrent: true }], currentSeason: 1 }],
    [/^\/api\/config$/, { pools: POOLS, defaultWinratePool: 1 }],
    [/^\/api\/leaderboard\/\d+$/, players],
    [/^\/api\/season-info\/\d+$/, { totalCombats: matches.length * 4 }],
    [/^\/api\/matches\/\d+/, matches],
    [/^\/api\/stats\/\d+$/, stats],
  ];
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    for (var i = 0; i < routes.length; i++) {
      if (routes[i][0].test(url)) return Promise.resolve(new Response(JSON.stringify(routes[i][1]), { headers: { 'Content-Type': 'application/json' } }));
    }
    return realFetch(input, init);
  };
  document.addEventListener('DOMContentLoaded', function () {
    var b = document.createElement('div');
    b.textContent = 'DÉMO — joueurs et combats fictifs. L’application réelle tourne avec l’API FastAPI et le bot Discord.';
    b.setAttribute('style', 'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:9999;padding:8px 14px;border-radius:999px;background:rgba(20,20,26,.9);color:#fff;font:600 12px/1.4 system-ui,sans-serif;border:1px solid rgba(255,255,255,.2);max-width:calc(100% - 24px);text-align:center');
    document.body.appendChild(b);
  });
})();
