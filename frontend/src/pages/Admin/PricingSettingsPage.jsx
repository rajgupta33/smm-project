import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { toast, ToastContainer } from 'react-toastify';
import ResponsiveNavbar from '../../components/NavBar';
import { serviceApi } from '../../service/api';

const toPercent = (basisPoints) => (basisPoints / 100).toString();

export default function PricingSettingsPage() {
  const [settings, setSettings] = useState(null);
  const [markupPercent, setMarkupPercent] = useState('');
  const [minimumPercent, setMinimumPercent] = useState('');
  const [previewRate, setPreviewRate] = useState('100');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);

  const load = async () => {
    setLoading(true);
    const [settingsResult, historyResult] = await Promise.all([
      serviceApi.getPricingSettings(),
      serviceApi.getPricingHistory(),
    ]);
    if (!settingsResult.success) {
      toast.error(settingsResult.message);
    } else {
      setSettings(settingsResult.data);
      setMarkupPercent(toPercent(settingsResult.data.globalMarkupBps));
      setMinimumPercent(toPercent(settingsResult.data.minimumMarginBps));
    }
    if (historyResult.success) setHistory(historyResult.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const markupBps = Number(markupPercent) * 100;
  const minimumMarginBps = Number(minimumPercent) * 100;

  const requestPreview = async () => {
    if (!Number.isSafeInteger(markupBps)) {
      toast.error('Markup may have no more than two decimal places.');
      return;
    }
    setPreviewing(true);
    const result = await serviceApi.previewPricing(previewRate, markupBps);
    if (result.success) setPreview(result.data);
    else toast.error(result.message);
    setPreviewing(false);
  };

  const save = async (event) => {
    event.preventDefault();
    if (!settings || !Number.isSafeInteger(markupBps) || !Number.isSafeInteger(minimumMarginBps)) {
      toast.error('Enter valid percentages with no more than two decimal places.');
      return;
    }
    if (markupBps < minimumMarginBps || markupBps < 0 || markupBps > settings.maxMarkupBps) {
      toast.error('Markup must be within the allowed range and at least the minimum margin.');
      return;
    }
    setSaving(true);
    const result = await serviceApi.updatePricingSettings({
      globalMarkupBps: markupBps,
      minimumMarginBps,
      expectedVersion: settings.version,
    });
    if (result.success) {
      setSettings(result.data);
      toast.success('Pricing settings updated. New orders use the new price.');
      const historyResult = await serviceApi.getPricingHistory();
      if (historyResult.success) setHistory(historyResult.data);
    } else {
      toast.error(result.message);
    }
    setSaving(false);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <ResponsiveNavbar />
      <ToastContainer theme="dark" />
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-3xl font-bold">Pricing settings</h1>
        <p className="mt-2 text-gray-400">Configure the markup applied to provider rates for new orders.</p>

        {loading ? (
          <div className="mt-12 flex justify-center"><Loader2 className="animate-spin" /></div>
        ) : settings && (
          <>
            <form onSubmit={save} className="mt-8 grid gap-6 rounded-xl border border-gray-800 bg-gray-900 p-6 md:grid-cols-2">
              <label className="block">
                <span className="text-sm text-gray-300">Global markup (%)</span>
                <input className="mt-2 w-full rounded border border-gray-700 bg-gray-950 p-3" type="number" min="0" max={settings.maxMarkupBps / 100} step="0.01" value={markupPercent} onChange={(event) => setMarkupPercent(event.target.value)} required />
              </label>
              <label className="block">
                <span className="text-sm text-gray-300">Minimum margin (%)</span>
                <input className="mt-2 w-full rounded border border-gray-700 bg-gray-950 p-3" type="number" min="0" max={settings.maxMarkupBps / 100} step="0.01" value={minimumPercent} onChange={(event) => setMinimumPercent(event.target.value)} required />
              </label>
              <div className="md:col-span-2 rounded-lg bg-gray-950 p-4">
                <label className="block text-sm text-gray-300">Provider-rate preview (₹ per 1,000)</label>
                <input className="mt-2 w-full rounded border border-gray-700 bg-gray-900 p-3" type="number" min="0" step="0.01" value={previewRate} onChange={(event) => setPreviewRate(event.target.value)} />
                <div className="mt-3 flex items-center justify-between gap-4">
                  <p className="text-lg">Customer rate: <span className="font-semibold text-purple-400">{preview === null ? '—' : `₹${preview.sellingRate.toFixed(2)}`}</span></p>
                  <button type="button" onClick={requestPreview} disabled={previewing} className="rounded border border-purple-500 px-4 py-2 text-sm hover:bg-purple-950 disabled:opacity-50">{previewing ? 'Calculating…' : 'Preview'}</button>
                </div>
              </div>
              <div className="md:col-span-2 flex items-center justify-between gap-4">
                <span className="text-sm text-gray-500">Version {settings.version} · INR · per {settings.pricingUnit.toLocaleString()}</span>
                <button disabled={saving} className="flex items-center gap-2 rounded bg-purple-600 px-5 py-3 font-semibold hover:bg-purple-500 disabled:opacity-50">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                </button>
              </div>
            </form>

            <section className="mt-8 rounded-xl border border-gray-800 bg-gray-900 p-6">
              <h2 className="text-xl font-semibold">Recent changes</h2>
              <div className="mt-4 space-y-3">
                {history.length === 0 && <p className="text-gray-500">No pricing changes recorded yet.</p>}
                {history.map((entry) => (
                  <div key={entry._id} className="rounded bg-gray-950 p-4 text-sm">
                    <div className="flex justify-between gap-4"><span>{toPercent(entry.before.globalMarkupBps)}% → {toPercent(entry.after.globalMarkupBps)}%</span><time className="text-gray-500">{new Date(entry.createdAt).toLocaleString()}</time></div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
