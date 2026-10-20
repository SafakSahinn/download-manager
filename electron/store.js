// Basit JSON kalıcı depolama (atomik yazma ile)
const fs = require('fs');
const path = require('path');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonSync(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// Ana süreci bloklamayan sürüm: sık yapılan kayıtlar için (girintisiz, daha küçük ve hızlı)
async function writeJsonAsync(file, data) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  // Senkron yazmayla aynı geçici dosyayı paylaşmasın (kapanışta ikisi çakışabilir)
  const tmp = file + '.async.tmp';
  await fs.promises.writeFile(tmp, JSON.stringify(data), 'utf8');
  await fs.promises.rename(tmp, file);
}

class SettingsStore {
  constructor(file, defaults) {
    this.file = file;
    const saved = readJson(file, {});
    this.data = {
      ...defaults,
      ...saved,
      categoryFolders: { ...defaults.categoryFolders, ...(saved.categoryFolders || {}) },
    };
  }
  get() {
    return this.data;
  }
  set(patch) {
    this.data = { ...this.data, ...patch };
    if (patch.categoryFolders) this.data.categoryFolders = { ...this.data.categoryFolders, ...patch.categoryFolders };
    writeJsonSync(this.file, this.data);
    return this.data;
  }
}

module.exports = { SettingsStore, readJson, writeJsonSync, writeJsonAsync };
