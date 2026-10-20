import { useEffect, useMemo, useRef, useState } from 'react';
import { X, ClipboardPaste, Loader2, Folder, AlertCircle, Check, Music, Film, Sparkles, RotateCcw } from 'lucide-react';
import { useT } from '../i18n';
import { CATEGORIES, CATEGORY_META, formatBytes, formatDuration, joinPath, parseUrls } from '../utils';

const api = window.api;

export default function AddDialog({ initial, settings, onClose, onAdded }) {
  const t = useT();
  const [text, setText] = useState(initial.url || '');
  const [mode, setMode] = useState(initial.mode === 'media' ? 'media' : 'auto');
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [filename, setFilename] = useState('');
  const [autoCat, setAutoCat] = useState('other');
  const [catOverride, setCatOverride] = useState(null);
  const [customDir, setCustomDir] = useState(null);
  const [choice, setChoice] = useState('best');
  const [install, setInstall] = useState(null);
  const [busy, setBusy] = useState(false);
  const reqId = useRef(0);
  const inputRef = useRef(null);
  const headers = initial.headers || {};

  const urls = useMemo(() => parseUrls(text), [text]);
  const single = urls.length === 1 ? urls[0] : null;

  const dirFor = (cat) => joinPath(settings.baseDir, settings.categoryFolders[cat] || settings.categoryFolders.other);

  // Panoda bağlantı varsa otomatik doldur
  useEffect(() => {
    if (!initial.url) {
      api.readClipboard().then((c) => {
        if (parseUrls(c).length === 1) setText(c.trim());
      });
    }
    inputRef.current?.focus();
    return api.on('ytdlp:install', setInstall);
  }, []);

  // Esc ile kapat
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // Tek bağlantıda bilgi al
  useEffect(() => {
    setInfo(null);
    setError(null);
    setCatOverride(null);
    setCustomDir(null);
    if (!single) return;
    const id = ++reqId.current;
    const delay = initial.url && single === initial.url ? 0 : 250;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.probe({ url: single, headers, mode });
        if (id !== reqId.current) return;
        setInfo(r);
        if (r.kind === 'file') {
          setFilename(initial.filename && single === initial.url ? initial.filename : r.filename);
          setAutoCat(r.category);
        } else {
          setChoice(initial.choice && single === initial.url ? initial.choice : 'best');
        }
      } catch (e) {
        if (id !== reqId.current) return;
        setError(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [single, mode]);

  // Dosya adı değişince kategoriyi yeniden belirle
  useEffect(() => {
    if (!info || info.kind !== 'file' || !filename) return;
    const h = setTimeout(() => api.categoryFor({ filename, mime: info.mime }).then((r) => setAutoCat(r.category)), 250);
    return () => clearTimeout(h);
  }, [filename, info]);

  const category = info?.kind === 'media' ? (choice === 'audio' ? 'audio' : 'video') : catOverride || autoCat;
  const targetDir = customDir || dirFor(category);

  const submit = async (startPaused = false) => {
    if (busy) return;
    setBusy(true);
    try {
      if (urls.length > 1) {
        for (const u of urls) await api.add({ url: u, kind: mode === 'media' ? 'media' : mode === 'file' ? 'http' : 'auto', headers, startPaused });
        onAdded(urls.length);
      } else if (info?.kind === 'file') {
        await api.add({
          url: single,
          kind: 'http',
          filename,
          headers,
          probed: true,
          finalUrl: info.finalUrl,
          size: info.size,
          resumable: info.resumable,
          mime: info.mime,
          category: catOverride,
          customDir,
          startPaused,
        });
        onAdded(1);
      } else if (info?.kind === 'media') {
        await api.add({
          url: info.webpageUrl || single,
          kind: 'media',
          title: info.title,
          thumbnail: info.thumbnail,
          mediaChoice: choice,
          headers,
          customDir,
          startPaused,
        });
        onAdded(1);
      } else if (single) {
        // Bilgi alınamadıysa "auto" bırak: yönetici medya sitelerini yt-dlp'ye yönlendirir
        const kind = mode === 'media' ? 'media' : mode === 'file' ? 'http' : 'auto';
        await api.add({ url: single, kind, filename: initial.filename, headers, startPaused });
        onAdded(1);
      }
      onClose();
    } catch (e) {
      setError(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !busy && (urls.length > 1 || (single && !loading && (info || error)));

  const pasteFromClipboard = async () => {
    const c = await api.readClipboard();
    if (c) setText(c.trim());
  };

  const pickDir = async () => {
    const d = await api.pickDir(targetDir);
    if (d) setCustomDir(d);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>{t('addTitle')}</h2>
          <button className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="url-box">
          <textarea
            ref={inputRef}
            value={text}
            rows={urls.length > 1 ? 4 : 2}
            spellCheck={false}
            placeholder={t('urlPlaceholder')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && urls.length <= 1) {
                e.preventDefault();
                if (canSubmit) submit(false);
              }
            }}
          />
          <button className="btn soft small paste" onClick={pasteFromClipboard}>
            <ClipboardPaste size={15} /> {t('paste')}
          </button>
        </div>

        <div className="segmented-ctl">
          {[
            ['auto', t('modeAuto'), Sparkles],
            ['file', t('modeFile'), Folder],
            ['media', t('modeMedia'), Film],
          ].map(([v, label, Icon]) => (
            <button key={v} className={mode === v ? 'on' : ''} onClick={() => setMode(v)}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        <div className="modal-content">
          {urls.length > 1 && <div className="note">{t('linksDetected', { n: urls.length })}</div>}

          {single && loading && (
            <div className="loading-box">
              <Loader2 className="spin" size={22} />
              <div>
                <div>{t('fetchingInfo')}</div>
                {install && !install.done && (
                  <small>{t('installingEngine', { p: install.total ? Math.round((install.got / install.total) * 100) + '%' : formatBytes(install.got) })}</small>
                )}
              </div>
            </div>
          )}

          {single && !loading && error && (
            <div className="error-box">
              <AlertCircle size={18} />
              <div>
                <strong>{t('probeError')}</strong>
                <div className="small">{error}</div>
              </div>
            </div>
          )}

          {single && !loading && info?.kind === 'file' && (
            <div className="file-info">
              {/text\/html/i.test(info.mime) && <div className="note warn">{t('webPage')}</div>}
              <label className="field">
                <span>{t('fileName')}</span>
                <input value={filename} onChange={(e) => setFilename(e.target.value)} spellCheck={false} />
              </label>
              <div className="info-row">
                <div className="info-cell">
                  <span>{t('size')}</span>
                  <strong>{info.size ? formatBytes(info.size) : t('unknownSize')}</strong>
                </div>
                <div className="info-cell">
                  <span>&nbsp;</span>
                  <span className={`chip ${info.resumable ? 'ok' : 'warn'}`}>
                    {info.resumable ? <Check size={12} /> : <AlertCircle size={12} />}
                    {info.resumable ? t('resumable') : t('notResumable')}
                  </span>
                </div>
              </div>
              <div className="field">
                <span>{t('category')}</span>
                <div className="cat-picker">
                  {CATEGORIES.map((c) => {
                    const M = CATEGORY_META[c];
                    return (
                      <button
                        key={c}
                        className={`cat-chip ${category === c ? 'on' : ''}`}
                        style={{ '--c': M.color }}
                        onClick={() => setCatOverride(c === autoCat ? null : c)}
                      >
                        <M.icon size={13} /> {t('cat_' + c)}
                        {c === autoCat && <Sparkles size={11} className="auto-mark" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {single && !loading && info?.kind === 'media' && (
            <div className="media-info">
              <div className="media-head">
                {info.thumbnail ? <img src={info.thumbnail} alt="" /> : <div className="thumb-ph"><Film size={28} /></div>}
                <div className="media-meta">
                  <div className="media-title">{info.title}</div>
                  <div className="small muted">
                    {[info.uploader, info.extractor, formatDuration(info.duration)].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
              <div className="field">
                <span>{t('quality')}</span>
                <div className="quality-grid">
                  <button className={`q-btn ${choice === 'best' ? 'on' : ''}`} onClick={() => setChoice('best')}>
                    <Sparkles size={14} /> {t('best')}
                  </button>
                  {info.options.map((o) => (
                    <button key={o.id} className={`q-btn ${choice === o.id ? 'on' : ''}`} onClick={() => setChoice(o.id)}>
                      <Film size={14} /> {o.label}
                      {o.size ? <small>~{formatBytes(o.size)}</small> : null}
                    </button>
                  ))}
                  <button className={`q-btn ${choice === 'audio' ? 'on' : ''}`} onClick={() => setChoice('audio')}>
                    <Music size={14} /> {t('audioOnly')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {single && !loading && (info || error) && (
            <div className="field">
              <span>{t('saveTo')}</span>
              <div className="dir-row">
                <div className="dir-path" title={targetDir}>
                  <span className="cat-dot" style={{ '--c': CATEGORY_META[category].color }}>
                    {(() => {
                      const I = CATEGORY_META[category].icon;
                      return <I size={12} />;
                    })()}
                  </span>
                  {targetDir}
                </div>
                {customDir && (
                  <button className="btn soft small" onClick={() => setCustomDir(null)} title={t('reset')}>
                    <RotateCcw size={14} />
                  </button>
                )}
                <button className="btn soft small" onClick={pickDir}>
                  {t('change')}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>
            {t('cancel')}
          </button>
          <div className="flex-1" />
          <button className="btn soft" disabled={!canSubmit} onClick={() => submit(true)}>
            {t('later')}
          </button>
          <button className="btn primary" disabled={!canSubmit} onClick={() => submit(false)}>
            {busy ? <Loader2 className="spin" size={16} /> : null}
            {urls.length > 1 ? t('addAll') : error ? t('addAnyway') : t('download')}
          </button>
        </div>
      </div>
    </div>
  );
}
