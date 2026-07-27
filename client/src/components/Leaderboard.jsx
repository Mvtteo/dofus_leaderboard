import { useState, useEffect, useLayoutEffect } from 'react';
import { perco, wrColor, wrClass, C, LEVEL_COLORS, LEVEL_GRADIENTS, LEVEL_OPACITY } from '../utils/helpers';

function Avatar({ player }) {
  return player.avatar_url
    ? <img src={player.avatar_url} alt={player.dofus_pseudo} />
    : <>{player.dofus_pseudo.charAt(0).toUpperCase()}</>;
}

function PercoRingBig({ level }) {
  if (!level) return null;
  const c = LEVEL_COLORS[level];
  const offset = C * (1 - level / 4);
  return (
    <div className="lvl">
      <div className="lvl-glow" style={{
        background: `radial-gradient(circle, ${LEVEL_GRADIENTS[level]} 0%, transparent 70%)`,
        opacity: LEVEL_OPACITY[level],
      }} />
      <svg viewBox="0 0 24 24">
        <circle className="rbg" cx="12" cy="12" r="10" />
        <circle className="rfg" cx="12" cy="12" r="10" stroke={c} strokeDasharray={C} strokeDashoffset={offset} />
      </svg>
      <span className="ln" style={{ color: c }}>{level}</span>
    </div>
  );
}

function PercoRingSmall({ level }) {
  if (!level) return null;
  const c = LEVEL_COLORS[level];
  const offset = C * (1 - level / 4);
  return (
    <div className="lvs">
      <svg viewBox="0 0 24 24">
        <circle className="rbg" cx="12" cy="12" r="10" />
        <circle className="rfg" cx="12" cy="12" r="10" stroke={c} strokeDasharray={C} strokeDashoffset={offset} />
      </svg>
      <span className="ln" style={{ color: c }}>{level}</span>
    </div>
  );
}

function PodiumCard({ player, allPlayers, cls, lbl, animDelay }) {
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const t = setTimeout(() => setVisible(true), 100 + animDelay * 1000);
    return () => clearTimeout(t);
  }, []);

  const rk = allPlayers.indexOf(player) + 1;
  const pc = perco(parseInt(player.total_points), rk);
  const w = player.winrate || 0;

  return (
    <div
      className={`pod-card ${cls}${visible ? ' visible' : ''}`}
      style={{ transitionDelay: `${animDelay}s` }}
    >
      <div className="pod-rank-label">{lbl}</div>
      <div className="pod-avatar"><Avatar player={player} /></div>
      <div className="pod-player-name">{player.dofus_pseudo}</div>
      <div className="pod-score">{parseInt(player.total_points).toLocaleString()} pts</div>
      <div className="pod-wr-bar">
        <div className={`pod-wr-fill ${wrClass(w)}`} style={{ width: `${w}%` }} />
      </div>
      <div className="pod-stats-row">
        <div className="pod-mini-stat">
          <div className="val" style={{ color: wrColor(w) }}>{w}%</div>
          <div className="lbl">Winrate</div>
        </div>
        <div className="pod-mini-stat">
          <div className="val">{player.wins}</div>
          <div className="lbl">Victoires</div>
        </div>
        <div className="pod-mini-stat">
          <div className="val">{player.losses}</div>
          <div className="lbl">Défaites</div>
        </div>
      </div>
      <div className="pod-lvl"><PercoRingBig level={pc} /></div>
    </div>
  );
}

function Podium({ filteredPlayers, allPlayers }) {
  if (filteredPlayers.length < 3) return <section className="podium-section" />;

  const items = [
    { player: filteredPlayers[1], cls: 'silver', lbl: '2ND', delay: 0 },
    { player: filteredPlayers[0], cls: 'gold', lbl: '1ST', delay: 0.12 },
    { player: filteredPlayers[2], cls: 'bronze', lbl: '3RD', delay: 0.24 },
  ];

  return (
    <section className="podium-section">
      <div className="podium-cards">
        {items.map(({ player, cls, lbl, delay }) => (
          <PodiumCard
            key={player.dofus_pseudo}
            player={player}
            allPlayers={allPlayers}
            cls={cls}
            lbl={lbl}
            animDelay={delay}
          />
        ))}
      </div>
    </section>
  );
}

function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  const a = Math.max(1, currentPage - 2);
  const b = Math.min(totalPages, currentPage + 2);

  return (
    <div className="pagination-container">
      <button className="page-btn" disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)}>&#x2039;</button>

      {a > 1 && (
        <>
          <button className={`page-btn${currentPage === 1 ? ' active' : ''}`} onClick={() => onPageChange(1)}>1</button>
          {a > 2 && <span className="pagination-dots">…</span>}
        </>
      )}

      {Array.from({ length: b - a + 1 }, (_, i) => a + i).map(i => (
        <button key={i} className={`page-btn${i === currentPage ? ' active' : ''}`} onClick={() => onPageChange(i)}>{i}</button>
      ))}

      {b < totalPages && (
        <>
          {b < totalPages - 1 && <span className="pagination-dots">…</span>}
          <button className={`page-btn${currentPage === totalPages ? ' active' : ''}`} onClick={() => onPageChange(totalPages)}>{totalPages}</button>
        </>
      )}

      <button className="page-btn" disabled={currentPage === totalPages} onClick={() => onPageChange(currentPage + 1)}>&#x203A;</button>
    </div>
  );
}

function LeaderboardTable({ filteredPlayers, allPlayers, pools, defaultWinratePool }) {
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 10;

  useEffect(() => { setCurrentPage(1); }, [filteredPlayers]);

  const totalPages = Math.ceil(filteredPlayers.length / rowsPerPage);
  const pageItems = filteredPlayers.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
  const poolName = defaultWinratePool ? pools.find(p => p.id === defaultWinratePool)?.name : null;

  return (
    <section className="leaderboard-section">
      <div className="table-container">
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th className="col-rank">RANG</th>
              <th className="col-player">JOUEUR</th>
              <th className="col-perco">PERCO</th>
              <th className="col-winrate">
                WINRATE
                {poolName && <span style={{ fontSize: '0.6em', opacity: 0.6 }}> vs {poolName}</span>}
              </th>
              <th className="col-atk">ATTAQUE</th>
              <th className="col-def">DÉFENSE</th>
              <th className="col-score">SCORE</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: '40px', color: 'rgba(255,255,255,0.2)' }}>
                  Aucun joueur trouvé.
                </td>
              </tr>
            ) : pageItems.map(player => {
              const rk = allPlayers.indexOf(player) + 1;
              const w = player.winrate || 0;
              const pc = perco(parseInt(player.total_points), rk);
              const rowCls = rk <= 3 ? `top-${rk}` : '';
              return (
                <tr
                  key={player.dofus_pseudo}
                  className={`player-row ${rowCls} visible`}
                >
                  <td className="cell-rank">
                    <div className="rank-badge">
                      {rk <= 3
                        ? <div className={`rank-medal rank-${rk}`}>{rk}</div>
                        : <span>{rk}</span>}
                    </div>
                  </td>
                  <td className="cell-player">
                    <div className="player-info">
                      <div className="player-avatar"><Avatar player={player} /></div>
                      <span className="player-name">{player.dofus_pseudo}</span>
                    </div>
                  </td>
                  <td className="cell-perco"><PercoRingSmall level={pc} /></td>
                  <td className="cell-winrate">
                    <div className="winrate-container">
                      <div className="winrate-bar">
                        <div className={`winrate-fill fill-${wrClass(w)}`} style={{ width: `${w}%` }} />
                      </div>
                      <span className={`winrate-value text-${wrClass(w)}`}>{w}%</span>
                    </div>
                    <span className="winrate-detail">{player.wins}V / {player.losses}D</span>
                  </td>
                  <td className="cell-atk">{(player.atk_points || 0).toLocaleString()}</td>
                  <td className="cell-def">{(player.def_points || 0).toLocaleString()}</td>
                  <td className="cell-score">
                    <span className="score-value">{parseInt(player.total_points).toLocaleString()}</span>
                    <span className="score-label">pts</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
    </section>
  );
}

export default function Leaderboard({ filteredPlayers, allPlayers, pools, defaultWinratePool }) {
  return (
    <>
      <Podium filteredPlayers={filteredPlayers} allPlayers={allPlayers} />
      <LeaderboardTable
        filteredPlayers={filteredPlayers}
        allPlayers={allPlayers}
        pools={pools}
        defaultWinratePool={defaultWinratePool}
      />
    </>
  );
}
