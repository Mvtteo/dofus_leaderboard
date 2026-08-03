import { useEffect, useState } from 'react';
import { adminApi } from './api';
import '../styles/admin.scss';

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
      <form onSubmit={submit}>
        <h1>Admin</h1>
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

function PoolsSection({ settings, reload }) {
  const [pools, setPools] = useState(settings.pools);
  const [saving, setSaving] = useState(false);

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
    try {
      await adminApi.savePools(pools);
      await reload();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-card">
      <h2>Pools d'alliances</h2>
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
    </section>
  );
}

function PointsGridSection({ settings, reload }) {
  const [grids, setGrids] = useState({
    pts_atk_win: settings.ptsAtkWin,
    pts_atk_lose: settings.ptsAtkLose,
    pts_def_win: settings.ptsDefWin,
    pts_def_lose: settings.ptsDefLose,
  });
  const [saving, setSaving] = useState(false);

  const updateCell = (gridKey, r, c, value) => {
    const next = { ...grids, [gridKey]: grids[gridKey].map((row) => [...row]) };
    next[gridKey][r][c] = Number(value);
    setGrids(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      await adminApi.savePointsGrid(grids);
      await reload();
    } finally {
      setSaving(false);
    }
  };

  const gridLabels = {
    pts_atk_win: 'Attaque — Victoire',
    pts_atk_lose: 'Attaque — Défaite',
    pts_def_win: 'Défense — Victoire',
    pts_def_lose: 'Défense — Défaite',
  };

  return (
    <section className="admin-card">
      <h2>Grilles de points</h2>
      {Object.entries(gridLabels).map(([key, label]) => (
        <div key={key} className="admin-grid-block">
          <h3>{label}</h3>
          <table className="admin-grid-table">
            <tbody>
              {grids[key].map((row, r) => (
                <tr key={r}>
                  {row.map((val, c) => (
                    <td key={c}>
                      <input type="number" value={val} onChange={(e) => updateCell(key, r, c, e.target.value)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className="admin-actions">
        <button className="admin-btn-primary" onClick={save} disabled={saving}>Enregistrer les grilles</button>
      </div>
    </section>
  );
}

function SeasonSection({ settings, reload }) {
  const [endDate, setEndDate] = useState(settings.curSeasonEndRaw || '');
  const [winratePool, setWinratePool] = useState(settings.defaultWinratePool || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await adminApi.saveSeasonEnd(endDate || null);
      await adminApi.saveDefaultWinratePool(winratePool || null);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-card">
      <h2>Saison {settings.currentSeason}</h2>
      <div className="admin-row">
        <label>Fin de saison forcée</label>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>
      <div className="admin-row">
        <label>Pool de référence pour le winrate</label>
        <select value={winratePool} onChange={(e) => setWinratePool(e.target.value)}>
          <option value="">Aucun (global)</option>
          {settings.pools.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="admin-actions">
        <button className="admin-btn-primary" onClick={save} disabled={saving}>Enregistrer</button>
      </div>
      {error && <p className="admin-error">{error}</p>}
    </section>
  );
}

function NuggetsSection({ settings }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => adminApi.nuggets(settings.currentSeason).then(setRows).finally(() => setLoading(false));
  useEffect(() => { load(); }, [settings.currentSeason]);

  const reset = async () => {
    if (!confirm('Remettre à zéro toutes les pépites de la saison en cours ?')) return;
    await adminApi.resetNuggets();
    await load();
  };

  return (
    <section className="admin-card">
      <h2>Pépites</h2>
      {loading ? <p>Chargement...</p> : (
        <table className="admin-table">
          <thead><tr><th>Joueur</th><th>Pépites</th></tr></thead>
          <tbody>
            {rows.map((r, i) => <tr key={i}><td>{r.name}</td><td>{r.nuggets}</td></tr>)}
          </tbody>
        </table>
      )}
      <div className="admin-actions">
        <button className="admin-btn-danger" onClick={reset}>Réinitialiser les pépites</button>
      </div>
    </section>
  );
}

function PlayerPointsSection() {
  const [pseudo, setPseudo] = useState('');
  const [points, setPoints] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    try {
      const r = await adminApi.setPlayerPoints(pseudo, Number(points));
      setResult(r);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="admin-card">
      <h2>Ajuster les points d'un joueur</h2>
      <form onSubmit={submit} className="admin-row">
        <input placeholder="Pseudo" value={pseudo} onChange={(e) => setPseudo(e.target.value)} />
        <input type="number" placeholder="Delta (+/-)" value={points} onChange={(e) => setPoints(e.target.value)} />
        <button type="submit" className="admin-btn-primary">Appliquer</button>
      </form>
      {result && <p className="admin-success">{result.pseudo} : {result.delta > 0 ? '+' : ''}{result.delta} pts (total {result.newTotal})</p>}
      {error && <p className="admin-error">{error}</p>}
    </section>
  );
}

function MatchesSection() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => adminApi.recentMatches().then(setMatches).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const editPoints = async (id, current) => {
    const value = prompt('Nouveaux points pour ce match :', current);
    if (value === null || isNaN(Number(value))) return;
    await adminApi.setMatchPoints(id, Number(value));
    await load();
  };

  const cancelMatch = async (id) => {
    if (!confirm('Annuler ce match ? Les points seront retirés des joueurs concernés.')) return;
    await adminApi.cancelMatch(id);
    await load();
  };

  return (
    <section className="admin-card">
      <h2>Matchs récents</h2>
      {loading ? <p>Chargement...</p> : (
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

const TABS = [
  { id: 'pools', label: 'Pools', Component: PoolsSection },
  { id: 'grid', label: 'Grilles', Component: PointsGridSection },
  { id: 'season', label: 'Saison', Component: SeasonSection },
  { id: 'nuggets', label: 'Pépites', Component: NuggetsSection },
  { id: 'player-points', label: 'Points joueur', Component: PlayerPointsSection },
  { id: 'matches', label: 'Matchs', Component: MatchesSection },
];

export default function AdminApp() {
  const [authed, setAuthed] = useState(null);
  const [settings, setSettings] = useState(null);
  const [tab, setTab] = useState('pools');

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
      <header className="admin-header">
        <h1>Administration</h1>
        <button onClick={() => adminApi.logout().then(() => setAuthed(false))}>Déconnexion</button>
      </header>
      <nav className="admin-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </nav>
      <main>
        <ActiveComponent settings={settings} reload={loadSettings} />
      </main>
    </div>
  );
}
