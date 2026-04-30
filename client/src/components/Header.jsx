import { useState, useEffect, useRef } from 'react';

export default function Header({ playerCount, totalCombats, seasons, selectedSeason, onSeasonChange, search, onSearch }) {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  return (
    <header className="header">
      <div className="header-inner">
        <div className="header-brand">
          <div className="logo">
            <img src="/web/assets/logo_ogre.png" alt="Logo" />
          </div>
          <div className="brand-text">
            <h1 className="brand-title">OGRE</h1>
            <span className="brand-sub">PVP TRACKER</span>
          </div>
        </div>

        <div className="header-stats">
          <div className="stat-item">
            <div className="stat-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div className="stat-content">
              <span className="stat-value">{playerCount}</span>
              <span className="stat-label">Joueurs</span>
            </div>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <div className="stat-icon gold">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14.5 17.5L3 6V3h3l11.5 11.5" />
                <path d="M13 19l6-6" />
                <path d="M16 16l4 4" />
                <path d="M19 21l2-2" />
              </svg>
            </div>
            <div className="stat-content">
              <span className="stat-value">{totalCombats}</span>
              <span className="stat-label">Combats</span>
            </div>
          </div>
        </div>

        <div className="header-actions">
          <div className={`search-container${expanded ? ' expanded' : ''}`}>
            <button className="search-toggle" onClick={() => setExpanded(v => !v)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
            </button>
            <input
              ref={inputRef}
              type="text"
              placeholder="Rechercher..."
              value={search}
              onChange={e => onSearch(e.target.value)}
              onBlur={() => { if (!search) setExpanded(false); }}
            />
          </div>
          <div className="season-selector">
            <select
              className="season-dropdown"
              value={selectedSeason || ''}
              onChange={e => onSeasonChange(parseInt(e.target.value))}
            >
              {[...seasons].reverse().map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </header>
  );
}
