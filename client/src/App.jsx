import { useState, useEffect, useCallback } from 'react';
import Background from './components/Background';
import Header from './components/Header';
import Leaderboard from './components/Leaderboard';
import Feed from './components/Feed';
import Stats from './components/Stats';
import Footer from './components/Footer';

const UPDATE_INTERVAL = 15000;

export default function App() {
  const [seasons, setSeasons] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [players, setPlayers] = useState([]);
  const [pools, setPools] = useState([]);
  const [defaultWinratePool, setDefaultWinratePool] = useState(null);
  const [totalCombats, setTotalCombats] = useState(0);
  const [activeTab, setActiveTab] = useState('classement');
  const [search, setSearch] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/seasons').then(r => r.json()),
      fetch('/api/config').then(r => r.json()),
    ]).then(([seasonsData, configData]) => {
      setSeasons(seasonsData.seasons);
      setSelectedSeason(seasonsData.currentSeason);
      setPools(configData.pools);
      setDefaultWinratePool(configData.defaultWinratePool);
    }).catch(console.error);
  }, []);

  const fetchLeaderboard = useCallback(() => {
    if (!selectedSeason) return;
    Promise.all([
      fetch(`/api/leaderboard/${selectedSeason}`).then(r => r.json()),
      fetch(`/api/season-info/${selectedSeason}`).then(r => r.json()),
    ]).then(([playersData, infoData]) => {
      setPlayers(playersData);
      setTotalCombats(infoData.totalCombats || 0);
    }).catch(console.error);
  }, [selectedSeason]);

  useEffect(() => {
    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, UPDATE_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchLeaderboard]);

  const filteredPlayers = search
    ? players.filter(p => p.dofus_pseudo.toLowerCase().includes(search.toLowerCase()))
    : players;

  const tabs = [
    { id: 'classement', label: 'Classement' },
    { id: 'activite', label: 'Activité' },
    { id: 'stats', label: 'Stats' },
  ];

  return (
    <>
      <Background />
      <Header
        playerCount={players.length}
        totalCombats={totalCombats}
        seasons={seasons}
        selectedSeason={selectedSeason}
        onSeasonChange={id => { setSelectedSeason(id); setSearch(''); }}
        search={search}
        onSearch={setSearch}
      />
      <main className="main-content">
        <div className="tabs-bar">
          {tabs.map(t => (
            <button
              key={t.id}
              className={`tab-btn${activeTab === t.id ? ' on' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className={`panel${activeTab === 'classement' ? ' on' : ''}`}>
          <Leaderboard
            filteredPlayers={filteredPlayers}
            allPlayers={players}
            pools={pools}
            defaultWinratePool={defaultWinratePool}
          />
        </div>

        <div className={`panel${activeTab === 'activite' ? ' on' : ''}`}>
          {activeTab === 'activite' && <Feed selectedSeason={selectedSeason} />}
        </div>

        <div className={`panel${activeTab === 'stats' ? ' on' : ''}`}>
          {activeTab === 'stats' && <Stats selectedSeason={selectedSeason} />}
        </div>
      </main>
      <Footer />
    </>
  );
}
