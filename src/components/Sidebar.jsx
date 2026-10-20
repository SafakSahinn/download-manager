import { LayoutGrid, ArrowDownCircle, CheckCircle2, Clock, AlertTriangle, Settings, FolderOpen } from 'lucide-react';
import { useT } from '../i18n';
import { CATEGORIES, CATEGORY_META, formatSpeed } from '../utils';

export default function Sidebar({ filter, setFilter, counts, view, setView, totalSpeed }) {
  const t = useT();
  const statusItems = [
    { value: 'all', icon: LayoutGrid, label: t('all'), count: counts.all },
    { value: 'active', icon: ArrowDownCircle, label: t('active'), count: counts.active, accent: true },
    { value: 'completed', icon: CheckCircle2, label: t('completed'), count: counts.completed },
    { value: 'queued', icon: Clock, label: t('queued'), count: counts.queued },
    { value: 'error', icon: AlertTriangle, label: t('error'), count: counts.error, hideZero: true },
  ];
  const isActive = (type, value) => view === 'downloads' && filter.type === type && filter.value === value;

  return (
    <aside className="sidebar">
      <div className="nav-section">
        <div className="nav-title">{t('status')}</div>
        {statusItems
          .filter((s) => !(s.hideZero && !s.count))
          .map((s) => (
            <button key={s.value} className={`nav-item ${isActive('status', s.value) ? 'active' : ''}`} onClick={() => setFilter({ type: 'status', value: s.value })}>
              <s.icon size={17} />
              <span>{s.label}</span>
              {s.count > 0 && <em className={s.accent ? 'accent' : ''}>{s.count}</em>}
            </button>
          ))}
      </div>

      <div className="nav-section">
        <div className="nav-title">{t('categories')}</div>
        {CATEGORIES.map((c) => {
          const M = CATEGORY_META[c];
          return (
            <div key={c} className={`nav-item cat ${isActive('category', c) ? 'active' : ''}`} onClick={() => setFilter({ type: 'category', value: c })} role="button">
              <span className="cat-dot" style={{ '--c': M.color }}>
                <M.icon size={13} />
              </span>
              <span>{t('cat_' + c)}</span>
              <button
                className="nav-open"
                title={t('openFolder')}
                onClick={(e) => {
                  e.stopPropagation();
                  window.api.openCategory(c);
                }}
              >
                <FolderOpen size={14} />
              </button>
              {counts.cat[c] > 0 && <em>{counts.cat[c]}</em>}
            </div>
          );
        })}
      </div>

      <div className="flex-1" />

      <div className="sidebar-footer">
        {counts.active > 0 && (
          <div className="mini-stat">
            <span className="pulse" />
            {t('activeCount', { n: counts.active })} · {formatSpeed(totalSpeed)}
          </div>
        )}
        <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
          <Settings size={17} />
          <span>{t('settings')}</span>
        </button>
      </div>
    </aside>
  );
}
