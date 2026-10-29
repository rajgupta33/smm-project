import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCircle2, RefreshCw, Search, Wallet } from 'lucide-react';
import { toast } from 'react-toastify';
import ResponsiveNavbar from '../../components/NavBar';
import { EmptyState, LoadingRows, Notice, PageHeader } from '../../components/ui/Primitives';
import { alertApi, providerApi } from '../../service/api';

const SEVERITY_STYLE = {
  CRITICAL: { badge: 'badge-danger', edge: 'border-l-state-danger' },
  WARNING: { badge: 'badge-warning', edge: 'border-l-state-warning' },
  INFO: { badge: 'badge-info', edge: 'border-l-state-info' },
};

const TYPE_LABEL = {
  PROVIDER_LOW_BALANCE: 'Provider balance',
  PROVIDER_INSUFFICIENT_FUNDS: 'Orders failing',
  PROVIDER_BALANCE_CHECK_FAILED: 'Balance check',
  SERVICE_REMOVED: 'Service hidden',
  SERVICE_OFFER_REMOVED: 'Provider offer removed',
  SERVICE_REAPPEARED: 'Service reappeared',
  PROVIDER_SYNC_ANOMALY: 'Availability check',
};

const REACTIVATABLE_TYPES = new Set(['SERVICE_REMOVED', 'SERVICE_REAPPEARED']);

const VIEWS = [['active', 'Active'], ['resolved', 'Resolved']];

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '—';
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export default function AlertsPage() {
  const [view, setView] = useState('active');
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAlerts(await alertApi.list(view));
    } catch (error) {
      toast.error(error.response?.data?.error?.message || 'Alerts could not be loaded');
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => { load(); }, [load]);

  const act = async (alert, action) => {
    setBusyId(alert._id);
    try {
      if (action === 'acknowledge') {
        await alertApi.acknowledge(alert._id);
        toast.success('Alert acknowledged');
      } else {
        await alertApi.resolve(alert._id);
        toast.success('Alert resolved');
      }
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error?.message || 'Alert could not be updated');
    } finally {
      setBusyId(null);
    }
  };

  const checkBalances = async () => {
    setChecking(true);
    try {
      const { counts } = await providerApi.checkBalances();
      if (!counts.scanned) {
        toast.error('No enabled provider has balance alerts turned on');
      } else {
        toast.success(`Checked ${plural(counts.scanned, 'provider')}: ${counts.critical} critical, ${counts.warning} low, ${counts.failed} failed`);
      }
      if (view === 'active') await load();
      else setView('active');
    } catch (error) {
      toast.error(error.response?.data?.error?.message || 'Provider balances could not be checked');
    } finally {
      setChecking(false);
    }
  };

  const checkAvailability = async () => {
    setCheckingAvailability(true);
    try {
      const { totals } = await providerApi.checkServiceAvailability();
      if (!totals.scanned) {
        toast.error('No enabled provider is configured to check');
      } else {
        toast.success(`Checked ${plural(totals.scanned, 'provider')}: ${totals.removed} hidden, ${totals.offerRemoved} offer removed, ${totals.reappeared} back, ${totals.anomalous} skipped as abnormal`);
      }
      if (view === 'active') await load();
      else setView('active');
    } catch (error) {
      toast.error(error.response?.data?.error?.message || 'Service availability could not be checked');
    } finally {
      setCheckingAvailability(false);
    }
  };

  const reactivate = async (alert) => {
    setBusyId(alert._id);
    try {
      await providerApi.reactivateCatalogueService(alert.targetId);
      // Reactivating is the resolution for this alert; nothing further for the admin to confirm.
      await alertApi.resolve(alert._id).catch(() => {});
      toast.success('Service reactivated and visible to customers again');
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error?.message || 'Service could not be reactivated');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-surface-sunken text-ink">
      <ResponsiveNavbar />
      <main className="page">
        <PageHeader
          title="Alerts"
          subtitle="Problems the panel detected by itself, such as a provider running out of balance."
          actions={(
            <>
              <button type="button" onClick={checkBalances} disabled={checking} className="btn-secondary btn-sm">
                <Wallet className="h-4 w-4" aria-hidden="true" />
                {checking ? 'Checking…' : 'Check provider balances'}
              </button>
              <button type="button" onClick={checkAvailability} disabled={checkingAvailability} className="btn-secondary btn-sm">
                <Search className="h-4 w-4" aria-hidden="true" />
                {checkingAvailability ? 'Checking…' : 'Check service availability'}
              </button>
              <button type="button" onClick={load} className="btn-ghost btn-sm">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Refresh
              </button>
            </>
          )}
        />

        <div role="tablist" aria-label="Alert status" className="mb-4 inline-flex rounded-xl border border-line bg-surface p-1">
          {VIEWS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              onClick={() => setView(value)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${view === value ? 'bg-surface-sunken text-ink' : 'text-ink-muted hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === 'active' && (
          <div className="mb-4">
            <Notice tone="info">
              Alerts close by themselves once the problem clears. If you resolve one while the problem is still there, the next check opens it again.
            </Notice>
          </div>
        )}

        {loading ? <LoadingRows rows={2} /> : alerts.length === 0 ? (
          <EmptyState
            icon={view === 'active' ? CheckCircle2 : Bell}
            title={view === 'active' ? 'No active alerts' : 'No resolved alerts yet'}
            description={view === 'active' ? 'Nothing needs your attention right now.' : undefined}
          />
        ) : (
          <ul className="space-y-3">
            {alerts.map((alert) => {
              const style = SEVERITY_STYLE[alert.severity] || SEVERITY_STYLE.INFO;
              return (
                <li key={alert._id} className={`card card-p border-l-4 ${style.edge}`}>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={style.badge}>{alert.severity}</span>
                        {alert.status === 'ACKNOWLEDGED' && <span className="badge-neutral">ACKNOWLEDGED</span>}
                        {alert.status === 'RESOLVED' && (
                          <span className="badge-success">{alert.resolutionKind === 'AUTO' ? 'CLEARED' : 'RESOLVED'}</span>
                        )}
                        <span className="text-xs font-medium text-ink-muted">{TYPE_LABEL[alert.type] || alert.type}</span>
                      </div>
                      <h2 className="mt-2 text-base font-semibold text-ink">{alert.title}</h2>
                      <p className="mt-1 text-sm text-ink-soft">{alert.message}</p>
                      <p className="mt-2 text-xs text-ink-muted">
                        First seen {formatDate(alert.firstSeenAt)} · Last seen {formatDate(alert.lastSeenAt)} · {plural(alert.occurrences || 1, 'time')}
                        {alert.resolvedAt ? ` · Closed ${formatDate(alert.resolvedAt)}` : ''}
                      </p>
                    </div>
                    {alert.active && (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {REACTIVATABLE_TYPES.has(alert.type) && alert.targetType === 'CatalogueService' && (
                          <button type="button" disabled={busyId === alert._id} onClick={() => reactivate(alert)} className="btn-primary btn-sm">
                            Reactivate service
                          </button>
                        )}
                        {alert.status === 'OPEN' && (
                          <button type="button" disabled={busyId === alert._id} onClick={() => act(alert, 'acknowledge')} className="btn-secondary btn-sm">
                            Acknowledge
                          </button>
                        )}
                        <button type="button" disabled={busyId === alert._id} onClick={() => act(alert, 'resolve')} className="btn-ghost btn-sm">
                          Resolve
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
