# Handoff: Nemesis Leaderboard — refonte visuelle (dark poster)

## Overview
Refonte complète de l'UI du tracker PvP d'alliance Nemesis (repo `Mvtteo/dofus_leaderboard`,
branche `refactor/python-backend`, frontend `client/`). Même contrat d'API et mêmes données
qu'aujourd'hui — seule la couche visuelle et la mise en page changent : fond noir encré,
typographie condensée massive (Anton), chiffres monospace, accents de couleur switchables,
zéro carte arrondie / ombre / dégradé.

Trois vues, comme dans `client/src/App.jsx` : **Classement**, **Activité**, **Stats**.
La notion de **percepteur (perco)** a été retirée partout à la demande du produit
(elle n'existe plus côté jeu) : plus de colonne PERCO dans le tableau, plus d'anneau,
plus de badge sur le podium. `utils/helpers.js: perco()` peut être supprimé.

## About the Design Files
Les fichiers de ce bundle sont des **références de design faites en HTML** — des prototypes
qui montrent l'apparence et le comportement voulus, pas du code de production à copier tel quel.
Le travail consiste à **recréer ces designs dans le codebase existant** : React + Vite + SCSS
(`client/src/components/*.jsx`, `client/src/styles/*.scss`), en réutilisant les composants
et conventions déjà en place. Les données affichées dans le prototype sont des mocks
en dur ; côté app elles viennent de `/api/seasons`, `/api/config`, `/api/leaderboard/{season}`,
`/api/season-info/{season}`, `/api/matches/{season}?limit=30`, `/api/stats/{season}`.

Le prototype est un fichier unique auto-portant : `Nemesis Leaderboard v2.dc.html`
(+ `support.js` runtime, à ouvrir dans un navigateur depuis le dossier). Les valeurs de style
sont inline dans le markup — c'est volontaire pour le prototype, à traduire en SCSS côté app.

## Fidelity
**High-fidelity.** Couleurs, tailles de police, graisses, letter-spacings, hauteurs de barres
et grilles sont définitifs et donnés en valeurs exactes ci-dessous. À recréer au pixel, en
gardant les structures de données existantes.

## Screens / Views

### Chrome commun (toutes les vues)

Page : `background #0d0e0c`, texte `#f2efe6`, famille de base `Archivo` (400/500/600/700).
Conteneur central : `max-width 1360px; margin 0 auto; padding 0 32px`.

**Header** (sticky, `top:0`, `z-index:30`, fond `#0d0e0c`, `border-bottom 1px solid rgba(242,239,230,0.14)`)
- Padding interne `16px 32px`, `display:flex; align-items:center; gap:26px`.
- Logo : `web/assets/logo_nemesis_round.png`, 32×32, `object-fit: contain`. **Important** :
  le `logo_nemesis.png` d'origine est un PNG mais avec un fond carré opaque (bord clair visible
  sur le noir). La version fournie ici est le même fichier recadré en cercle avec les coins
  réellement transparents (canvas, rayon = 56.5 sur 115px). À régénérer proprement à partir du
  source vectoriel si vous l'avez.
- Wordmark : "NEMESIS" — Anton 27px, `line-height 1`, `letter-spacing .02em`, uppercase.
- Sous-titre : "ALLIANCE PVP" — JetBrains Mono 8px, `letter-spacing .24em`, `#6f7468`,
  uppercase, `white-space: nowrap` (obligatoire, sinon il passe sur 3 lignes en flex serré).
- Spacer `flex:1`, puis à droite, `gap:22px` :
  - compteur joueurs : valeur JetBrains Mono 14px `#f2efe6` + label "JOUEURS" Mono 8px
    `letter-spacing .18em` `#6f7468`;
  - idem "COMBATS";
  - champ recherche : `border 1px solid rgba(242,239,230,0.16)`, `padding 7px 12px`,
    largeur 190px, glyphe `⌲` (U+2932) Mono 10px `#6f7468`, input transparent Mono 10.5px
    uppercase `letter-spacing .08em`, placeholder "RECHERCHER". Filtre sur `dofus_pseudo`
    (insensible à la casse) et remet la pagination à 1.
  - select saison : fond = **accent**, texte `#0d0e0c`, `padding 8px 14px`, Mono 10.5px/700,
    `letter-spacing .1em`, uppercase, `appearance:none`, pas de border.

**Ticker de résultats** (sous le header) — nouveauté par rapport à l'existant
- Bande `background #111310`, `border-bottom 1px solid rgba(242,239,230,0.14)`, `overflow:hidden`.
- Piste `display:flex; width:max-content`, animation `ticker 42s linear infinite`
  (`@keyframes ticker { from { transform: translateX(0) } to { transform: translateX(-50%) } }`).
  La liste des matchs est **dupliquée** (`items.concat(items)`) pour une boucle sans couture.
- Item : `padding 9px 20px`, `border-right 1px solid rgba(242,239,230,0.08)`, `white-space:nowrap`,
  `gap:10px` : tag "VICTOIRE"/"DÉFAITE" Mono 9px `letter-spacing .16em` coloré accent/accent2,
  puis texte Mono 10px `#b9b8ac` : `ATK vs OSTENTATIO  +12 PTS  4 MIN`.

**Onglets** (`border-bottom 1px solid rgba(242,239,230,0.14)`)
- Boutons carrés collés, `padding 13px 26px`, `border-right 1px solid rgba(242,239,230,0.14)`,
  Mono 10.5px/700, `letter-spacing .16em`, uppercase.
- Actif : fond `#f2efe6`, texte `#0d0e0c`. Inactif : fond transparent, texte `#8b9080`.
- Labels : "Classement", "Activité", "Stats".

**Footer** (`border-top 1px solid rgba(242,239,230,0.14)`, `padding 20px 32px`, space-between)
- Gauche : "NEMESIS — ALLIANCE PVP TRACKER", Anton 16px, `letter-spacing .06em`, `#6f7468`.
- Droite : `MAJ <date locale fr-FR>`, Mono 9px, `letter-spacing .1em`, `#6f7468`.

### 1. Classement (vue par défaut)

**Hero** — `padding 44px 0 34px`, `display:grid; grid-template-columns: 1fr auto;
align-items:end; gap:30px`, `border-bottom 1px solid rgba(242,239,230,0.14)`.
- Eyebrow : `SAISON 7 — ALLIANCE`, Mono 9.5px, `letter-spacing .28em`, uppercase, couleur accent.
- Titre : Anton **96px**, `line-height .86`, `letter-spacing -.01em`, uppercase, deux lignes :
  ligne 1 "CLASSEMENT" pleine (`#f2efe6`), ligne 2 "DE L'ALLIANCE" en **contour** :
  `color: transparent; -webkit-text-stroke: 1.5px <accent2>`.
- Paragraphe droite : `max-width 260px`, 12px, `line-height 1.7`, `#8b9080`, `text-wrap: pretty` —
  « Points d'attaque et de défense agrégés par compte. Rafraîchi toutes les 15 s depuis le bot. »

**Top 3 — lignes "fight-card"** (remplace les 3 cartes podium de `_podium.scss`)
- Une ligne par joueur, `display:grid; grid-template-columns: 132px minmax(0,1fr) 190px 150px;
  align-items:center; gap:26px; padding: 24px 26px 24px 0;`
  `border-bottom 1px solid rgba(242,239,230,0.14)`. Hover : `background #14170f`.
- Rang #1 : ligne avec `background #111410` (les 2 autres transparentes).
- Col 1 — rang : Anton **92px**, `line-height .78`, `text-align:right`, couleur = accent du rang
  (1er = accent, 2e = `#f2efe6`, 3e = accent2).
- Col 2 — identité : `display:flex; align-items:center; gap:18px` —
  **avatar 58×58**, carré (pas d'arrondi), `border 1px solid <accent du rang>`,
  fond `#15170f`, image en `object-fit: cover`, `flex-shrink:0` ;
  puis colonne : pseudo Anton 38px `line-height .9` uppercase, ellipsis 1 ligne, et
  dessous `51V / 19D` Mono 10px `letter-spacing .1em` `#8b9080`.
- Col 3 — winrate : label "WINRATE" Mono 8.5px `letter-spacing .18em` `#6f7468` +
  valeur Mono 13px colorée ; **jauge segmentée** : `grid-template-columns: repeat(10,1fr); gap:3px;`
  segments `height:7px`, `round(wr/10)` premiers remplis de la couleur de winrate, les autres
  `rgba(242,239,230,0.12)`. Sous la jauge : `ATK 268` et `DEF 144`, Mono 10px `#8b9080`, `gap:16px`.
- Col 4 — score : Anton 46px couleur du rang, aligné droite, + "POINTS" Mono 8.5px
  `letter-spacing .22em` `#6f7468`.

**Tableau** (`margin-top: 46px`) — grille identique en entête et en ligne :
`grid-template-columns: 72px minmax(160px,1fr) 180px 84px 84px 112px; gap:14px; align-items:center`.
- Entête : fond **`#f2efe6`**, texte `#0d0e0c`, `padding 10px 18px`, Mono 8px `letter-spacing .18em`
  uppercase. Colonnes : RANG · JOUEUR · `WINRATE · VS OSTENTATIO` (suffixe = pool par défaut
  de `/api/config`, `defaultWinratePool`) · ATK (droite) · DEF (droite) · SCORE (droite).
- Ligne : `padding 13px 18px`, `border-bottom 1px solid rgba(242,239,230,0.09)`,
  hover `background #15170f`.
  - Rang : Mono 13px, `accent` si rang ≤ 3 sinon `#8b9080` ; à côté, delta `rank_change`
    Mono 9px — `↑n` en accent, `↓n` en accent2, vide si 0 (masquable, cf. tweaks).
  - Joueur : `display:flex; align-items:center; gap:12px` — **avatar 26×26** carré,
    `border 1px solid rgba(242,239,230,0.16)`, fond `#15170f`, `object-fit: cover`,
    `flex-shrink:0` ; puis le pseudo en Archivo 14px/600, uppercase,
    `letter-spacing .01em`, ellipsis. Les avatars sont **carrés**, pas ronds (les cercles
    de l'ancien tableau sont abandonnés).
  - Winrate : jauge segmentée 10 segments `height:5px; gap:2px` + valeur Mono 10.5px,
    `min-width:30px`, alignée droite.
  - ATK / DEF : Mono 11px `#8b9080`, alignés droite, `toLocaleString('fr-FR')`.
  - Score : Mono 14px/700 `#f2efe6`, aligné droite.
- Vide : « AUCUN JOUEUR TROUVÉ », Mono 11px `letter-spacing .14em` uppercase `#6f7468`,
  `padding 52px 18px`, centré.
- Pagination (`padding-top 18px`, space-between) : à gauche `24 joueurs — page 1 / 2`
  Mono 9.5px `letter-spacing .12em` uppercase `#6f7468` ; à droite boutons carrés
  `min-width 30px; height 30px`, Mono 11px/700, `gap:4px`, fenêtre glissante `page±2` ;
  actif = fond accent + texte `#0d0e0c` + border accent, inactif = transparent, texte `#8b9080`,
  `border 1px solid rgba(242,239,230,0.16)`, hover `border-color: accent`.

### 2. Activité

- Titre : Anton 72px `line-height .88` uppercase, "DERNIERS" plein + "COMBATS" en contour
  `-webkit-text-stroke: 1.5px <accent>`. `margin-bottom: 28px`.
- Liste de lignes (plus de cartes) :
  `grid-template-columns: 108px minmax(0,1fr) 1fr 118px; gap:24px; padding: 20px 0;`
  `border-top 1px solid rgba(242,239,230,0.14)`, hover `background #14170f`.
  - Col 1 : chip résultat — fond accent (victoire) / accent2 (défaite), texte `#0d0e0c`,
    Mono 8.5px/700 `letter-spacing .16em`, `padding 4px 7px` ; dessous
    `ATTAQUE · 4 MIN` Mono 8.5px `letter-spacing .16em` `#8b9080`.
  - Col 2 : label "ADVERSAIRE" Mono 8.5px `letter-spacing .2em` `#6f7468` +
    nom d'alliance Anton 34px uppercase, ellipsis.
  - Col 3 : deux colonnes `1fr 1fr; gap:18px` — "GAGNANTS" (Mono 8px `letter-spacing .18em`,
    accent) avec noms Archivo 12px/500 uppercase ; "PERDANTS" (label accent2) avec noms 12px
    `#8b9080`. Pas de séparateur "VS".
  - Col 4 : `+12` Anton 34px, couleur accent/accent2, aligné droite (l'unité "pts" est implicite).
- Formatage du temps (repris de `helpers.js: ago`) : `< 60 → "n MIN"`, `< 1440 → "n H"`, sinon `"n J"`.

### 3. Stats

- Bloc winrate global : `grid 1fr 1fr; align-items:end; gap:30px; padding-bottom:30px;`
  `border-bottom 1px solid rgba(242,239,230,0.14)`. Label "WINRATE GLOBAL" Mono 9.5px
  `letter-spacing .26em` `#6f7468` ; valeur **Anton 140px** `line-height .82` en accent ;
  à droite `168V / 137D — 305 COMBATS` Mono 12px `#8b9080`.
- Grille de pools : `repeat(3, minmax(0,1fr))`, chaque cellule
  `border-right / border-bottom 1px solid rgba(242,239,230,0.14)`, `padding 26px 24px`, `gap:20px`.
  - Nom du pool Anton 30px uppercase ; sous-titre `62% WR · 148 combats` Mono 11px coloré winrate.
  - Sous-grille `1fr 1fr; gap:16px` : WR ATTAQUE, WR DÉFENSE, POINTS — valeurs Mono 18px
    (WR colorés par seuil), labels Mono 8px `letter-spacing .16em` uppercase `#6f7468`.
  - Bloc MVP : `border-top 1px solid rgba(242,239,230,0.09)`, `padding-top 14px`, label "MVP"
    Mono 8px `letter-spacing .18em` `#6f7468`, puis lignes `nom` (12px uppercase) / `24V`
    (Mono 10.5px accent) en space-between.
- Distribution horaire : label "DISTRIBUTION HORAIRE" Mono 9.5px `letter-spacing .24em` `#6f7468` ;
  `grid-template-columns: repeat(24,1fr); gap:5px; align-items:end; height:170px`,
  barres carrées (pas de radius) : `height = max(round(v/max*100), 2)%`, couleur accent si
  `v >= max*0.7` sinon `pal.soft`, hover `background: accent2` ; axe des heures dessous
  (`border-top 1px solid rgba(242,239,230,0.14)`, `padding-top 8px`), Mono 8px `#6f7468`,
  libellé `0H, 3H, 6H…` tous les 3 pas.

## Interactions & Behavior
- **Onglets** : état local `tab ∈ {classement, activite, stats}`. Les panneaux Activité/Stats
  ne sont montés que lorsqu'actifs (comme aujourd'hui dans `App.jsx`).
- **Recherche** : filtre client-side sur `dofus_pseudo`, `includes` insensible à la casse,
  reset de la page à 1. Le rang affiché reste le **rang global** (index dans la liste
  complète), pas l'index dans la liste filtrée — comportement identique à l'existant.
- **Pagination** : 12 lignes par page par défaut, fenêtre de boutons `page±2`.
- **Saison** : changement → refetch leaderboard + season-info, reset page.
- **Polling** : `setInterval` 15 s sur leaderboard + season-info (inchangé).
- **Ticker** : CSS pure, 42 s par boucle, liste dupliquée. Prévoir
  `@media (prefers-reduced-motion: reduce) { animation: none }`.
- **Hovers** : lignes top 3 `#14170f`, lignes tableau `#15170f`, boutons pagination
  `border-color: accent`, barres du graphe → accent2. Aucune transition de transform,
  aucune ombre, aucun glow (rupture volontaire avec `_podium.scss`).
- **Animations supprimées** : les entrées en fade/translate des cartes podium et des lignes
  (`.pod-card.visible`, `.player-row.visible`) ne sont pas reprises.
- **Responsive** : maquette pensée pour ≥1280px. En dessous, replier d'abord la col.
  winrate du top 3, puis passer le top 3 en pile. Les pistes fixes du tableau
  (72/180/84/84/112 + gaps) sont calibrées pour que `minmax(160px,1fr)` du pseudo ne
  s'effondre pas — ne pas les élargir sans revoir le point de rupture.

## State Management
```
tab: 'classement' | 'activite' | 'stats'
search: string
season: number            // id de saison
page: number              // pagination du tableau
```
Données distantes (mêmes endpoints qu'aujourd'hui) : `seasons`, `currentSeason`, `pools`,
`defaultWinratePool`, `players[]` (`/api/leaderboard/{id}`), `totalCombats`
(`/api/season-info/{id}`), `matches[]` (`/api/matches/{id}?limit=30`),
`stats` = `{pools[], hours[24]}` (`/api/stats/{id}`).

Champs joueur utilisés (cf. `backend/dofus_leaderboard/schemas.py: LeaderboardPlayerOut`) :
`dofus_pseudo, total_points, atk_points, def_points, wins, losses, winrate, rank_change`.
`avatar_url` est utilisé pour l'avatar (voir ci-dessous) ; fallback si `null`.

## Design Tokens

Couleurs de base
```
--bg            #0d0e0c   fond de page
--bg-raise      #111310   bande ticker
--bg-row-1      #111410   ligne du rang 1
--hover-row     #14170f   hover top 3 / activité
--hover-table   #15170f   hover ligne de tableau
--ink           #f2efe6   texte principal / fond d'entête de tableau
--ink-2         #b9b8ac   texte ticker
--muted         #8b9080   texte secondaire
--muted-2       #6f7468   labels
--rule          rgba(242,239,230,0.14)   filets structurants
--rule-soft     rgba(242,239,230,0.09)   filets de lignes
--seg-empty     rgba(242,239,230,0.12)   segment de jauge vide
```

Palettes d'accent (prop `palette`, défaut `cobalt`)
```
cobalt   accent #4d6bff  accent2 #ff5c2b  mid #c9b8ff  soft rgba(77,107,255,0.30)
lime     accent #d9f24b  accent2 #ff4a1f  mid #e2a33c  soft rgba(217,242,75,0.28)
glacier  accent #6fe3d2  accent2 #ff5c7a  mid #a9d8c4  soft rgba(111,227,210,0.28)
magenta  accent #ff3d81  accent2 #ffd447  mid #ff9bbe  soft rgba(255,61,129,0.28)
```
Seuils de winrate (repris de `helpers.js: wrColor`) : `>= 60 → accent`, `>= 45 → mid`,
`< 45 → accent2`.

Typographie
```
Anton (400)            titres, rangs, scores, noms du top 3, noms d'alliance
Archivo (400/500/600)  noms de joueurs, listes de participants, paragraphes
JetBrains Mono (400/500/700)  tous les chiffres, labels, tags, pagination
```
Échelle utilisée : 8 / 8.5 / 9 / 9.5 / 10 / 10.5 / 11 / 12 / 13 / 14 / 16 / 18 / 27 / 30 /
34 / 38 / 46 / 72 / 92 / 96 / 140 px. Letter-spacings des labels : `.16em`–`.28em`.

Géométrie
```
border-radius: 0 partout (aucun arrondi)
box-shadow: aucun
gaps de grille: 3 / 4 / 5 / 14 / 16 / 18 / 24 / 26 / 30 px
paddings de ligne: 13px 18px (tableau), 24px 26px 24px 0 (top 3), 20px 0 (activité)
conteneur: max-width 1360px, padding horizontal 32px
```
Google Fonts : `https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap`

## Assets
- `web/assets/logo_nemesis_round.png` — logo de l'alliance, dérivé du `logo_nemesis.png`
  du repo, recadré en cercle avec coins transparents (115×115). Affiché 32×32 dans le header.
- `web/assets/avatar_placeholder_1..6.png` — **placeholders** d'avatars (96×96, rayures
  diagonales sourdes, 6 variantes assignées par `rank % 6`). Ce ne sont **pas** des assets
  finaux : en production l'avatar vient de `avatar_url` (avatar Discord du compte, cf.
  `accounts.avatar_url`), et ces PNG servent uniquement de fallback quand `avatar_url`
  est `null`. Le prototype les utilise partout faute de vraies données.
  Cas particulier existant à conserver si vous le souhaitez : `web/assets/dog.jpeg` du repo,
  forcé pour le pseudo `nazolas` dans l'ancien `Leaderboard.jsx`.
- Aucune icône SVG : celles du header de l'ancienne version (joueurs, épées) sont supprimées.

## Screenshots
`screenshots/01-screen.png` — Classement (hero + top 3), `02` — top 3 + tableau,
`03` — Activité, `04` — Stats. Captures à ~910px de large : le design est calibré pour
≥1280px, donc s'y référer pour les couleurs et les rythmes, pas pour les largeurs de colonnes.

## Files
- `Nemesis Leaderboard v2.dc.html` — le design de référence (à ouvrir dans un navigateur).
  Les mocks de données et toute la logique dérivée (jauges segmentées, deltas, pagination,
  ticker, palettes) sont dans le `<script>` de logique en bas du fichier.
- `support.js` — runtime nécessaire pour ouvrir le prototype localement.
- `web/assets/logo_nemesis_round.png` + `web/assets/avatar_placeholder_1..6.png` — assets.
- `screenshots/` — rendu des 3 vues.
- `Nemesis Leaderboard v1 (light, archive).dc.html` — première piste, fond clair éditorial,
  **non retenue**. Fournie pour contexte seulement.

Options exposées dans le prototype (à câbler ou figer selon besoin) :
`palette` (cobalt | lime | glacier | magenta), `rowsPerPage` (6–24, défaut 12),
`showRankChange` (bool, défaut vrai).

Côté repo, les fichiers à remplacer/réécrire : `client/src/components/Header.jsx`,
`Leaderboard.jsx`, `Feed.jsx`, `Stats.jsx`, `Footer.jsx`, `Background.jsx` (le fond animé
disparaît), et les partiels `client/src/styles/_header.scss`, `_podium.scss`, `_table.scss`,
`_tabs.scss`, `_feed.scss`, `_stats.scss`, `_background.scss`, `_variables.scss`.
