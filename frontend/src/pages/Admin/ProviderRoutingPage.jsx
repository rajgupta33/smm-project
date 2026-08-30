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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [providerData, catalogueData, offerData, syncRunData] = await Promise.all([
        providerApi.listProviders(), providerApi.listCatalogue(), providerApi.listOffers(),
        providerApi.listSyncRuns(),
      ]);
      setProviders(providerData);
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

  const queueSync = async (provider) => {
    try {
      await providerApi.queueSyncReport(provider._id);
      toast.success(`Report-only sync queued for ${provider.name}`);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error?.message || 'Provider sync could not be queued');
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
          <button className="rounded bg-brand-gradient text-white hover:brightness-110 px-4 py-2 font-semibold">Create provider</button>
        </form>

        <section className="bg-surface border border-line rounded-xl p-5">
          <h2 className="text-xl font-semibold mb-4">Providers</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {providers.map((provider) => (
              <article key={provider._id} className="rounded border border-line bg-surface p-4">
                <div className="flex justify-between gap-4">
                  <div><h3 className="font-semibold">{provider.name}</h3><p className="text-sm text-ink-muted">{provider.code} · {provider.healthStatus}</p></div>
                  <span className={provider.enabled ? 'text-state-success' : 'text-state-danger'}>{provider.enabled ? 'Enabled' : 'Disabled'}</span>
                </div>
                <p className="text-xs text-ink-muted mt-2 break-all">{provider.apiBaseUrl}</p>
                <button onClick={() => queueSync(provider)} className="mt-3 rounded bg-blue-700 hover:bg-blue-600 px-3 py-1.5 text-sm">Queue report-only sync</button>
              </article>
            ))}
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
                    <td className="p-2"><div className="font-medium">{service.displayName}</div><div className="text-xs text-ink-muted">{service.min}–{service.max}</div></td>
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
