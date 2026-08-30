import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { toast } from 'react-toastify';
import ResponsiveNavbar from '../../components/NavBar';
import { operationsApi } from '../../service/api';

const emptyDraft = {
  resolution: '', providerOrderId: '', evidenceNote: '', evidenceUrl: '', confirmed: false,
};

function orderReference(order) {
  return order.localOrderId || order.orderId;
}

function money(amountMinor) {
  if (!Number.isSafeInteger(amountMinor)) return 'Unavailable — engineering review required';
  return `₹${((amountMinor || 0) / 100).toFixed(2)}`;
}

export default function ReconciliationPage() {
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrders(await operationsApi.listReconciliationOrders());
    } catch (error) {
      toast.error(error.response?.data?.error?.message || 'Reconciliation queue could not be loaded');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startResolution = (order) => {
    setSelected(order);
    setDraft(emptyDraft);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!selected || !draft.confirmed || !draft.resolution) {
      toast.error('Select and confirm a verified resolution');
      return;
    }
    if (draft.resolution === 'CONFIRMED_ACCEPTED' && !draft.providerOrderId.trim()) {
      toast.error('Enter the verified provider order ID');
      return;
    }
    setSaving(true);
    try {
      await operationsApi.resolveReconciliation(selected._id, {
        resolution: draft.resolution,
        providerOrderId: draft.resolution === 'CONFIRMED_ACCEPTED' ? draft.providerOrderId.trim() : null,
        evidenceNote: draft.evidenceNote.trim(),
        evidenceUrl: draft.evidenceUrl.trim() || null,
      });
      toast.success('Reconciliation resolved');
      setSelected(null);
      setDraft(emptyDraft);
      await load();
    } catch (error) {
      toast.error(error.response?.data?.error?.message || 'Reconciliation could not be resolved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-sunken text-ink">
      <ResponsiveNavbar />
      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Provider Reconciliation</h1>
            <p className="mt-2 text-ink-muted">Resolve uncertain submissions only after checking the provider’s order history.</p>
          </div>
          <button type="button" onClick={load} className="flex items-center gap-2 rounded border border-line px-3 py-2"><RefreshCw size={16} /> Refresh</button>
        </div>

        <div className="rounded-xl border border-red-800 bg-red-950/30 p-4 text-sm text-red-200">
          <div className="flex gap-2"><AlertTriangle className="shrink-0" size={20} /><p>Never resolve from assumption alone. A provider timeout can still mean acceptance. This screen does not retry or switch providers.</p></div>
        </div>

        <section className="overflow-x-auto rounded-xl border border-line bg-surface p-5">
          <table className="w-full min-w-[940px] text-left">
            <thead><tr className="border-b border-line text-sm text-ink-muted"><th className="p-2">Order</th><th className="p-2">Provider</th><th className="p-2">Service / quantity</th><th className="p-2">Reserved</th><th className="p-2">Reason</th><th className="p-2">Action</th></tr></thead>
            <tbody>{orders.map((order) => (
              <tr key={order._id} className="border-b border-line align-top">
                <td className="p-2"><div className="font-medium">{orderReference(order)}</div><div className="text-xs text-ink-muted">{new Date(order.reconciliationRequiredAt || order.updatedAt).toLocaleString()}</div></td>
                <td className="p-2 text-sm">{order.providerId?.name || 'Legacy provider'}<div className="text-xs text-ink-muted">Service {order.providerServiceId || 'unknown'}</div></td>
                <td className="p-2 text-sm">{order.service}<div className="text-xs text-ink-muted">Quantity {order.quantity}</div></td>
                <td className="p-2"><div>{money(order.reconciliationContext?.refundEligibleMinor)}</div><div className="text-xs text-ink-muted">Refund if not accepted{order.reconciliationContext?.workflowKind === 'DRIP_FEED' ? ` · run ${order.reconciliationContext.runNumber}/${order.reconciliationContext.totalRuns}` : ''}</div></td>
                <td className="max-w-sm p-2 text-sm text-state-warning">{order.reconciliationReason}</td>
                <td className="p-2"><button type="button" onClick={() => startResolution(order)} className="rounded bg-blue-700 px-3 py-1.5 text-sm hover:bg-blue-600">Investigate</button></td>
              </tr>
            ))}</tbody>
          </table>
          {!loading && orders.length === 0 && <div className="py-12 text-center text-ink-muted"><CheckCircle2 className="mx-auto mb-2 text-state-success" />No orders currently require reconciliation.</div>}
          {loading && <p className="py-8 text-center text-ink-muted">Loading reconciliation queue…</p>}
        </section>

        {selected && (
          <form onSubmit={submit} className="rounded-xl border border-blue-700 bg-surface p-5 space-y-5" aria-label="Resolve reconciliation">
            <div className="flex justify-between gap-4"><div><h2 className="text-xl font-semibold">Resolve {orderReference(selected)}</h2><p className="text-sm text-ink-muted">Original reason: {selected.reconciliationReason}</p><p className="mt-1 text-sm text-amber-300">Confirmed non-acceptance will refund {money(selected.reconciliationContext?.refundEligibleMinor)}.</p></div><button type="button" onClick={() => setSelected(null)} className="text-ink-muted">Close</button></div>

            <fieldset className="space-y-2">
              <legend className="font-semibold mb-2">Verified provider outcome</legend>
              <label className="flex gap-3 rounded border border-line p-3"><input type="radio" name="resolution" value="CONFIRMED_ACCEPTED" checked={draft.resolution === 'CONFIRMED_ACCEPTED'} onChange={(event) => setDraft((value) => ({ ...value, resolution: event.target.value, confirmed: false }))} /><span><strong>Provider accepted</strong><span className="block text-sm text-ink-muted">Record the provider order and continue fulfilment. No refund.</span></span></label>
              <label className="flex gap-3 rounded border border-line p-3"><input type="radio" name="resolution" value="CONFIRMED_NOT_ACCEPTED" disabled={!Number.isSafeInteger(selected.reconciliationContext?.refundEligibleMinor)} checked={draft.resolution === 'CONFIRMED_NOT_ACCEPTED'} onChange={(event) => setDraft((value) => ({ ...value, resolution: event.target.value, providerOrderId: '', confirmed: false }))} /><span><strong>Provider did not accept</strong><span className="block text-sm text-ink-muted">Reject/cancel and refund the authoritative unexecuted value. No retry is performed.{!Number.isSafeInteger(selected.reconciliationContext?.refundEligibleMinor) ? ' Disabled because this legacy order has no authoritative refund snapshot.' : ''}</span></span></label>
            </fieldset>

            {draft.resolution === 'CONFIRMED_ACCEPTED' && <label className="block text-sm text-ink-soft">Verified provider order ID<input aria-label="Verified provider order ID" required value={draft.providerOrderId} onChange={(event) => setDraft((value) => ({ ...value, providerOrderId: event.target.value, confirmed: false }))} maxLength={200} className="mt-1 w-full rounded border border-line bg-surface p-2" /></label>}
            <label className="block text-sm text-ink-soft">Evidence note<textarea aria-label="Evidence note" required minLength={10} maxLength={2000} rows={4} value={draft.evidenceNote} onChange={(event) => setDraft((value) => ({ ...value, evidenceNote: event.target.value, confirmed: false }))} placeholder="What was checked, where, and why this outcome is definitive" className="mt-1 w-full rounded border border-line bg-surface p-2" /></label>
            <label className="block text-sm text-ink-soft">Evidence URL (optional, HTTPS only)<input type="url" pattern="https://.*" value={draft.evidenceUrl} onChange={(event) => setDraft((value) => ({ ...value, evidenceUrl: event.target.value, confirmed: false }))} className="mt-1 w-full rounded border border-line bg-surface p-2" /></label>

            <label className="flex items-start gap-2 rounded border border-amber-700 bg-amber-950/30 p-3 text-sm"><input type="checkbox" checked={draft.confirmed} onChange={(event) => setDraft((value) => ({ ...value, confirmed: event.target.checked }))} className="mt-1" /><span>I verified this outcome directly in provider records and understand this action is final and audited.</span></label>
            <button disabled={saving || !draft.confirmed} className={`rounded px-4 py-2 font-semibold disabled:opacity-50 ${draft.resolution === 'CONFIRMED_NOT_ACCEPTED' ? 'bg-red-700 hover:bg-red-600' : 'bg-green-700 hover:bg-green-600'}`}>{saving ? 'Resolving…' : 'Apply verified resolution'}</button>
          </form>
        )}
      </main>
    </div>
  );
}
