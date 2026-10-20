import { FileText, Film, Image, Music, Archive, Package, BookOpen, File } from 'lucide-react';

export const CATEGORIES = ['pdf', 'video', 'image', 'audio', 'archive', 'program', 'document', 'other'];

export const CATEGORY_META = {
  pdf: { icon: FileText, color: '#f43f5e' },
  video: { icon: Film, color: '#8b5cf6' },
  image: { icon: Image, color: '#10b981' },
  audio: { icon: Music, color: '#f59e0b' },
  archive: { icon: Archive, color: '#f97316' },
  program: { icon: Package, color: '#3b82f6' },
  document: { icon: BookOpen, color: '#06b6d4' },
  other: { icon: File, color: '#94a3b8' },
};

export function formatBytes(b) {
  if (b == null || isNaN(b)) return '—';
  if (b < 1024) return `${b} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do {
    b /= 1024;
    i++;
  } while (b >= 1024 && i < u.length - 1);
  return `${b.toFixed(b >= 100 ? 0 : b >= 10 ? 1 : 2)} ${u[i]}`;
}

export function formatSpeed(bps) {
  if (!bps) return '0 B/s';
  return formatBytes(Math.round(bps)) + '/s';
}

export function formatEta(sec) {
  if (sec == null || !isFinite(sec)) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatDuration(sec) {
  if (!sec) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function joinPath(...parts) {
  return parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, '')))
    .join('\\');
}

export function parseUrls(text) {
  return (text || '')
    .split(/[\s\n]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\/\S+$/i.test(s));
}

export function timeAgo(ts, lang) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
