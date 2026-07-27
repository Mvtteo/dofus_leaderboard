# Backend Python (FastAPI + SQLAlchemy + discord.py)

Portage du backend Node (`index.js`) : API REST (`api/`), bot Discord (`bot/`), et code
partagé (`dofus_leaderboard/`) — modèles SQLAlchemy, logique métier (saisons, classement,
IA vision Groq), utilisé par les deux.

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Variables d'environnement attendues (`.env.local` à la racine du repo, comme pour le bot Node) :
`DATABASE_URL`, `ADMIN_PASSWORD`, `DISCORD_TOKEN`, `CHANNEL_ID`, `PROFILE_CHANNEL_ID`,
`NUGGETS_CHANNEL_ID`, `LEADERBOARD_CHANNEL_ID`, `OWNER_ID`, `GROQ_API_KEY`.

## Base de données

Le schéma est géré par Alembic (`alembic/versions/0001_initial_schema.py`), pas par du DDL
ad hoc au démarrage comme dans l'ancien bot Node. Sur une base neuve :

```bash
alembic upgrade head
```

(Pas encore exécuté — en attente de la nouvelle base de données.)

## Lancer l'API

```bash
uvicorn api.main:app --reload --port 3000
```

Sert les routes `/api/*` (public) et `/admin/*` (login + `/admin/api/*`), plus les fichiers
statiques buildés par `client/` (`dist/`) et `web/assets/`. Le frontend Vite (`client/`) n'a
pas changé de contrat d'API — mêmes routes `/api/*` qu'avant, donc le proxy Vite existant
fonctionne tel quel une fois l'API sur le port 3000.

## Lancer le bot Discord

```bash
python -m bot.main
```

## Docker

L'ancien stack Node (`index.js`, `*.ejs`, `scripts/*.js`) a été supprimé. `docker-compose.yml`
définit maintenant trois services : `db` (Postgres), `api` (FastAPI, port 3000) et `bot`
(discord.py) — les deux derniers partagent la même image (`Dockerfile`, multi-stage :
build du client React puis image Python), seule la commande diffère. Le schéma n'est plus
bootstrappé par `init.sql` au démarrage du conteneur Postgres — c'est Alembic qui en a la
charge (`alembic upgrade head`, à lancer manuellement ou en étape de déploiement).

## Modèle de données : accounts / characters

Refonte du schéma par rapport à l'ancien `players` (un pseudo = une ligne, rattachement à
un compte Discord uniquement via `discord_id`, sans contrainte) :

- `accounts` : l'entité "joueur" réelle — un compte Discord, ou un compte autonome créé
  automatiquement pour un personnage pas (encore) lié à personne.
- `characters` : un personnage Dofus, avec `account_id` **NOT NULL** — plus de rattachement
  implicite façon `COALESCE(discord_id, dofus_pseudo)`, donc plus de personnage orphelin
  invisible (c'est ce qui avait causé le bug capio_/Bella : `Bellaroх` avec un х cyrillique
  n'était jamais rattaché et perdait ses points en silence).
- `season_stats` et `match_participants.character_id` sont indexés (`idx_characters_account`,
  `idx_match_participants_character`) pour que "afficher le détail d'un joueur" (voir
  `services.get_account_detail`) ne scanne jamais la table entière — vérifié par `EXPLAIN`
  dans les tests (Index Scan, pas de Seq Scan).
- `/lier` fusionne : si un perso avait déjà son propre compte autonome, il est réaffecté
  (FK) vers le compte Discord existant plutôt que d'empiler les liens.
- `/delier` déplace le perso vers un tout nouveau compte autonome. Les stats déjà
  accumulées restent sur le compte partagé (elles ne sont pas suivies par personnage) —
  seuls les matchs futurs de ce perso compteront à part.

Testé contre une Postgres locale jetable (docker, pas la prod) : script de bout en bout
couvrant fusion multi-comptes, dédoublonnage des points sur un même match, classement,
et `get_account_detail` avec vérification `EXPLAIN` de l'usage des index.

## Ce qui a changé par rapport au bot Node

- Les migrations de schéma ad hoc au démarrage (`ALTER TABLE ADD COLUMN IF NOT EXISTS ...`,
  la migration historique `bank_nuggets → season_stats`) ont été retirées : elles n'avaient
  de sens que pour rattraper une base existante qui avait dérivé. Sur la nouvelle base créée
  via Alembic, le schéma est déjà complet dès `upgrade head`.
- Le panel admin n'est plus un template EJS rendu côté serveur (`admin.ejs`, 81 Ko) : c'est
  maintenant une page React (`client/src/admin/`) servie sur `/admin`, qui consomme les mêmes
  endpoints JSON `/admin/api/*`. Elle couvre les contrôles principaux (pools, grilles de
  points, fin de saison, pépites, points joueur, matchs récents) mais n'est pas une
  reproduction pixel-perfect de l'ancien EJS — à affiner si besoin.
- `/admin/login` attend maintenant du JSON (`{"password": "..."}`) au lieu d'un POST de
  formulaire HTML, pour coller à la SPA React.
