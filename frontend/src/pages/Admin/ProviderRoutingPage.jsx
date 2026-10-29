import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import ResponsiveNavbar from '../../components/NavBar';
import { providerApi } from '../../service/api';

const emptyProvider = {
  code: '', name: '', apiBaseUrl: '', credentialReference: 'env:',
  priority: 100, timeoutMs: 15000,
};

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : 'Not completed';
}

const BALANCE_LEVEL_TEXT = {
  OK: 'text-state-success',
  WARNING: 'text-state-warning',
  CRITICAL: 'text-state-danger',
};

function rupeesInput(minor) {
  return Number.isSafeInteger(minor) ? String(minor / 100) : '';
}

/** Blank means "no fixed limit" (null); an invalid entry returns undefined. */
function paiseFromInput(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  return Math.round(amount * 100);
}

function balanceDraftFor(provider) {
  return {
    enabled: provider.balanceMonitoringEnabled !== false,
    warning: rupeesInput(provider.lowBalanceWarningMinor),
    critical: rupeesInput(provider.lowBalanceCriticalMinor),
  };
}

function formatBalance(snapshot) {
  const amount = (snapshot.balanceMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `₹${amount}${snapshot.currency ? ` ${snapshot.currency}` : ''}`;
}

function costChangeLabel(change) {
  const before = change.before?.costRateMinor;
  const after = change.after?.costRateMinor;
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  if (before === 0) return `Cost: ₹${(before / 100).toFixed(2)} → ₹${(after / 100).toFixed(2)}`;
  const percentage = ((after - before) / before) * 100;
  return `Cost: ₹${(before / 100).toFixed(2)} → ₹${(after / 100).toFixed(2)} (${percentage >= 0 ? '+' : ''}${percentage.toFixed(1)}%)`;
}

export default function ProviderRoutingPage() {
  const [providers, setProviders] = useState([]);
  const [catalogue, setCatalogue] = useState([]);
  const [offers, setOffers] = useState([]);
  const [providerForm, setProviderForm] = useState(emptyProvider);
  const [routingDrafts, setRoutingDrafts] = useState({});
  const [syncRuns, setSyncRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [syncMappings, setSyncMappings] = useState({});
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [applying, setApplying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [balanceDrafts, setBalanceDrafts] = useState({});
  const [checkingBalances, setCheckingBalances] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [providerData, catalogueData, offerData, syncRunData] = await Promise.all([
        providerApi.listProviders(), providerApi.listCatalogue(), providerApi.listOffers(),
        providerApi.listSyncRuns(),
      ]);
      setProviders(providerData);
      setBalanceDrafts(Object.fromEntries(providerData.map((provider) => [provider._id, balanceDraftFor(provider)])));
      setCatalogue(catalogueData);
      setOffers(offerData);
      setSyncRuns(syncRunData);
      setRoutingDrafts(Object.fromEntries(catalogueData.map((service) => [service._id, {
        primaryProviderId: service.primaryProviderId || '',
        fallbackProviderId: service.fallbackProviderId || '',
      }])));
    } catch (error) {
      toast.error(error.response?.data?.error?.message || 'Provider routing data could not be loaded');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const offersByCatalogue = useMemo(() => {
    const result = new Map();
    for (const offer of offers) {
      const key = String(offer.catalogueServiceId || '');
      if (!result.has(key)) result.set(key, []);
      result.get(key).push(offer);
    }
    return result;
  }, [offers]);

  const reviewedExistingOffers = useMemo(() => {
    if (!selectedRun?.report) return [];
    const seen = new Set(selectedRun.report.seen || []);
    const newlyReported = new Set((selectedRun.report.new || []).map((offer) => offer.providerServiceId));
    return offers.filter((offer) => String(offer.providerId) === String(selectedRun.providerId)
      && seen.has(offer.providerServiceId) && !newlyReported.has(offer.providerServiceId));
  }, [offers, selectedRun]);

  const eligibleProviders = (service) => {
    const providerIds = new Set((offersByCatalogue.get(String(service._id)) || [])
      .filter((offer) => offer.availability === 'AVAILABLE'
        && offer.min <= service.min && offer.max >= service.max
        && offer.pricingUnit === service.pricingUnit)
      .map((offer) => String(offer.providerId)));
    return providers.filter((provider) => provider.enabled && providerIds.has(String(provider._id)));
  };

  const createProvider = async (event) => {
    event.preventDefault();
    try {
      await providerApi.createProvider({
        ...providerForm,
        adapterType: 'LEGACY_SMM',
        priority: Number(providerForm.priority),
        timeoutMs: Number(providerForm.timeoutMs),
        enabled: true,
      });
      toast.success('Provider configuration created');
      setProviderForm(emptyProvider);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error?.message || 'Provider could not be created');
    }
  };

  const saveRouting = async (service) => {
    const draft = routingDrafts[service._id];
    if (!draft?.primaryProviderId) {
      toast.error('Select a primary provider');
      return;
    }
    if (draft.primaryProviderId === draft.fallbackProviderId) {
      toast.error('Primary and fallback providers must be different');
      return;
    }
    try {
      await providerApi.updateRouting(service._id, {
        routingStrategy: 'MANUAL_PRIORITY',
        primaryProviderId: draft.primaryProviderId,
        fallbackProviderId: draft.fallbackProviderId || null,
      });
      toast.success(`Routing saved for ${service.displayName}`);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error?.message || 'Routing could not be saved');
    }
  };

  const reactivateService = async (service) => {
    try {
      await providerApi.reactivateCatalogueService(service._id);
      toast.success(`${service.displayName} reactivated and visible to customers again`);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error?.message || 'Service could not be reactivated');
    }
  };

  const queueSync = async (provider) => {
    try {
      await providerApi.queueSyncReport(provider._id);
      toast.success(`Report-only sync queued for ${provider.name}`);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error?.message || 'Provider sync could not be queued');
    }
  };

  const updateBalanceDraft = (provider, changes) => {
    setBalanceDrafts((current) => ({
      ...current,
      [provider._id]: { ...(current[provider._id] || balanceDraftFor(provider)), ...changes },
    }));
  };

  const saveBalanceSettings = async (provider) => {
    const draft = balanceDrafts[provider._id] || balanceDraftFor(provider);
    const warning = paiseFromInput(draft.warning);
    const critical = paiseFromInput(draft.critical);
    if (warning === undefined || critical === undefined) {
      toast.error('Enter alert limits as rupee amounts, or leave them blank');
      return;
    }
    if (warning !== null && critical !== null && critical > warning) {
      toast.error('The critical limit must be lower than the warning limit');
      return;
    }
    try {
      await providerApi.updateProvider(provider._id, {
        balanceMonitoringEnabled: draft.enabled,
        lowBalanceWarningMinor: warning,
        lowBalanceCriticalMinor: critical,
      });
      toast.success(`Balance alert limits saved for ${provider.name}`);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error?.message || 'Balance alert limits could not be saved');
    }
  };

  const checkBalances = async () => {
    setCheckingBalances(true);
    try {
      const { counts } = await providerApi.checkBalances();
      toast.success(`Checked ${counts.scanned} provider balance${counts.scanned === 1 ? '' : 's'}`);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error?.message || 'Provider balances could not be checked');
    } finally {
      setCheckingBalances(false);
    }
  };

  const reviewSyncRun = async (runId) => {
    try {
      const run = await providerApi.getSyncRun(runId);
      setSelectedRun(run);
      setSyncMappings({});
      setReviewConfirmed(false);
    } catch (error) {
      toast.error(error.response?.data?.error?.message || 'Synchronization report could not be loaded');
    }
  };

  const applySyncRun = async () => {
    if (!selectedRun || !reviewConfirmed) {
      toast.error('Confirm that you reviewed the proposed changes');
      return;
    }
    const catalogueMappings = Object.entries(syncMappings)
      .filter(([, catalogueServiceId]) => catalogueServiceId)
      .map(([providerServiceId, catalogueServiceId]) => ({ providerServiceId, catalogueServiceId }));
    setApplying(true);
    try {
      await providerApi.applySyncRun(selectedRun._id, catalogueMappings);
      toast.success('Provider synchronization report applied');
      setSelectedRun(null);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error?.message || 'Synchronization report could not be applied');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-sunken text-ink">
      <ResponsiveNavbar />
      <main className="max-w-7xl mx-auto p-6 space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Provider Routing</h1>
          <p className="text-ink-muted mt-2">Configure server-side provider connections and explicit primary/fallback priority.</p>
        </div>

        <form onSubmit={createProvider} className="bg-surface border border-line rounded-xl p-5 space-y-4">
          <h2 className="text-xl font-semibold">Add provider</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[['code', 'Code'], ['name', 'Name'], ['apiBaseUrl', 'API base URL'], ['credentialReference', 'Credential environment reference']].map(([name, label]) => (
              <label key={name} className="text-sm text-ink-soft">
                {label}
                <input
                  name={name}
                  value={providerForm[name]}
                  onChange={(event) => setProviderForm((current) => ({ ...current, [name]: event.target.value }))}
                  placeholder={name === 'credentialReference' ? 'env:SECOND_PROVIDER_API_KEY' : ''}
                  required
                  className="mt-1 w-full rounded bg-surface border border-line p-2"
                />
              </label>
            ))}
            <label className="text-sm text-ink-soft">Priority
              <input type="number" value={providerForm.priority} onChange={(event) => setProviderForm((current) => ({ ...current, priority: event.target.value }))} className="mt-1 w-full rounded bg-surface border border-line p-2" />
            </label>
            <label className="text-sm text-ink-soft">Timeout (ms)
              <input type="number" min="1" value={providerForm.timeoutMs} onChange={(event) => setProviderForm((current) => ({ ...current, timeoutMs: event.target.value }))} className="mt-1 w-full rounded bg-surface border border-line p-2" />
            </label>
          </div>
          <p className="text-xs text-amber-300">The referenced environment variable must already exist on the backend. API keys are never stored in MongoDB or returned to this page.</p>
          <button type="submit" className="rounded bg-brand-gradient text-white hover:brightness-110 px-4 py-2 font-semibold">Create provider</button>
        </form>

        <section className="bg-surface border border-line rounded-xl p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Providers</h2>
              <p className="text-sm text-ink-muted">Balances are checked automatically every 30 minutes. Low balances raise an alert.</p>
            </div>
            <button type="button" onClick={checkBalances} disabled={checkingBalances} className="rounded border border-line px-3 py-1.5 text-sm disabled:opacity-50">
              {checkingBalances ? 'Checking…' : 'Check balances now'}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {providers.map((provider) => {
              const snapshot = provider.balanceSnapshot;
              const balanceDraft = balanceDrafts[provider._id] || balanceDraftFor(provider);
              return (
                <article key={provider._id} className="rounded border border-line bg-surface p-4">
                  <div className="flex justify-between gap-4">
                    <div><h3 className="font-semibold">{provider.name}</h3><p className="text-sm text-ink-muted">{provider.code} · {provider.healthStatus}</p></div>
                    <span className={provider.enabled ? 'text-state-success' : 'text-state-danger'}>{provider.enabled ? 'Enabled' : 'Disabled'}</span>
                  </div>
                  <p className="text-xs text-ink-muted mt-2 break-all">{provider.apiBaseUrl}</p>
                  <button onClick={() => queueSync(provider)} className="mt-3 rounded bg-blue-700 hover:bg-blue-600 px-3 py-1.5 text-sm">Queue report-only sync</button>

                  <div className="mt-4 rounded border border-line bg-surface-sunken p-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">Provider balance</span>
                      {snapshot?.checkedAt
                        ? <span className={`tnum font-semibold ${BALANCE_LEVEL_TEXT[snapshot.level] || ''}`}>{formatBalance(snapshot)}</span>
                        : <span className="text-ink-muted">Not checked yet</span>}
                    </div>
                    {snapshot?.checkedAt && (
                      <p className="mt-1 text-xs text-ink-muted">
                        Checked {formatDate(snapshot.checkedAt)}
                        {Number.isSafeInteger(snapshot.runwayHours) ? ` · lasts about ${snapshot.runwayHours} hours at recent spend` : ''}
                      </p>
                    )}
                    {provider.balanceCheckError && (
                      <p className="mt-1 text-xs text-state-danger">Last check failed: {provider.balanceCheckError.message}</p>
                    )}
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label className="text-xs text-ink-soft">Warn below (₹)
                        <input type="number" min="0" step="0.01" aria-label={`Low balance warning for ${provider.name}`} value={balanceDraft.warning} onChange={(event) => updateBalanceDraft(provider, { warning: event.target.value })} className="mt-1 w-full rounded bg-surface border border-line p-2 text-sm" />
                      </label>
                      <label className="text-xs text-ink-soft">Critical below (₹)
                        <input type="number" min="0" step="0.01" aria-label={`Critical balance for ${provider.name}`} value={balanceDraft.critical} onChange={(event) => updateBalanceDraft(provider, { critical: event.target.value })} className="mt-1 w-full rounded bg-surface border border-line p-2 text-sm" />
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-xs text-ink-soft">
                        <input type="checkbox" role="switch" checked={balanceDraft.enabled} onChange={(event) => updateBalanceDraft(provider, { enabled: event.target.checked })} />
                        Balance alerts on
                      </label>
                      <button type="button" onClick={() => saveBalanceSettings(provider)} className="rounded border border-line px-3 py-1.5 text-sm">Save alert limits</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="bg-surface border border-line rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Synchronization reports</h2>
              <p className="text-sm text-ink-muted">Review provider-authored changes before updating internal offers.</p>
            </div>
            <button type="button" onClick={load} className="rounded border border-line px-3 py-1.5 text-sm">Refresh</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[760px]">
              <thead><tr className="border-b border-line text-ink-muted"><th className="p-2">Provider</th><th className="p-2">Run status</th><th className="p-2">Changes</th><th className="p-2">Completed</th><th className="p-2">Action</th></tr></thead>
              <tbody>{syncRuns.map((run) => {
                const provider = providers.find((item) => String(item._id) === String(run.providerId));
                return (
                  <tr key={run._id} className="border-b border-line">
                    <td className="p-2">{provider?.name || 'Unknown provider'}</td>
                    <td className="p-2"><div>{run.status}</div><div className="text-xs text-ink-muted">{run.applicationStatus || 'PENDING'}</div></td>
                    <td className="p-2 text-sm">{run.counts?.new || 0} new · {run.counts?.changed || 0} changed · {run.counts?.missing || 0} missing</td>
                    <td className="p-2 text-sm text-ink-muted">{formatDate(run.completedAt)}</td>
                    <td className="p-2">
                      {run.status === 'COMPLETED' && (
                        <button type="button" onClick={() => reviewSyncRun(run._id)} className="rounded bg-blue-700 hover:bg-blue-600 px-3 py-1.5 text-sm">
                          {run.applicationStatus === 'APPLIED' ? 'View applied report' : 'Review report'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
            {!syncRuns.length && !loading && <p className="py-4 text-ink-muted">No synchronization reports yet.</p>}
          </div>

          {selectedRun && (
            <div className="rounded-xl border border-blue-700 bg-surface-sunken p-5 space-y-5" aria-label="Synchronization report review">
              <div className="flex justify-between gap-3">
                <div><h3 className="text-lg font-semibold">Review report</h3><p className="text-xs text-ink-muted">Generated {formatDate(selectedRun.report?.generatedAt)}</p></div>
                <button type="button" onClick={() => setSelectedRun(null)} className="text-ink-muted">Close</button>
              </div>
              <p className="rounded border border-amber-700 bg-state-warning-bg p-3 text-sm text-state-warning">
                Applying updates provider costs and availability only. Customer selling prices are not automatically changed. Invalid provider rows are skipped.
              </p>

              <div>
                <h4 className="font-semibold mb-2">New offers ({selectedRun.report?.new?.length || 0})</h4>
                <div className="space-y-2">{(selectedRun.report?.new || []).map((offer) => (
                  <div key={offer.providerServiceId} className="grid md:grid-cols-[1fr_240px] gap-3 rounded border border-line p-3">
                    <div><div className="font-medium">{offer.providerNameSnapshot}</div><div className="text-xs text-ink-muted">Provider ID {offer.providerServiceId} · ₹{(offer.costRateMinor / 100).toFixed(2)} per {offer.pricingUnit} · {offer.min}–{offer.max}</div></div>
                    <label className="text-xs text-ink-muted">Optional catalogue mapping
                      <select aria-label={`Catalogue mapping for ${offer.providerNameSnapshot}`} value={syncMappings[offer.providerServiceId] || ''} onChange={(event) => setSyncMappings((current) => ({ ...current, [offer.providerServiceId]: event.target.value }))} className="mt-1 w-full rounded bg-surface border border-line p-2 text-sm">
                        <option value="">Leave unmapped</option>
                        {catalogue.filter((service) => service.fulfilmentType === 'PROVIDER' && service.pricingUnit === offer.pricingUnit && offer.max >= service.min && offer.min <= service.max).map((service) => <option key={service._id} value={service._id}>{service.displayName}</option>)}
                      </select>
                    </label>
                  </div>
                ))}</div>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Changed offers ({selectedRun.report?.changed?.length || 0})</h4>
                <div className="space-y-2">{(selectedRun.report?.changed || []).map((change) => {
                  const priceLabel = costChangeLabel(change);
                  const priceBefore = change.before?.costRateMinor;
                  const priceAfter = change.after?.costRateMinor;
                  const extreme = Number.isFinite(priceBefore) && priceBefore > 0 && Math.abs(priceAfter - priceBefore) / priceBefore > 0.2;
                  return <div key={change.providerServiceId} className={`rounded border p-3 text-sm ${extreme ? 'border-amber-600' : 'border-line'}`}><div className="font-medium">Provider service {change.providerServiceId}</div><div className="text-ink-muted">Fields: {change.fields.join(', ')}</div>{priceLabel && <div className={extreme ? 'text-amber-300 font-semibold' : 'text-ink-soft'}>{priceLabel}{extreme ? ' · price review required' : ''}</div>}</div>;
                })}</div>
              </div>

              {reviewedExistingOffers.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">Existing offer mappings</h4>
                  <p className="text-xs text-ink-muted mb-2">You may map or remap an offer observed in this report. Leaving a selection unchanged preserves its current mapping.</p>
                  <div className="grid md:grid-cols-2 gap-2">{reviewedExistingOffers.map((offer) => (
                    <label key={offer.providerServiceId} className="rounded border border-line p-3 text-xs text-ink-muted">
                      {offer.providerNameSnapshot} ({offer.providerServiceId})
                      <select aria-label={`Existing catalogue mapping for ${offer.providerServiceId}`} value={syncMappings[offer.providerServiceId] ?? String(offer.catalogueServiceId || '')} onChange={(event) => setSyncMappings((current) => ({ ...current, [offer.providerServiceId]: event.target.value }))} className="mt-1 w-full rounded bg-surface border border-line p-2 text-sm">
                        <option value="">No new mapping (preserve current)</option>
                        {catalogue.filter((service) => service.fulfilmentType === 'PROVIDER' && service.pricingUnit === offer.pricingUnit && offer.max >= service.min && offer.min <= service.max).map((service) => <option key={service._id} value={service._id}>{service.displayName}</option>)}
                      </select>
                    </label>
                  ))}</div>
                </div>
              )}

              <div>
                <h4 className="font-semibold mb-2">Missing offers ({selectedRun.report?.missing?.length || 0})</h4>
                <div className="space-y-1 text-sm text-ink-soft">{(selectedRun.report?.missing || []).map((offer) => <div key={offer.providerServiceId}>{offer.providerServiceId}: {offer.currentAvailability} → {offer.proposedAvailability} ({offer.consecutiveMissingSyncs} consecutive reports)</div>)}</div>
              </div>

              <div className="text-sm text-state-danger">Invalid rows skipped: {selectedRun.report?.invalid?.length || 0}</div>
              {selectedRun.applicationStatus !== 'APPLIED' ? (
                <div className="space-y-3">
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} className="mt-1" />I reviewed the costs, limits, mappings, refill changes, and missing-service status changes.</label>
                  <button type="button" disabled={applying || !reviewConfirmed} onClick={applySyncRun} className="rounded bg-green-700 hover:bg-green-600 disabled:opacity-50 px-4 py-2 font-semibold">{applying ? 'Applying…' : 'Apply reviewed report'}</button>
                </div>
              ) : <p className="text-state-success">Applied {formatDate(selectedRun.appliedAt)}</p>}
            </div>
          )}
        </section>

        <section className="bg-surface border border-line rounded-xl p-5 overflow-x-auto">
          <h2 className="text-xl font-semibold mb-4">Manual priority by catalogue service</h2>
          {loading ? <p className="text-ink-muted">Loading…</p> : (
            <table className="w-full text-left min-w-[800px]">
              <thead><tr className="border-b border-line text-ink-muted"><th className="p-2">Service</th><th className="p-2">Primary</th><th className="p-2">Fallback</th><th className="p-2">Action</th></tr></thead>
              <tbody>{catalogue.filter((service) => service.fulfilmentType === 'PROVIDER').map((service) => {
                const eligible = eligibleProviders(service);
                const draft = routingDrafts[service._id] || {};
                return (
                  <tr key={service._id} className="border-b border-line">
                    <td className="p-2">
                      <div className="font-medium">{service.displayName}</div>
                      <div className="text-xs text-ink-muted">{service.min}–{service.max}</div>
                      {service.autoHiddenAt && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="badge-danger">Auto-hidden</span>
                          <button type="button" onClick={() => reactivateService(service)} className="text-xs font-semibold text-brand-blue underline">Reactivate</button>
                        </div>
                      )}
                    </td>
                    <td className="p-2"><select aria-label={`Primary provider for ${service.displayName}`} value={draft.primaryProviderId || ''} onChange={(event) => setRoutingDrafts((current) => ({ ...current, [service._id]: { ...draft, primaryProviderId: event.target.value } }))} className="w-full rounded bg-surface border border-line p-2"><option value="">Select primary</option>{eligible.map((provider) => <option key={provider._id} value={provider._id}>{provider.name}</option>)}</select></td>
                    <td className="p-2"><select aria-label={`Fallback provider for ${service.displayName}`} value={draft.fallbackProviderId || ''} onChange={(event) => setRoutingDrafts((current) => ({ ...current, [service._id]: { ...draft, fallbackProviderId: event.target.value } }))} className="w-full rounded bg-surface border border-line p-2"><option value="">No fallback</option>{eligible.map((provider) => <option key={provider._id} value={provider._id}>{provider.name}</option>)}</select></td>
                    <td className="p-2"><button onClick={() => saveRouting(service)} className="rounded bg-brand-gradient text-white hover:brightness-110 px-3 py-2">Save</button></td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}
