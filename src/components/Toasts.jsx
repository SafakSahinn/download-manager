import { X, CheckCircle2, Link2, Info } from 'lucide-react';

const ICONS = { success: CheckCircle2, clipboard: Link2, info: Info };

export default function Toasts({ toasts, dismiss }) {
  return (
    <div className="toasts">
      {toasts.map((ts) => {
        const Icon = ICONS[ts.kind] || Info;
        return (
          <div key={ts.id} className={`toast ${ts.kind}`}>
            <Icon size={18} className="toast-icon" />
            <div className="toast-body">
              <div className="toast-title">{ts.title}</div>
              {ts.text && <div className="toast-text">{ts.text}</div>}
            </div>
            {ts.action && (
              <button
                className="btn small primary"
                onClick={() => {
                  ts.action.run();
                  dismiss(ts.id);
                }}
              >
                {ts.action.label}
              </button>
            )}
            <button className="icon-btn" onClick={() => dismiss(ts.id)}>
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
