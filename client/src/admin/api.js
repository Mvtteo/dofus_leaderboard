async function adminFetch(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.detail || `Erreur ${res.status}`);
  return data;
}

export const adminApi = {
  me: () => adminFetch('/admin/api/me'),
  login: (password) => adminFetch('/admin/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => adminFetch('/admin/logout', { method: 'POST' }),
  settings: () => adminFetch('/admin/api/settings'),
  savePools: (pools) => adminFetch('/admin/api/pools', { method: 'POST', body: JSON.stringify({ pools }) }),
  savePointsGrid: (grids) => adminFetch('/admin/api/points-grid', { method: 'POST', body: JSON.stringify(grids) }),
  saveSeasonEnd: (end_date) => adminFetch('/admin/api/season-end', { method: 'POST', body: JSON.stringify({ end_date }) }),
  saveDefaultWinratePool: (pool_id) => adminFetch('/admin/api/default-winrate-pool', { method: 'POST', body: JSON.stringify({ pool_id }) }),
  players: () => adminFetch('/admin/api/players'),
  playerStats: (pseudo) => adminFetch(`/admin/api/player-stats/${encodeURIComponent(pseudo)}`),
  setPlayerPoints: (pseudo, points) => adminFetch('/admin/api/player-points', { method: 'POST', body: JSON.stringify({ pseudo, points }) }),
  playerMatches: (pseudo) => adminFetch(`/admin/api/player-matches/${encodeURIComponent(pseudo)}`),
  multiAccounts: () => adminFetch('/admin/api/multi-accounts'),
  nuggets: (seasonId) => adminFetch(`/admin/api/nuggets/${seasonId}`),
  resetNuggets: () => adminFetch('/admin/api/reset-nuggets', { method: 'POST' }),
  recentMatches: () => adminFetch('/admin/api/recent-matches'),
  setMatchPoints: (id, points) => adminFetch(`/admin/api/match/${id}/points`, { method: 'PATCH', body: JSON.stringify({ points }) }),
  cancelMatch: (id) => adminFetch(`/admin/api/match/${id}`, { method: 'DELETE' }),
};
