import { useEffect, useState } from 'react';
import { FolderOpen, Globe, Palette, Gauge, Layers, Puzzle, Film, Check, AlertCircle, Loader2, RefreshCw, Download } from 'lucide-react';
import { useT } from '../i18n';
import { CATEGORIES, CATEGORY_META } from '../utils';

const api = window.api;

function Toggle({ checked, onChange }) {
  return (
    <button className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} role="switch" aria-checked={checked}>
      <span />
    </button>
  );
}

function Row({ title, desc, children }) {
  return (
    <div className="set-row">
      <div className="set-text">
        <div className="set-title">{title}</div>
        {desc && <div className="set-desc">{desc}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function Seg({ value, options, onChange }) {
  return (
    <div className="segmented-ctl compact">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

const SPEED_PRESETS = [0, 256, 512, 1024, 2048, 5120, 10240];

export default function SettingsView({ settings: s, update, pushToast }) {
  const t = useT();
  const [info, setInfo] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [folders, setFolders] = useState(s.categoryFolders);

  useEffect(() => {
    api.appInfo().then(setInfo);
  }, []);
  useEffect(() => setFolders(s.categoryFolders), [s.categoryFolders]);

  const speedLabel = (k) => (k === 0 ? t('unlimited') : k >= 1024 ? `${k / 1024} MB/s` : `${k} KB/s`);

  const doUpdate = async () => {
    setUpdating(true);
    try {
      const v = await api.updateYtdlp();
      setInfo((i) => ({ ...i, ytdlpVersion: v }));
    } catch (e) {
      pushToast?.({ kind: 'info', title: 'yt-dlp', text: String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="settings">
      <h1>{t('settings')}</h1>

      <section className="card">
        <h2>
          <Palette size={17} /> {t('general')}
        </h2>
        <Row title={t('language')}>
          <Seg value={s.language} options={[['tr', 'Türkçe'], ['en', 'English']]} onChange={(v) => update({ language: v })} />
        </Row>
        <Row title={t('theme')}>
          <Seg
            value={s.theme}
            options={[['system', t('themeSystem')], ['dark', t('themeDark')], ['light', t('themeLight')]]}
            onChange={(v) => update({ theme: v })}
          />
        </Row>
        <Row title={t('clipboardWatch')} desc={t('clipboardWatchDesc')}>
          <Toggle checked={s.clipboardWatch} onChange={(v) => update({ clipboardWatch: v })} />
        </Row>
        <Row title={t('notifications')} desc={t('notificationsDesc')}>
          <Toggle checked={s.notifications} onChange={(v) => update({ notifications: v })} />
        </Row>
        <Row title={t('minimizeToTray')} desc={t('minimizeToTrayDesc')}>
          <Toggle checked={s.minimizeToTray} onChange={(v) => update({ minimizeToTray: v })} />
        </Row>
        <Row title={t('startWithWindows')} desc={t('startWithWindowsDesc')}>
          <Toggle checked={s.startWithWindows} onChange={(v) => update({ startWithWindows: v })} />
        </Row>
      </section>

      <section className="card">
        <h2>
          <Gauge size={17} /> {t('downloadSection')}
        </h2>
        <Row title={t('baseDir')} desc={t('baseDirDesc')}>
          <div className="dir-row">
            <div className="dir-path" title={s.baseDir}>
              {s.baseDir}
            </div>
            <button
              className="btn soft small"
              onClick={async () => {
                const d = await api.pickDir(s.baseDir);
                if (d) update({ baseDir: d });
              }}
            >
              {t('change')}
            </button>
            <button className="icon-btn" onClick={() => api.openCategory(null)} title={t('openFolder')}>
              <FolderOpen size={16} />
            </button>
          </div>
        </Row>
        <Row title={t('maxConcurrent')} desc={t('maxConcurrentDesc')}>
          <div className="range">
            <input type="range" min="1" max="10" value={s.maxConcurrent} onChange={(e) => update({ maxConcurrent: +e.target.value })} />
            <b>{s.maxConcurrent}</b>
          </div>
        </Row>
        <Row title={t('connectionsPer')} desc={t('connectionsPerDesc')}>
          <div className="range">
            <input type="range" min="1" max="32" value={s.connections} onChange={(e) => update({ connections: +e.target.value })} />
            <b>{s.connections}</b>
          </div>
        </Row>
        <Row title={t('speedLimit')} desc={t('speedLimitDesc')}>
          <div className="speed-presets">
            {SPEED_PRESETS.map((k) => (
              <button key={k} className={`chip-btn ${s.speedLimitKBps === k ? 'on' : ''}`} onClick={() => update({ speedLimitKBps: k })}>
                {speedLabel(k)}
              </button>
            ))}
          </div>
        </Row>
      </section>

      <section className="card">
        <h2>
          <Layers size={17} /> {t('categoryFolders')}
        </h2>
        <p className="set-desc pad">{t('categoryFoldersDesc')}</p>
        <div className="folder-grid">
          {CATEGORIES.map((c) => {
            const M = CATEGORY_META[c];
            return (
              <div className="folder-cell" key={c}>
                <span className="cat-dot lg" style={{ '--c': M.color }}>
                  <M.icon size={15} />
                </span>
                <div className="folder-fields">
                  <small>{t('cat_' + c)}</small>
                  <input
                    value={folders[c] || ''}
                    onChange={(e) => setFolders((f) => ({ ...f, [c]: e.target.value }))}
                    onBlur={() => folders[c]?.trim() && folders[c] !== s.categoryFolders[c] && update({ categoryFolders: { [c]: folders[c].trim() } })}
                  />
                </div>
                <button className="icon-btn" onClick={() => api.openCategory(c)} title={t('openFolder')}>
                  <FolderOpen size={15} />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h2>
          <Puzzle size={17} /> {t('browserExt')}
        </h2>
        <p className="set-desc pad">{t('browserExtDesc')}</p>
        <ol className="steps">
          <li>{t('extStep1')}</li>
          <li>{t('extStep2')}</li>
          <li>{t('extStep3')}</li>
        </ol>
        {info && (
          <div className="dir-row pad">
            <div className="dir-path mono" title={info.extensionDir}>
              {info.extensionDir}
            </div>
            <button className="btn soft small" onClick={() => api.openPath(info.extensionDir)}>
              <FolderOpen size={14} /> {t('openExtFolder')}
            </button>
          </div>
        )}
        {info && <div className="set-desc pad">127.0.0.1:{info.bridgePort}</div>}
      </section>

      <section className="card">
        <h2>
          <Film size={17} /> {t('mediaEngine')}
        </h2>
        <p className="set-desc pad">{t('mediaEngineDesc')}</p>
        <Row title="yt-dlp" desc={info ? info.ytdlpVersion || t('notInstalled') : '…'}>
          <button className="btn soft small" onClick={doUpdate} disabled={updating}>
            {updating ? <Loader2 size={14} className="spin" /> : info?.ytdlpVersion ? <RefreshCw size={14} /> : <Download size={14} />}
            {updating ? t('updating') : t('update')}
          </button>
        </Row>
        <Row title="FFmpeg" desc={info ? (info.ffmpeg ? t('ffmpegOk') : t('ffmpegMissing')) : '…'}>
          {info && (info.ffmpeg ? <Check size={18} className="ok-icon" /> : <AlertCircle size={18} className="warn-icon" />)}
        </Row>
      </section>

      <div className="about">
        <Globe size={13} /> Flux Download Manager {info?.version}
      </div>
    </div>
  );
}
