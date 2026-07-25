import { useState, useEffect } from 'react';
import { ago } from '../utils/helpers';

function MatchRow({ match: m }) {
  const w = m.has_won;
  return (
    <div className="feed-row">
      <div className="feed-outcome">
        <span className={`feed-chip ${w ? 'win' : 'lose'}`}>{w ? 'VICTOIRE' : 'DÉFAITE'}</span>
        <span className="feed-context">{m.context === 'defense' ? 'DÉFENSE' : 'ATTAQUE'} · {ago(m.created_at)}</span>
      </div>
      <div className="feed-adversary">
        <span className="feed-adversary-label">Adversaire</span>
        <div className="feed-alliance">{m.alliance || 'Inconnu'}</div>
      </div>
      <div className="feed-teams">
        <div className="feed-team">
          <span className="feed-team-label win">Gagnants</span>
          {m.winners.length
            ? m.winners.map(n => <span key={n} className="feed-player">{n}</span>)
            : <span className="feed-player">-</span>}
        </div>
        <div className="feed-team">
          <span className="feed-team-label lose">Perdants</span>
          {m.losers.length
            ? m.losers.map(n => <span key={n} className="feed-player lose">{n}</span>)
            : <span className="feed-player lose">-</span>}
        </div>
      </div>
      <span className={`feed-points ${w ? 'win' : 'lose'}`}>+{m.points}</span>
    </div>
  );
}

export default function Feed({ selectedSeason }) {
  const [matches, setMatches] = useState([]);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    if (!selectedSeason) return;
    setStatus('loading');
    fetch(`/api/matches/${selectedSeason}?limit=30`)
      .then(r => r.json())
      .then(data => { setMatches(data); setStatus('ok'); })
      .catch(() => setStatus('error'));
  }, [selectedSeason]);

  return (
    <div className="feed-page">
      <h1 className="feed-title">Derniers<br /><span className="feed-outline">combats</span></h1>
      {status === 'loading' && <div className="feed-empty">Chargement…</div>}
      {status === 'error' && <div className="feed-empty">Erreur de chargement.</div>}
      {status === 'ok' && (
        matches.length
          ? <div className="feed-list">{matches.map(m => <MatchRow key={m.id} match={m} />)}</div>
          : <div className="feed-empty">Aucun combat enregistré.</div>
      )}
    </div>
  );
}
