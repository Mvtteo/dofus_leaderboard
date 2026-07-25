export function wrColor(w) {
  return w >= 60 ? 'var(--accent)' : w >= 45 ? 'var(--mid)' : 'var(--accent2)';
}

export function wrClass(w) {
  return w >= 60 ? 'high' : w >= 45 ? 'mid' : 'low';
}

export function ago(d) {
  if (!d) return '';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "à l'instant";
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + ' h';
  return Math.floor(s / 86400) + ' j';
}
