import { useState, useEffect } from 'react';
import { wrColor } from '../utils/helpers';

const LEVEL_COLORS = ['', '#5ec4b6', '#2a9d8f', '#e9c46a', '#e9c46a'];

function PoolCard({ pool: p }) {
  return (
    <div className="pool-card">
      <div className="pool-name">
        {p.name}
        <span className="wr-badge" style={{ background: 'rgba(42,157,143,0.1)', color: wrColor(p.winrate) }}>
          {p.winrate}% WR
        </span>
      </div>
      <div className="pool-stats">
        <div className="pool-stat"><div className="v">{p.total}</div><div className="l">Combats</div></div>
        <div className="pool-stat">
          <div className="v" style={{ color: wrColor(p.atk_winrate) }}>{p.atk_winrate}%</div>
          <div className="l">WR Attaque</div>
        </div>
        <div className="pool-stat">
          <div className="v" style={{ color: wrColor(p.def_winrate) }}>{p.def_winrate}%</div>
          <div className="l">WR Défense</div>
        </div>
        <div className="pool-stat"><div className="v">{p.total_points}</div><div className="l">Points</div></div>
      </div>
      {p.top_players.length > 0 && (
        <>
          <div className="st-label" style={{ marginBottom: '6px' }}>MVP vs {p.name}</div>
          <div className="pool-top">
            {p.top_players.map((tp, i) => (
              <div key={tp.name} className="player">
                <span style={{ color: LEVEL_COLORS[3 - i > 0 ? 3 - i : 1] }}>{i + 1}.</span>
                <b>{tp.name}</b> — {tp.wins}W
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Stats({ selectedSeason }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    if (!selectedSeason) return;
    setStatus('loading');
    fetch(`/api/stats/${selectedSeason}`)
      .then(r => r.json())
      .then(d => { setData(d); setStatus('ok'); })
      .catch(() => setStatus('error'));
  }, [selectedSeason]);

  if (status === 'loading') return <div className="feed-empty">Chargement…</div>;
  if (status === 'error' || !data?.pools?.length) return <div className="feed-empty">Pas de données.</div>;

  const tW = data.pools.reduce((a, p) => a + p.wins, 0);
  const tL = data.pools.reduce((a, p) => a + p.losses, 0);
  const tG = tW + tL;
  const gWr = tG > 0 ? Math.round(tW / tG * 100) : 0;
  const mH = Math.max(...data.hours, 1);
  const hTotal = data.hours.reduce((a, b) => a + b, 0) || 1;

  return (
    <div id="statsContent">
      <div className="stats-grid">
        <div className="stat-card full">
          <div className="st-label">Winrate global</div>
          <div className="st-big" style={{ color: wrColor(gWr) }}>{gWr}%</div>
          <div className="st-sub">{tW}V / {tL}D — {tG} combats</div>
        </div>
      </div>

      {data.pools.map(p => <PoolCard key={p.name} pool={p} />)}

      <div className="stat-card full">
        <div className="st-label">Distribution horaire</div>
        <div className="hours-chart">
          {data.hours.map((v, i) => (
            <div
              key={i}
              className="hour-bar"
              style={{ height: `${Math.max(Math.round(v / mH * 100), 2)}%` }}
              data-v={Math.round(v / hTotal * 100)}
            />
          ))}
        </div>
        <div className="hours-labels">
          {Array.from({ length: 24 }, (_, i) => (
            <span key={i}>{i % 3 === 0 ? `${i}h` : ''}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
