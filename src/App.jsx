import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Plus, Play, Pause, Trash2, Search, Download, Gauge } from 'lucide-react';
import { I18nContext, translate } from './i18n';
import { formatSpeed, parseUrls } from './utils';
import Sidebar from './components/Sidebar';
import DownloadItem from './components/DownloadItem';
import AddDialog from './components/AddDialog';
import SettingsView from './components/SettingsView';
import Toasts from './components/Toasts';
import Logo from './components/Logo';

const api = window.api;
const ACTIVE = new Set(['downloading', 'probing', 'merging']);

export default function App() {
  const [settings, setSettings] = useState(null);
  const [items, setItems] = useState({});
  const [filter, setFilter] = useState({ type: 'status', value: 'all' });
  const [view, setView] = useState('downloads');
  const [query, setQuery] = useState('');
  const [addState, setAddState] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [dark, setDark] = useState(window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [dragOver, setDragOver] = useState(false);
  const addOpenRef = useRef(false);
  addOpenRef.current = !!addState;

  const lang = settings?.language || 'tr';
  const t = useCallback((k, v) => translate(lang, k, v), [lang]);

  const pushToast = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((ts) => [...ts.slice(-3), { id, ...toast }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), toast.duration || 6000);
  }, []);
  const dismissToast = (id) => setToasts((ts) => ts.filter((x) => x.id !== id));

  // İlk yükleme + olay dinleyicileri
  useEffect(() => {
    api.getSettings().then(setSettings);
    api.list().then((list) => setItems(Object.fromEntries(list.map((i) => [i.id, i]))));
    const offs = [
      api.on('dl:update', (s) => setItems((m) => ({ ...m, [s.id]: s }))),
      api.on('dl:removed', (id) =>
        setItems((m) => {
          const n = { ...m };
          delete n[id];
          return n;
        })
      ),
      api.on('external:add', (payload) => setAddState({ ...payload, key: Date.now() })),
      api.on('theme:changed', (d) => setDark(d)),
    ];
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onMq = (e) => setDark(e.matches);
    mq.addEventListener('change', onMq);
    return () => {
      offs.forEach((f) => f());
      mq.removeEventListener('change', onMq);
    };
  }, []);

  // Dil değişince bağımlı dinleyiciler
  useEffect(() => {
    const offClip = api.on('clipboard:url', ({ url }) => {
      if (addOpenRef.current) return;
      pushToast({
        kind: 'clipboard',
        title: t('clipboardFound'),
        text: url,
        action: { label: t('download'), run: () => setAddState({ url, key: Date.now() }) },
        duration: 9000,
      });
    });
    const offDone = api.on('dl:completed', (s) => {
      pushToast({
        kind: 'success',
        title: t('completedToast'),
        text: s.filename,
        action: { label: t('open'), run: () => api.openFile(s.id) },
      });
    });
    return () => {
      offClip();
      offDone();
    };
  }, [t, pushToast]);

  // Tema
  useEffect(() => {
    if (!settings) return;
    const theme = settings.theme === 'system' ? (dark ? 'dark' : 'light') : settings.theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang;
  }, [settings, dark, lang]);

  // Kısayollar: Ctrl+V ile bağlantı yapıştır, Ctrl+N yeni indirme
  useEffect(() => {
    const onPaste = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || addOpenRef.current) return;
      const text = e.clipboardData.getData('text');
      if (parseUrls(text).length) {
        e.preventDefault();
        setView('downloads');
        setAddState({ url: text.trim(), key: Date.now() });
      }
    };
    const onKey = (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setAddState({ url: '', key: Date.now() });
      }
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const all = useMemo(() => Object.values(items).sort((a, b) => b.createdAt - a.createdAt), [items]);

  const counts = useMemo(() => {
    const c = { all: all.length, active: 0, completed: 0, queued: 0, error: 0, cat: {} };
    for (const i of all) {
      if (ACTIVE.has(i.status)) c.active++;
      else if (i.status === 'completed') c.completed++;
      else if (i.status === 'queued' || i.status === 'paused') c.queued++;
      else if (i.status === 'error') c.error++;
      c.cat[i.category] = (c.cat[i.category] || 0) + 1;
    }
    return c;
  }, [all]);

  const totalSpeed = useMemo(() => all.reduce((s, i) => s + (ACTIVE.has(i.status) ? i.speed || 0 : 0), 0), [all]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((i) => {
      if (filter.type === 'category' && i.category !== filter.value) return false;
      if (filter.type === 'status') {
        const v = filter.value;
        if (v === 'active' && !ACTIVE.has(i.status)) return false;
        if (v === 'completed' && i.status !== 'completed') return false;
        if (v === 'queued' && !(i.status === 'queued' || i.status === 'paused')) return false;
        if (v === 'error' && i.status !== 'error') return false;
      }
      if (q && !(`${i.filename} ${i.url}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [all, filter, query]);

  const updateSettings = async (patch) => {
    const next = await api.setSettings(patch);
    setSettings(next);
    return next;
  };

  // Sürükle-bırak ile bağlantı ekleme
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (parseUrls(text).length) setAddState({ url: text.trim(), key: Date.now() });
  };

  if (!settings) return <div className="boot" />;

  return (
    <I18nContext.Provider value={{ lang }}>
      <div
        className={`app ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
        onDrop={onDrop}
      >
        <header className="titlebar">
          <div className="brand">
            <Logo size={22} />
            <span>Flux</span>
            <small>Download Manager</small>
          </div>
          {view === 'downloads' && (
            <div className="search no-drag">
              <Search size={15} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('search')} />
            </div>
          )}
          <div className="titlebar-spacer" />
        </header>

        <div className="body">
          <Sidebar
            filter={filter}
            setFilter={(f) => {
              setFilter(f);
              setView('downloads');
            }}
            counts={counts}
            view={view}
            setView={setView}
            totalSpeed={totalSpeed}
          />

          <main className="main">
            {view === 'settings' ? (
              <SettingsView settings={settings} update={updateSettings} pushToast={pushToast} />
            ) : (
              <>
                <div className="toolbar">
                  <button className="btn primary" onClick={() => setAddState({ url: '', key: Date.now() })}>
                    <Plus size={17} /> {t('newDownload')}
                  </button>
                  <div className="toolbar-group">
                    <button className="btn ghost" onClick={() => api.resumeAll()} title={t('resumeAll')}>
                      <Play size={16} /> <span className="hide-sm">{t('resumeAll')}</span>
                    </button>
                    <button className="btn ghost" onClick={() => api.pauseAll()} title={t('pauseAll')}>
                      <Pause size={16} /> <span className="hide-sm">{t('pauseAll')}</span>
                    </button>
                    <button className="btn ghost" onClick={() => api.clearCompleted()} title={t('clearCompleted')}>
                      <Trash2 size={16} /> <span className="hide-sm">{t('clearCompleted')}</span>
                    </button>
                  </div>
                  <div className="flex-1" />
                  <div className={`speed-pill ${totalSpeed > 0 ? 'on' : ''}`}>
                    <Gauge size={15} />
                    {formatSpeed(totalSpeed)}
                  </div>
                </div>

                <div className="list">
                  {visible.length === 0 ? (
                    <div className="empty">
                      <div className="empty-icon">
                        <Download size={34} />
                      </div>
                      <h3>{all.length ? t('emptyFilter') : t('emptyTitle')}</h3>
                      {!all.length && <p>{t('emptyText')}</p>}
                      {!all.length && (
                        <button className="btn primary" onClick={() => setAddState({ url: '', key: Date.now() })}>
                          <Plus size={17} /> {t('newDownload')}
                        </button>
                      )}
                    </div>
                  ) : (
                    visible.map((i) => <DownloadItem key={i.id} item={i} />)
                  )}
                </div>
              </>
            )}
          </main>
        </div>

        {addState && (
          <AddDialog
            key={addState.key}
            initial={addState}
            settings={settings}
            onClose={() => setAddState(null)}
            onAdded={(n) => pushToast({ kind: 'info', title: t('addedToast'), text: n > 1 ? `${n} ×` : '', duration: 2500 })}
          />
        )}
        <Toasts toasts={toasts} dismiss={dismissToast} />
        {dragOver && (
          <div className="drop-overlay">
            <Download size={40} />
          </div>
        )}
      </div>
    </I18nContext.Provider>
  );
}
