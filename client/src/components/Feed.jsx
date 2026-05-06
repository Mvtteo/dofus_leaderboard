import { useState, useEffect } from 'react';
import { ago } from '../utils/helpers';

function MatchCard({ match: m, index: i }) {
  const w = m.has_won;
  return (
    <div className={`feed-card ${w ? 'win' : 'lose'}`} style={{ '--d': `${i * 0.04}s` }}>
      <div className="fc-top">
        <div className="fc-tags">
          <span className={`fc-badge ${m.context === 'defense' ? 'def' : 'atk'}`}>
            {m.context === 'defense' ? 'DEF' : 'ATK'}
          </span>
          <span className={`fc-badge ${w ? 'w' : 'l'}`}>
            {w ? 'Victoire' : 'Défaite'}
          </span>
        </div>
        <span className="fc-time">{ago(m.created_at)}</span>
      </div>
      <div className="fc-vs">vs <b>{m.alliance || 'Inconnu'}</b></div>
      <div className="fc-teams">
        <div className="fc-team">
          <div className="fc-team-label w">Gagnants</div>
          {m.winners.length
            ? m.winners.map(n => <div key={n} className="fc-player">{n}</div>)
            : <div className="fc-player">-</div>}
        </div>
        <div className="fc-sep">
          <div className="vl" />
          VS
          <div className="vl" />
        </div>
        <div className="fc-team right">
          <div className="fc-team-label l">Perdants</div>
          {m.losers.length
            ? m.losers.map(n => <div key={n} className="fc-player">{n}</div>)
            : <div className="fc-player">-</div>}
        </div>
      </div>
      <div className="fc-bottom">
        <span className={`fc-pts ${w ? 'w' : 'l'}`}>+{m.points} pts</span>
      </div>
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

  if (status === 'loading') return <div className="feed"><div className="feed-empty">Chargement…</div></div>;
  if (status === 'error') return <div className="feed"><div className="feed-empty">Erreur de chargement.</div></div>;
  if (!matches.length) return <div className="feed"><div className="feed-empty">Aucun combat enregistré.</div></div>;

  return (
    <div className="feed">
      {matches.map((m, i) => <MatchCard key={m.id} match={m} index={i} />)}
    </div>
  );
}
