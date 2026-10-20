import { useEffect, useRef, useState, memo } from 'react';
import { Pause, Play, RotateCw, FolderOpen, MoreHorizontal, Trash2, X, Link2, ExternalLink, Zap } from 'lucide-react';
import { useT } from '../i18n';
import { CATEGORY_META, formatBytes, formatSpeed, formatEta, timeAgo } from '../utils';

const api = window.api;

function ProgressBar({ item }) {
  const pct = item.size ? Math.min(100, (item.downloaded / item.size) * 100) : null;
  const indeterminate = item.status === 'probing' || item.status === 'merging' || (item.status === 'downloading' && pct == null);
  if (item.segments && item.status !== 'completed') {
    return (
      <div className={`progress segmented ${item.status}`}>
        {item.segments.map((s, i) => (
          <div key={i} className="seg" style={{ left: `${s.s * 100}%`, width: `${Math.max(0, s.p - s.s) * 100}%` }} />
        ))}
        {item.segments.map((s, i) =>
          i > 0 ? <div key={'d' + i} className="seg-div" style={{ left: `${s.s * 100}%` }} /> : null
        )}
      </div>
    );
  }
  return (
    <div className={`progress ${item.status} ${indeterminate ? 'indeterminate' : ''}`}>
      <div className="bar" style={{ width: indeterminate ? undefined : `${item.status === 'completed' ? 100 : pct || 0}%` }} />
    </div>
  );
}

function Menu({ item, onClose }) {
  const t = useT();
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && onClose();
    setTimeout(() => window.addEventListener('mousedown', h), 0);
    return () => window.removeEventListener('mousedown', h);
  }, [onClose]);
  const act = (fn) => () => {
    fn();
    onClose();
  };
  return (
    <div className="menu" ref={ref}>
      <button onClick={act(() => navigator.clipboard.writeText(item.url))}>
        <Link2 size={15} /> {t('copyLink')}
      </button>
      <button onClick={act(() => api.openExternal(item.url))}>
        <ExternalLink size={15} /> URL
      </button>
      <div className="menu-sep" />
      <button onClick={act(() => api.remove(item.id, false))}>
        <X size={15} /> {t('remove')}
      </button>
      {item.status === 'completed' && (
        <button className="danger" onClick={act(() => api.remove(item.id, true))}>
          <Trash2 size={15} /> {t('removeAndDelete')}
        </button>
      )}
    </div>
  );
}

function DownloadItem({ item }) {
  const t = useT();
  const [menu, setMenu] = useState(false);
  const M = CATEGORY_META[item.category] || CATEGORY_META.other;
  const pct = item.size ? Math.min(100, Math.floor((item.downloaded / item.size) * 100)) : null;
  const active = ['downloading', 'probing', 'merging'].includes(item.status);
  const done = item.status === 'completed';

  let meta;
  if (done) {
    meta = (
      <>
        <span>{formatBytes(item.size)}</span>
        <span className="dot">•</span>
        <span>{timeAgo(item.completedAt, document.documentElement.lang)}</span>
      </>
    );
  } else if (item.status === 'downloading') {
    meta = (
      <>
        <span className="strong">{pct != null ? `${pct}%` : formatBytes(item.downloaded)}</span>
        <span className="dot">•</span>
        <span>
          {formatBytes(item.downloaded)} / {item.size ? formatBytes(item.size) : t('unknownSize')}
        </span>
        <span className="dot">•</span>
        <span className="speed">{formatSpeed(item.speed)}</span>
        {item.eta != null && (
          <>
            <span className="dot">•</span>
            <span>
              {formatEta(item.eta)} {t('left')}
            </span>
          </>
        )}
        {item.connections > 1 && (
          <span className="chip">
            <Zap size={11} /> {t('connections', { n: item.connections })}
          </span>
        )}
      </>
    );
  } else if (item.status === 'error') {
    meta = <span className="err" title={item.error}>{item.error || t('error')}</span>;
  } else {
    meta = (
      <>
        <span className={`status-text ${item.status}`}>{t(item.status)}</span>
        {item.size ? (
          <>
            <span className="dot">•</span>
            <span>
              {formatBytes(item.downloaded)} / {formatBytes(item.size)}
            </span>
          </>
        ) : null}
        {item.status === 'paused' && item.kind === 'http' && !item.resumable && item.downloaded > 0 && (
          <span className="chip warn">{t('notResumable')}</span>
        )}
      </>
    );
  }

  return (
    <div className={`dl-item ${item.status}`} onDoubleClick={() => done && api.openFile(item.id)}>
      <div className="dl-icon" style={{ '--c': M.color }}>
        {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <M.icon size={22} />}
        {item.thumbnail && (
          <span className="dl-icon-badge">
            <M.icon size={11} />
          </span>
        )}
      </div>
      <div className="dl-body">
        <div className="dl-name" title={item.filename}>
          {item.filename}
        </div>
        <div className="dl-meta">{meta}</div>
        {!done && <ProgressBar item={item} />}
      </div>
      <div className="dl-actions">
        {active && (
          <button className="icon-btn" title={t('pause')} onClick={() => api.pause(item.id)}>
            <Pause size={17} />
          </button>
        )}
        {(item.status === 'paused' || item.status === 'queued') && (
          <button className="icon-btn accent" title={t('resume')} onClick={() => api.resume(item.id)} disabled={item.status === 'queued'}>
            <Play size={17} />
          </button>
        )}
        {item.status === 'error' && (
          <button className="icon-btn accent" title={t('retry')} onClick={() => api.resume(item.id)}>
            <RotateCw size={17} />
          </button>
        )}
        {done && (
          <button className="btn small soft" onClick={() => api.openFile(item.id)}>
            {t('open')}
          </button>
        )}
        <button className="icon-btn" title={t('showInFolder')} onClick={() => api.showInFolder(item.id)}>
          <FolderOpen size={17} />
        </button>
        <div className="menu-wrap">
          <button className="icon-btn" onClick={() => setMenu((m) => !m)}>
            <MoreHorizontal size={17} />
          </button>
          {menu && <Menu item={item} onClose={() => setMenu(false)} />}
        </div>
      </div>
    </div>
  );
}

export default memo(DownloadItem);
