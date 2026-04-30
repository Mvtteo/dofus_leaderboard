export const C = 62.83;
export const LEVEL_COLORS = ['', '#5ec4b6', '#2a9d8f', '#e9c46a', '#e9c46a'];
export const LEVEL_GRADIENTS = ['', 'rgba(42,157,143,0.1)', 'rgba(42,157,143,0.2)', 'rgba(233,196,106,0.15)', 'rgba(233,196,106,0.25)'];
export const LEVEL_OPACITY = ['', '0.3', '0.5', '0.6', '0.8'];

export function perco(pts, rk) {
  if (rk <= 10) return 4;
  if (pts >= 175) return 3;
  if (pts >= 125) return 2;
  if (pts >= 75) return 1;
  return 0;
}

export function wrColor(w) {
  return w >= 60 ? '#2a9d8f' : w >= 45 ? '#e9c46a' : '#e76f51';
}

export function wrClass(w) {
  return w >= 60 ? 'high' : w >= 45 ? 'mid' : 'low';
}

export function ago(d) {
  if (!d) return '';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "à l'instant";
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'j';
}
