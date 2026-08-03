import { useEffect, useState } from 'react';
import { adminApi } from './api';
import Background from '../components/Background';
import '../styles/admin.scss';

const fmtDate = (raw) => {
  if (!raw) return '-';
  const [y, m, d] = raw.split('-');
  return `${d}/${m}/${y}`;
};

const DEFAULT_GRID_WIN = [[2, 4, 5, 5, 5], [1, 4, 5, 5, 5], [1, 2, 6, 6, 6], [1, 2, 3, 8, 8], [1, 2, 3, 5, 8]];
const DEFAULT_GRID_LOSE = [[1, 2, 3, 3, 3], [1, 2, 3, 3, 3], [0, 2, 3, 3, 3], [0, 0, 3, 4, 4], [0, 0, 0, 4, 5]];

function LoginScreen({ onLoggedIn }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await adminApi.login(password);
      onLoggedIn();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login">
      <Background />
      <form onSubmit={submit}>
        <div className="admin-login-brand">
          <img src="/web/assets/logo_nemesis_round.png" alt="Nemesis" />
          <h1>Admin</h1>
        </div>
        <input
          type="password"
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={loading}>{loading ? '...' : 'Connexion'}</button>
        {error && <p className="admin-error">{error}</p>}
      </form>
    </div>
  );
}

// ============================================
// SAISON & PEPITES
// ============================================
function SeasonSection({ settings, reload }) {
  const [endDate, setEndDate] = useState(settings.curSeasonEndRaw || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const daysLeft = settings.curSeasonEndRaw
    ? Math.max(0, Math.round((new Date(settings.curSeasonEndRaw) - new Date()) / 86400000))
    : '-';

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await adminApi.saveSeasonEnd(endDate || null);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-card">
      <h2>Saison en cours</h2>
      <div className="season-info">
        <div className="season-stat">
          <span className="season-stat-label">Saison</span>
          <span className="season-stat-value gold">{settings.currentSeason}</span>
        </div>
        <div className="season-stat">
          <span className="season-stat-label">Début</span>
          <span className="season-stat-value">{fmtDate(settings.curSeasonStartRaw)}</span>
        </div>
        <div className="season-stat">
          <span className="season-stat-label">Fin actuelle</span>
          <span className="season-stat-value">{fmtDate(settings.curSeasonEndRaw)}</span>
        </div>
        <div className="season-stat">
          <span className="season-stat-label">Jours restants</span>
          <span className="season-stat-value">{daysLeft}</span>
        </div>
      </div>
      <div className="admin-row">
        <label>Fin de saison forcée</label>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>
      <div className="admin-actions">
        <button className="admin-btn-primary" onClick={save} disabled={saving}>Enregistrer</button>
      </div>
      {error && <p className="admin-error">{error}</p>}
    </section>
  );
}

function NuggetsSection({ settings }) {
  const [seasonId, setSeasonId] = useState(settings.currentSeason);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    adminApi.nuggets(seasonId).then(setRows).catch((err) => setError(err.message)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [seasonId]);

  const reset = async () => {
    if (!confirm('Remettre à zéro toutes les pépites de la saison en cours ?')) return;
    try {
      await adminApi.resetNuggets();
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const total = rows.reduce((s, r) => s + (Number(r.nuggets) || 0), 0);

  return (
    <section className="admin-card">
      <div className="admin-card-header">
        <h2>Pépites</h2>
        <select value={seasonId} onChange={(e) => setSeasonId(Number(e.target.value))}>
          {(settings.seasons || []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      {loading ? <p>Chargement...</p> : error ? <p className="admin-error">{error}</p> : rows.length === 0 ? (
        <p className="admin-empty">Aucune pépite pour cette saison.</p>
      ) : (
        <table className="admin-table">
          <thead><tr><th>Joueur</th><th>Pépites</th></tr></thead>
          <tbody>
            {rows.map((r, i) => <tr key={i}><td>{r.name}</td><td>{r.nuggets}</td></tr>)}
            <tr className="admin-table-total"><td>Total alliance</td><td>{total.toLocaleString()}</td></tr>
          </tbody>
        </table>
      )}
      <div className="admin-actions">
        <button className="admin-btn-danger" onClick={reset}>Réinitialiser les pépites (saison en cours)</button>
      </div>
      {error && <p className="admin-error">{error}</p>}
    </section>
  );
}

function SaisonPepitesTab({ settings, reload }) {
  return (
    <>
      <SeasonSection settings={settings} reload={reload} />
      <NuggetsSection settings={settings} />
    </>
  );
}

// ============================================
// BAREME & POOLS
// ============================================
function PoolsSection({ settings, reload }) {
  const [pools, setPools] = useState(settings.pools);
  const [winratePool, setWinratePool] = useState(settings.defaultWinratePool || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savingWr, setSavingWr] = useState(false);
  const [wrError, setWrError] = useState(null);

  const updatePool = (i, field, value) => {
    const next = [...pools];
    next[i] = { ...next[i], [field]: field === 'bonus' ? Number(value) : value };
    setPools(next);
  };

  const addPool = () => {
    if (pools.length >= settings.maxPools) return;
    setPools([...pools, { id: `pool_${pools.length + 1}_${Date.now()}`, name: '', bonus: 0 }]);
  };

  const removePool = (i) => setPools(pools.filter((_, idx) => idx !== i));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await adminApi.savePools(pools);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveWinratePool = async () => {
    setSavingWr(true);
    setWrError(null);
    try {
      await adminApi.saveDefaultWinratePool(winratePool || null);
      await reload();
    } catch (err) {
      setWrError(err.message);
    } finally {
      setSavingWr(false);
    }
  };

  return (
    <section className="admin-card">
      <div className="admin-card-header">
        <h2>Pools d'alliances</h2>
        <span className="admin-card-hint">{pools.length}/{settings.maxPools}</span>
      </div>
      {pools.map((p, i) => (
        <div className="admin-row" key={p.id}>
          <input value={p.name} placeholder="Nom" onChange={(e) => updatePool(i, 'name', e.target.value)} />
          <input type="number" value={p.bonus} placeholder="Bonus %" onChange={(e) => updatePool(i, 'bonus', e.target.value)} />
          <button className="admin-btn-danger" onClick={() => removePool(i)}>Retirer</button>
        </div>
      ))}
      <div className="admin-actions">
        <button onClick={addPool} disabled={pools.length >= settings.maxPools}>+ Ajouter un pool</button>
        <button className="admin-btn-primary" onClick={save} disabled={saving}>Enregistrer</button>
      </div>
      {error && <p className="admin-error">{error}</p>}

      <div className="admin-subsection">
        <h3>Winrate affiché sur le leaderboard</h3>
        <div className="admin-row">
          <select value={winratePool} onChange={(e) => setWinratePool(e.target.value)}>
            <option value="">Global (V/D total)</option>
            {pools.map((p) => <option key={p.id} value={p.id}>WR vs {p.name}</option>)}
          </select>
          <button className="admin-btn-primary" onClick={saveWinratePool} disabled={savingWr}>Appliquer</button>
        </div>
        {wrError && <p className="admin-error">{wrError}</p>}
      </div>
    </section>
  );
}

const GRID_META = {
  pts_atk_win: { label: 'Attaque — Victoire', win: true },
  pts_atk_lose: { label: 'Attaque — Défaite', win: false },
  pts_def_win: { label: 'Défense — Victoire', win: true },
  pts_def_lose: { label: 'Défense — Défaite', win: false },
};

function heatmapCellStyle(v, max, win) {
  const rgb = win ? '61,189,173' : '244,162,97';
  if (v === 0) {
    return { background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.22)' };
  }
  const k = v / max;
  return {
    background: `rgba(${rgb},${(0.06 + 0.4 * k).toFixed(3)})`,
    borderColor: `rgba(${rgb},${(0.14 + 0.34 * k).toFixed(3)})`,
    color: k > 0.6 ? '#fff' : 'rgba(255,255,255,0.85)',
  };
}

function PointsGridSection({ settings, reload }) {
  const [grids, setGrids] = useState({
    pts_atk_win: settings.ptsAtkWin,
    pts_atk_lose: settings.ptsAtkLose,
    pts_def_win: settings.ptsDefWin,
    pts_def_lose: settings.ptsDefLose,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const updateCell = (gridKey, r, c, value) => {
    const next = { ...grids, [gridKey]: grids[gridKey].map((row) => [...row]) };
    next[gridKey][r][c] = Number(value) || 0;
    setGrids(next);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await adminApi.savePointsGrid(grids);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = () => {
    setGrids({
      pts_atk_win: DEFAULT_GRID_WIN.map((row) => [...row]),
      pts_atk_lose: DEFAULT_GRID_LOSE.map((row) => [...row]),
      pts_def_win: DEFAULT_GRID_WIN.map((row) => [...row]),
      pts_def_lose: DEFAULT_GRID_LOSE.map((row) => [...row]),
    });
  };

  return (
    <section className="admin-card">
      <h2>Barème de points</h2>
      <div className="grid-intro">
        <p>
          Chaque grille croise le nombre d'<span className="grid-intro-ally">alliés</span> (lignes) et
          d'<span className="grid-intro-enemy">ennemis</span> (colonnes). La valeur est le gain de points
          par joueur ; plus la cellule est vive, plus le combat rapporte.
        </p>
        <div className="grid-legend">
          <span>0 PT</span>
          <span className="grid-legend-bar" />
          <span>MAX</span>
        </div>
      </div>
      <div className="grid-heatmaps">
        {Object.entries(GRID_META).map(([key, meta]) => {
          const grid = grids[key];
          const flat = grid.flat();
          const max = Math.max(1, ...flat);
          const min = Math.min(...flat);
          const dotColor = meta.win ? '#3dbdad' : '#e76f51';
          let best = { v: -1, r: 0, c: 0 };
          grid.forEach((row, r) => row.forEach((v, c) => { if (v > best.v) best = { v, r, c }; }));
          return (
            <div key={key} className="grid-heatmap-card">
              <div className="grid-heatmap-header">
                <span className="grid-heatmap-dot" style={{ background: dotColor, boxShadow: `0 0 10px ${dotColor}` }} />
                <h3>{meta.label}</h3>
                <span className="grid-heatmap-range">{min} – {max} PTS</span>
              </div>
              <table className="grid-heatmap-table">
                <thead>
                  <tr>
                    <th></th>
                    <th colSpan={5} className="grid-heatmap-enemy-header">Ennemis</th>
                  </tr>
                  <tr>
                    <th className="grid-heatmap-corner">A↓</th>
                    {[1, 2, 3, 4, 5].map((n) => <th key={n} className="grid-heatmap-axis">{n}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {grid.map((row, r) => (
                    <tr key={r}>
                      <th className="grid-heatmap-row-header">{r + 1}</th>
                      {row.map((v, c) => {
                        const style = heatmapCellStyle(v, max, meta.win);
                        return (
                          <td key={c}>
                            <input
                              type="number"
                              value={v}
                              onChange={(e) => updateCell(key, r, c, e.target.value)}
                              style={{ background: style.background, borderColor: style.borderColor, color: style.color }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="grid-heatmap-example">A↓ alliés · Ennemis → · meilleur gain : {best.r + 1}v{best.c + 1} → {best.v} pts</p>
            </div>
          );
        })}
      </div>
      <div className="admin-actions">
        <button className="admin-btn-primary" onClick={save} disabled={saving}>Enregistrer les grilles</button>
        <button type="button" onClick={resetDefaults}>Valeurs par défaut</button>
      </div>
      {error && <p className="admin-error">{error}</p>}
    </section>
  );
}

function BaremePoolsTab({ settings, reload }) {
  return (
    <>
      <PoolsSection settings={settings} reload={reload} />
      <PointsGridSection settings={settings} reload={reload} />
    </>
  );
}

// ============================================
// JOUEURS
// ============================================
function PlayerPointsSection({ onSelectPlayer }) {
  const [allNames, setAllNames] = useState([]);
  const [query, setQuery] = useState('');
  const [showList, setShowList] = useState(false);
  const [selected, setSelected] = useState(null);
  const [current, setCurrent] = useState(null);
  const [delta, setDelta] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { adminApi.players().then(setAllNames).catch(() => {}); }, []);

  const suggestions = query.length > 0 && showList
    ? allNames.filter((n) => n.toLowerCase().includes(query.toLowerCase())).slice(0, 10)
    : [];

  const selectPlayer = async (name) => {
    setQuery(name);
    setSelected(name);
    setShowList(false);
    setDelta(0);
    setResult(null);
    setError(null);
    onSelectPlayer?.(name);
    try {
      const stats = await adminApi.playerStats(name);
      setCurrent(stats.points);
    } catch (err) {
      setError(err.message);
    }
  };

  const apply = async () => {
    if (!selected || delta === 0) return;
    setError(null);
    try {
      const r = await adminApi.setPlayerPoints(selected, delta);
      setResult(r);
      setCurrent(r.newTotal);
      setDelta(0);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="admin-card">
      <h2>Ajustement points</h2>
      <div className="admin-autocomplete">
        <input
          placeholder="Rechercher un joueur..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setShowList(true); setSelected(null); }}
          onFocus={() => setShowList(true)}
          onBlur={() => setTimeout(() => setShowList(false), 150)}
        />
        {suggestions.length > 0 && (
          <div className="admin-autocomplete-list">
            {suggestions.map((n) => (
              <div key={n} className="admin-autocomplete-item" onMouseDown={() => selectPlayer(n)}>{n}</div>
            ))}
          </div>
        )}
      </div>
      {selected && (
        <div className="admin-points-editor">
          <div className="admin-row">
            <label>Actuel</label>
            <span className="admin-points-value">{current ?? '-'}</span>
          </div>
          <div className="admin-points-controls">
            <button type="button" onClick={() => setDelta(delta - 5)}>-5</button>
            <button type="button" onClick={() => setDelta(delta - 1)}>-1</button>
            <span className={`admin-points-delta ${delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''}`}>{delta > 0 ? `+${delta}` : delta}</span>
            <button type="button" onClick={() => setDelta(delta + 1)}>+1</button>
            <button type="button" onClick={() => setDelta(delta + 5)}>+5</button>
            <button type="button" onClick={() => setDelta(0)}>Reset</button>
          </div>
          <div className="admin-row">
            <label>Prévision</label>
            <span className="admin-points-value accent">{current != null ? current + delta : '-'}</span>
            <button className="admin-btn-primary" onClick={apply} disabled={delta === 0}>Appliquer</button>
          </div>
        </div>
      )}
      {result && <p className="admin-success">{result.pseudo} : {result.delta > 0 ? '+' : ''}{result.delta} pts (total {result.newTotal})</p>}
      {error && <p className="admin-error">{error}</p>}
    </section>
  );
}

function MultiAccountsSection() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    adminApi.multiAccounts().then(setRows).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, []);

  return (
    <section className="admin-card">
      <div className="admin-card-header">
        <h2>Comptes multiples</h2>
        <span className="admin-card-hint">{rows.length}</span>
      </div>
      {loading ? <p>Chargement...</p> : error ? <p className="admin-error">{error}</p> : rows.length === 0 ? (
        <p className="admin-empty">Aucun compte avec plusieurs persos.</p>
      ) : (
        <>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Compte Discord</th>
                <th>Personnages liés</th>
                <th className="admin-table-num">Nb</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const name = r.discord_nickname || r.discord_username || '?';
                const characters = r.characters || [];
                return (
                  <tr key={i}>
                    <td>
                      <div className="admin-account-cell">
                        <span className="admin-avatar">
                          {r.avatar_url ? <img src={r.avatar_url} alt="" /> : name.charAt(0).toUpperCase()}
                        </span>
                        <span className="admin-account-names">
                          <span className="admin-account-name">{name}</span>
                          {r.discord_username && <span className="admin-account-tag">@{r.discord_username}</span>}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="admin-chip-list">
                        {characters.map((c, ci) => (
                          <span key={ci} className={`admin-chip${ci === 0 ? ' main' : ''}`}>{c}</span>
                        ))}
                      </div>
                    </td>
                    <td className="admin-table-num">{r.count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="admin-note">Les points sont agrégés par compte Discord ; la puce pleine indique le perso principal affiché sur le leaderboard.</p>
        </>
      )}
    </section>
  );
}

function PlayerMatchesSection({ pseudo }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!pseudo) return;
    setLoading(true);
    setError(null);
    adminApi.playerMatches(pseudo).then(setMatches).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, [pseudo]);

  if (!pseudo) return null;

  return (
    <section className="admin-card">
      <h2>Historique — <span className="admin-card-accent">{pseudo}</span></h2>
      {loading ? <p>Chargement...</p> : error ? <p className="admin-error">{error}</p> : matches.length === 0 ? (
        <p className="admin-empty">Aucun match.</p>
      ) : (
        <table className="admin-table">
          <thead><tr><th>Alliance</th><th>Contexte</th><th>Résultat</th><th>Points</th></tr></thead>
          <tbody>
            {matches.map((m) => (
              <tr key={m.id} className={m.cancelled ? 'admin-row-cancelled' : ''}>
                <td>{m.alliance}</td>
                <td>{m.context}</td>
                <td>{m.has_won ? 'Victoire' : 'Défaite'}</td>
                <td>{m.points_awarded}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function RecentMatchesSection() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    setError(null);
    adminApi.recentMatches().then(setMatches).catch((err) => setError(err.message)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const editPoints = async (id, current) => {
    const value = prompt('Nouveaux points pour ce match :', current);
    if (value === null || isNaN(Number(value))) return;
    try {
      await adminApi.setMatchPoints(id, Number(value));
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const cancelMatch = async (id) => {
    if (!confirm('Annuler ce match ? Les points seront retirés des joueurs concernés.')) return;
    try {
      await adminApi.cancelMatch(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="admin-card">
      <div className="admin-card-header">
        <h2>Derniers matchs</h2>
        <button onClick={load}>Actualiser</button>
      </div>
      {loading ? <p>Chargement...</p> : error ? <p className="admin-error">{error}</p> : matches.length === 0 ? (
        <p className="admin-empty">Aucun match enregistré pour la saison en cours.</p>
      ) : (
        <table className="admin-table">
          <thead><tr><th>Alliance</th><th>Contexte</th><th>Résultat</th><th>Points</th><th>Gagnants</th><th>Perdants</th><th></th></tr></thead>
          <tbody>
            {matches.map((m) => (
              <tr key={m.id} className={m.cancelled ? 'admin-row-cancelled' : ''}>
                <td>{m.alliance}</td>
                <td>{m.context}</td>
                <td>{m.has_won ? 'Victoire' : 'Défaite'}</td>
                <td>{m.points_awarded}</td>
                <td>{m.winners.join(', ')}</td>
                <td>{m.losers.join(', ')}</td>
                <td>
                  {!m.cancelled && (
                    <>
                      <button onClick={() => editPoints(m.id, m.points_awarded)}>Modifier</button>
                      <button className="admin-btn-danger" onClick={() => cancelMatch(m.id)}>Annuler</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function JoueursTab() {
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  return (
    <>
      <div className="admin-grid-2col">
        <PlayerPointsSection onSelectPlayer={setSelectedPlayer} />
        <MultiAccountsSection />
      </div>
      <PlayerMatchesSection pseudo={selectedPlayer} />
      <RecentMatchesSection />
    </>
  );
}

const TABS = [
  { id: 'saison', label: 'Saison & Pépites', Component: SaisonPepitesTab },
  { id: 'bareme', label: 'Barème & Pools', Component: BaremePoolsTab },
  { id: 'joueurs', label: 'Joueurs', Component: JoueursTab },
];

export default function AdminApp() {
  const [authed, setAuthed] = useState(null);
  const [settings, setSettings] = useState(null);
  const [tab, setTab] = useState('saison');

  const loadSettings = () => adminApi.settings().then(setSettings);

  useEffect(() => {
    adminApi.me().then((r) => {
      setAuthed(r.authenticated);
      if (r.authenticated) loadSettings();
    });
  }, []);

  if (authed === null) return null;
  if (!authed) {
    return <LoginScreen onLoggedIn={() => { setAuthed(true); loadSettings(); }} />;
  }
  if (!settings) return <div className="admin-app">Chargement...</div>;

  const ActiveComponent = TABS.find((t) => t.id === tab).Component;

  return (
    <div className="admin-app">
      <Background />
      <header className="admin-header">
        <div className="admin-header-brand">
          <img src="/web/assets/logo_nemesis_round.png" alt="Nemesis" />
          <div className="admin-header-titles">
            <h1>Administration</h1>
            <span className="admin-header-subtitle">Nemesis · PvP Tracker</span>
          </div>
        </div>
        <div className="admin-header-actions">
          <span className="admin-header-season">Saison {settings.currentSeason} · En cours</span>
          <button onClick={() => adminApi.logout().then(() => setAuthed(false))}>Déconnexion</button>
        </div>
      </header>
      <nav className="admin-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </nav>
      <main>
        <ActiveComponent settings={settings} reload={loadSettings} />
      </main>
      <footer className="admin-footer">Nemesis · Panneau d'administration</footer>
    </div>
  );
}
