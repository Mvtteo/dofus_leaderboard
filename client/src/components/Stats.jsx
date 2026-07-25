import { useState, useEffect } from 'react';
import { wrColor } from '../utils/helpers';

function PoolCard({ pool: p }) {
  return (
    <div className="pool-card">
      <div>
        <div className="pool-name">{p.name}</div>
        <div className="pool-sub" style={{ color: wrColor(p.winrate) }}>{p.winrate}% WR · {p.total} combats</div>
      </div>
      <div className="pool-figures">
        <div>
          <div className="pool-fig-value" style={{ color: wrColor(p.atk_winrate) }}>{p.atk_winrate}%</div>
          <div className="pool-fig-label">WR attaque</div>
        </div>
        <div>
          <div className="pool-fig-value" style={{ color: wrColor(p.def_winrate) }}>{p.def_winrate}%</div>
          <div className="pool-fig-label">WR défense</div>
        </div>
        <div>
          <div className="pool-fig-value">{p.total_points}</div>
          <div className="pool-fig-label">Points</div>
        </div>
      </div>
      {p.top_players.length > 0 && (
        <div className="pool-mvp">
          <span className="pool-mvp-label">MVP</span>
          {p.top_players.map(tp => (
            <div key={tp.name} className="pool-mvp-row">
              <span>{tp.name}</span>
              <span className="w">{tp.wins}V</span>
            </div>
          ))}
        </div>
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

  return (
    <div className="stats-page">
      <div className="global-wr-row">
        <div>
          <span className="global-wr-label">Winrate global</span>
          <div className="global-wr-value" style={{ color: wrColor(gWr) }}>{gWr}%</div>
        </div>
        <span className="global-wr-record">{tW}V / {tL}D — {tG} COMBATS</span>
      </div>

      <div className="pools-grid">
        {data.pools.map(p => <PoolCard key={p.name} pool={p} />)}
      </div>

      <div className="hours-section">
        <span className="hours-label">Distribution horaire</span>
        <div className="hours-chart">
          {data.hours.map((v, i) => (
            <div
              key={i}
              className={`hour-bar${v >= mH * 0.7 ? ' peak' : ''}`}
              style={{ height: `${Math.max(Math.round(v / mH * 100), 2)}%` }}
            />
          ))}
        </div>
        <div className="hours-labels">
          {Array.from({ length: 24 }, (_, i) => (
            <span key={i}>{i % 3 === 0 ? `${i}H` : ''}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
