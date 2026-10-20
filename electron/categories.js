// Dosya uzantısı / MIME tipine göre kategori belirleme
const path = require('path');

const CATEGORY_EXT = {
  pdf: ['pdf'],
  video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp', 'm2ts', 'mts', 'vob', 'ogv', 'm3u8', 'ts', 'mpd'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'tif', 'tiff', 'ico', 'heic', 'heif', 'avif', 'raw', 'psd', 'cr2', 'nef'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'oga', 'm4a', 'wma', 'opus', 'aiff', 'alac', 'mid', 'midi'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'iso', 'cab', 'zst', 'lz', 'lzma', 'img'],
  program: ['exe', 'msi', 'msix', 'msixbundle', 'appx', 'apk', 'xapk', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'jar', 'bat', 'cmd', 'ps1', 'sh'],
  document: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'txt', 'rtf', 'csv', 'epub', 'mobi', 'md', 'json', 'xml', 'pages', 'numbers', 'key'],
};

const EXT_TO_CAT = {};
for (const [cat, exts] of Object.entries(CATEGORY_EXT)) for (const e of exts) EXT_TO_CAT[e] = cat;

const MIME_TO_EXT = {
  'application/pdf': 'pdf',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/x-matroska': 'mkv', 'video/quicktime': 'mov', 'video/x-msvideo': 'avi',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/ogg': 'ogg', 'audio/aac': 'aac', 'audio/mp4': 'm4a',
  'application/zip': 'zip', 'application/x-zip-compressed': 'zip', 'application/x-rar-compressed': 'rar', 'application/vnd.rar': 'rar',
  'application/x-7z-compressed': '7z', 'application/gzip': 'gz', 'application/x-tar': 'tar',
  'application/x-msdownload': 'exe', 'application/x-msi': 'msi', 'application/vnd.android.package-archive': 'apk',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt', 'text/csv': 'csv', 'application/json': 'json', 'application/epub+zip': 'epub', 'text/html': 'html',
};

function extOf(filename) {
  return path.extname(filename || '').slice(1).toLowerCase();
}

function categorize(filename, mime) {
  const ext = extOf(filename);
  if (EXT_TO_CAT[ext]) return EXT_TO_CAT[ext];
  const m = (mime || '').split(';')[0].trim().toLowerCase();
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  const mext = MIME_TO_EXT[m];
  if (mext && EXT_TO_CAT[mext]) return EXT_TO_CAT[mext];
  return 'other';
}

function extForMime(mime) {
  const m = (mime || '').split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[m] || '';
}

// URL'nin uzantısı indirilebilir bir dosyaya mı işaret ediyor? (m3u8/mpd akışları hariç)
function looksDownloadable(url) {
  try {
    const u = new URL(url);
    const ext = extOf(decodeURIComponent(u.pathname));
    if (ext === 'm3u8' || ext === 'mpd') return false;
    return !!EXT_TO_CAT[ext];
  } catch {
    return false;
  }
}

const MEDIA_HOSTS = [
  'youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com', 'twitch.tv', 'twitter.com', 'x.com',
  'instagram.com', 'tiktok.com', 'facebook.com', 'fb.watch', 'reddit.com', 'soundcloud.com',
  'bilibili.com', 'streamable.com', 'rumble.com', 'kick.com', 'pinterest.com', 'bandcamp.com', 'mixcloud.com',
];

function isStreamUrl(url) {
  try {
    const u = new URL(url);
    return /\.(?:m3u8|mpd)(?:[?#]|$)/i.test(u.pathname);
  } catch {
    return false;
  }
}

function isMediaSite(url) {
  if (isStreamUrl(url)) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return MEDIA_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}

module.exports = { categorize, extForMime, extOf, looksDownloadable, isMediaSite, isStreamUrl, CATEGORY_EXT };
