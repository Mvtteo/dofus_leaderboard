import { useState, useEffect } from 'react';
import { wrColor } from '../utils/helpers';

function isNazolas(pseudo) {
  return pseudo?.toLowerCase() === 'nazolas';
}

function avatarSrc(player, rank) {
  if (isNazolas(player.dofus_pseudo)) return '/assets/dog.jpeg';
  if (player.avatar_url) return player.avatar_url;
  return `/web/assets/avatar_placeholder_${((rank - 1) % 6) + 1}.png`;
}

function segments(w) {
  const filled = Math.round(w / 10);
  return Array.from({ length: 10 }, (_, i) => i < filled);
}

const PODIUM_ACCENTS = ['var(--accent)', 'var(--ink)', 'var(--accent2)'];

function PodiumRow({ player, rank }) {
  const w = player.winrate || 0;
  const accent = PODIUM_ACCENTS[rank - 1];
  const wc = wrColor(w);
  const segs = segments(w);

  return (
    <div className="fight-row" style={{ background: rank === 1 ? 'var(--bg-row-1)' : 'transparent' }}>
      <span className="fight-rank" style={{ color: accent }}>{rank}</span>
      <div className="fight-identity">
        <div className="fight-avatar" style={{ borderColor: accent }}>
          <img src={avatarSrc(player, rank)} alt={player.dofus_pseudo} />
        </div>
        <div className="fight-name-block">
          <span className="fight-name">{player.dofus_pseudo}</span>
          <span className="fight-record">{player.wins}V / {player.losses}D</span>
        </div>
      </div>
      <div className="fight-winrate">
        <div className="fight-wr-top">
          <span className="fight-wr-label">Winrate</span>
          <span className="fight-wr-value" style={{ color: wc }}>{w}%</span>
        </div>
        <div className="fight-segs">
          {segs.map((on, i) => <div key={i} style={{ background: on ? wc : 'var(--seg-empty)' }} />)}
        </div>
        <div className="fight-mini-row">
          <span>ATK {(player.atk_points || 0).toLocaleString()}</span>
          <span>DEF {(player.def_points || 0).toLocaleString()}</span>
        </div>
      </div>
      <div className="fight-score">
        <div className="fight-score-value" style={{ color: accent }}>{parseInt(player.total_points).toLocaleString()}</div>
        <div className="fight-score-label">Points</div>
      </div>
    </div>
  );
}

function Podium({ filteredPlayers }) {
  if (filteredPlayers.length < 3) return null;
  return (
    <section className="fight-cards">
      {filteredPlayers.slice(0, 3).map((player, i) => (
        <PodiumRow key={player.dofus_pseudo} player={player} rank={i + 1} />
      ))}
    </section>
  );
}

function Pagination({ currentPage, totalPages, totalCount, onPageChange }) {
  const a = Math.max(1, currentPage - 2);
  const b = Math.min(totalPages, currentPage + 2);
  const pages = Array.from({ length: b - a + 1 }, (_, i) => a + i);

  return (
    <div className="pagination-container">
      <span className="page-info">{totalCount} joueurs — page {currentPage} / {totalPages}</span>
      {totalPages > 1 && (
        <div className="page-buttons">
          {pages.map(i => (
            <button key={i} className={`page-btn${i === currentPage ? ' active' : ''}`} onClick={() => onPageChange(i)}>{i}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function LeaderboardTable({ filteredPlayers, allPlayers, pools, defaultWinratePool }) {
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 12;

  useEffect(() => { setCurrentPage(1); }, [filteredPlayers]);

  const totalPages = Math.max(1, Math.ceil(filteredPlayers.length / rowsPerPage));
  const pageItems = filteredPlayers.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
  const poolName = defaultWinratePool ? pools.find(p => p.id === defaultWinratePool)?.name : null;

  return (
    <section className="leaderboard-section">
      <div className="table-head">
        <span className="col-rank">Rang</span>
        <span className="col-player">Joueur</span>
        <span className="col-winrate">Winrate{poolName && <> · vs {poolName}</>}</span>
        <span className="col-atk">Atk</span>
        <span className="col-def">Def</span>
        <span className="col-score">Score</span>
      </div>

      {pageItems.length === 0 ? (
        <div className="table-empty">Aucun joueur trouvé</div>
      ) : pageItems.map(player => {
        const rk = allPlayers.indexOf(player) + 1;
        const w = player.winrate || 0;
        const wc = wrColor(w);
        const segs = segments(w);
        const d = player.rank_change;
        return (
          <div key={player.dofus_pseudo} className="table-row">
            <div className="cell-rank">
              <span className={rk <= 3 ? 'rank-top' : ''}>{rk}</span>
              {!!d && <span className={`rank-delta ${d > 0 ? 'up' : 'down'}`}>{d > 0 ? `↑${d}` : `↓${Math.abs(d)}`}</span>}
            </div>
            <div className="cell-player">
              <div className="player-avatar"><img src={avatarSrc(player, rk)} alt={player.dofus_pseudo} /></div>
              <span className="player-name">{player.dofus_pseudo}</span>
            </div>
            <div className="cell-winrate">
              <div className="winrate-segs">
                {segs.map((on, i) => <div key={i} style={{ background: on ? wc : 'var(--seg-empty)' }} />)}
              </div>
              <span className="winrate-value" style={{ color: wc }}>{w}%</span>
            </div>
            <span className="cell-atk">{(player.atk_points || 0).toLocaleString()}</span>
            <span className="cell-def">{(player.def_points || 0).toLocaleString()}</span>
            <span className="cell-score">{parseInt(player.total_points).toLocaleString()}</span>
          </div>
        );
      })}

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        totalCount={filteredPlayers.length}
        onPageChange={setCurrentPage}
      />
    </section>
  );
}

export default function Leaderboard({ filteredPlayers, allPlayers, pools, defaultWinratePool, seasonId }) {
  return (
    <>
      <section className="ranking-hero">
        <div>
          <span className="hero-eyebrow">Saison {seasonId} — Alliance</span>
          <h1 className="hero-title">Classement<br /><span className="hero-outline">de l'alliance</span></h1>
        </div>
        <p className="hero-desc">
          Points d'attaque et de défense agrégés par compte. Rafraîchi toutes les 15 s depuis le bot.
        </p>
      </section>

      <Podium filteredPlayers={filteredPlayers} />
      <LeaderboardTable
        filteredPlayers={filteredPlayers}
        allPlayers={allPlayers}
        pools={pools}
        defaultWinratePool={defaultWinratePool}
      />
    </>
  );
}
