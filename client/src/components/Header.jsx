export default function Header({ playerCount, totalCombats, seasons, selectedSeason, onSeasonChange, search, onSearch }) {
  return (
    <header className="header">
      <div className="header-inner">
        <div className="header-brand">
          <img className="brand-logo" src="/web/assets/logo_nemesis_round.png" alt="Nemesis" />
          <div className="brand-text">
            <span className="brand-title">Nemesis</span>
            <span className="brand-sub">Alliance PvP</span>
          </div>
        </div>

        <div className="header-spacer" />

        <div className="header-actions">
          <div className="stat-item">
            <span className="stat-value">{playerCount}</span>
            <span className="stat-label">Joueurs</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{totalCombats}</span>
            <span className="stat-label">Combats</span>
          </div>
          <div className="search-box">
            <span className="search-glyph">⌲</span>
            <input
              type="text"
              placeholder="RECHERCHER"
              value={search}
              onChange={e => onSearch(e.target.value)}
            />
          </div>
          <select
            className="season-select"
            value={selectedSeason || ''}
            onChange={e => onSeasonChange(parseInt(e.target.value))}
          >
            {[...seasons].reverse().map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>
    </header>
  );
}
