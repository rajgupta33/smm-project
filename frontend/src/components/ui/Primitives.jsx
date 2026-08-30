/**
 * Small presentational primitives shared across customer and admin screens so
 * spacing, status colour, and empty/loading states stay consistent instead of
 * being re-invented per page.
 */

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="page-head">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ children, className = '', padded = true }) {
  return <div className={`card ${padded ? 'card-p' : ''} ${className}`}>{children}</div>;
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="empty-state">
      {Icon && <Icon className="h-10 w-10 text-ink-faint" aria-hidden="true" />}
      <div>
        <p className="font-semibold text-ink">{title}</p>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className = 'h-4 w-full' }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function LoadingRows({ rows = 3 }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="card card-p space-y-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

const STATUS_TONE = [
  [/^(completed|success|succeeded|paid|credited|enqueued|approved|resolved|healthy|available)/i, 'badge-success'],
  [/^(failed|rejected|error|cancelled|canceled|expired|disputed|refunded|unavailable|crashed)/i, 'badge-danger'],
  [/^(pending|processing|submitting|in.?progress|queued|partial|awaiting|reconcil|needs.?support|degraded|drip)/i, 'badge-warning'],
];

/** Maps a free-form backend status string onto a consistent visual tone. */
export function StatusBadge({ status, className = '' }) {
  const label = String(status ?? '—').replace(/_/g, ' ');
  const match = STATUS_TONE.find(([pattern]) => pattern.test(label));
  const tone = match ? match[1] : 'badge-neutral';
  return <span className={`${tone} ${className}`}>{label.toUpperCase()}</span>;
}

/** Renders a value that may legitimately be absent, without printing "null". */
export function Value({ children, fallback = '—', mono = false }) {
  const empty = children === null || children === undefined || children === '';
  if (empty) return <span className="text-ink-faint">{fallback}</span>;
  return <span className={mono ? 'font-mono text-xs' : undefined}>{children}</span>;
}

export function Money({ minor, className = '' }) {
  const amount = Number(minor || 0) / 100;
  return (
    <span className={`tnum font-semibold ${className}`}>
      ₹{amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}

export function Notice({ tone = 'info', children }) {
  const tones = {
    info: 'border-state-info/30 bg-state-info-bg text-state-info',
    success: 'border-state-success/30 bg-state-success-bg text-state-success',
    warning: 'border-state-warning/30 bg-state-warning-bg text-state-warning',
    danger: 'border-state-danger/30 bg-state-danger-bg text-state-danger',
  };
  return (
    <p role="status" className={`rounded-xl border px-4 py-3 text-sm font-medium ${tones[tone] || tones.info}`}>
      {children}
    </p>
  );
}
