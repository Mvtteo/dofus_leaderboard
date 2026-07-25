import { useState, useEffect } from 'react';
import { ago } from '../utils/helpers';

export default function Ticker({ selectedSeason }) {
  const [matches, setMatches] = useState([]);

  useEffect(() => {
    if (!selectedSeason) return;
    fetch(`/api/matches/${selectedSeason}?limit=20`)
      .then(r => r.json())
      .then(setMatches)
      .catch(() => setMatches([]));
  }, [selectedSeason]);

  if (!matches.length) return null;

  const items = matches.map(m => ({
    id: m.id,
    win: m.has_won,
    text: `${m.context === 'defense' ? 'DEF' : 'ATK'} vs ${(m.alliance || 'INCONNU').toUpperCase()}  +${m.points} PTS  ${ago(m.created_at).toUpperCase()}`,
  }));
  const looped = items.concat(items);

  return (
    <div className="ticker">
      <div className="ticker-track">
        {looped.map((t, i) => (
          <div key={i} className="ticker-item">
            <span className={`ticker-tag ${t.win ? 'win' : 'lose'}`}>{t.win ? 'VICTOIRE' : 'DÉFAITE'}</span>
            <span className="ticker-text">{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
