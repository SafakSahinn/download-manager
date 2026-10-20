// Güvenli köprü: renderer'a sınırlı bir API açar
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('api', {
  appInfo: invoke('app:info'),
  getSettings: invoke('settings:get'),
  setSettings: invoke('settings:set'),

  list: invoke('dl:list'),
  probe: invoke('dl:probe'),
  categoryFor: invoke('dl:categoryFor'),
  add: invoke('dl:add'),
  pause: invoke('dl:pause'),
  resume: invoke('dl:resume'),
  remove: invoke('dl:remove'),
  pauseAll: invoke('dl:pauseAll'),
  resumeAll: invoke('dl:resumeAll'),
  clearCompleted: invoke('dl:clearCompleted'),

  openFile: invoke('shell:openFile'),
  showInFolder: invoke('shell:showInFolder'),
  openCategory: invoke('shell:openCategory'),
  openExternal: invoke('shell:openExternal'),
  openPath: invoke('shell:openPath'),
  readClipboard: invoke('clipboard:read'),
  pickDir: invoke('dialog:pickDir'),
  updateYtdlp: invoke('ytdlp:update'),

  on(channel, cb) {
    const allowed = ['dl:update', 'dl:removed', 'dl:completed', 'clipboard:url', 'external:add', 'ytdlp:install', 'theme:changed'];
    if (!allowed.includes(channel)) return () => {};
    const fn = (_, payload) => cb(payload);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
});
