import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { serviceApi } from '../service/api';

const toPercent = (bps) => (Number(bps) / 100).toString();
const toBps = (percent) => Math.round(Number(percent) * 100);

/**
 * Lets an admin either leave a service on the global markup or set its own.
 * `value` is markupOverrideBps: null/undefined means "use global". Reports
 * back the same shape via onChange so the parent form can drop it straight
 * into the create/update payload.
 *
 * The percentage shown and the price preview both come from the backend
 * (pricingSettings + preview endpoints) rather than being computed here, so
 * this can never show a number that disagrees with what checkout will charge.
 */
export default function ServiceMarkupField({ value, onChange, providerRate }) {
  const [globalSettings, setGlobalSettings] = useState(null);
  const [useCustom, setUseCustom] = useState(value !== null && value !== undefined);
  const [percent, setPercent] = useState(value !== null && value !== undefined ? toPercent(value) : '');
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');

  useEffect(() => {
    serviceApi.getPricingSettings().then((result) => {
      if (result.success) setGlobalSettings(result.data);
    });
  }, []);

  // Follow external changes (e.g. switching which service is being edited).
  useEffect(() => {
    const hasOverride = value !== null && value !== undefined;
    setUseCustom(hasOverride);
    setPercent(hasOverride ? toPercent(value) : '');
  }, [value]);

  useEffect(() => {
    const rate = Number(providerRate);
    if (!useCustom || !Number.isFinite(rate) || rate <= 0 || percent === '') {
      setPreview(null);
      setPreviewError('');
      return undefined;
    }
    const bps = toBps(percent);
    if (!Number.isSafeInteger(bps) || bps < 0) {
      setPreview(null);
      setPreviewError('Markup may have at most two decimal places.');
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await serviceApi.previewPricing(rate, bps);
      if (cancelled) return;
      if (result.success) {
        setPreview(result.data);
        setPreviewError('');
      } else {
        setPreview(null);
        setPreviewError(result.message || 'Could not preview this price.');
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [useCustom, percent, providerRate]);

  function toggle(customEnabled) {
    setUseCustom(customEnabled);
    if (!customEnabled) {
      setPercent('');
      onChange(null);
    } else {
      const initial = globalSettings ? toPercent(globalSettings.globalMarkupBps) : '';
      setPercent(initial);
      onChange(initial === '' ? null : toBps(initial));
    }
  }

  function handlePercentChange(event) {
    const next = event.target.value;
    setPercent(next);
    if (next === '') {
      onChange(null);
      return;
    }
    const bps = toBps(next);
    onChange(Number.isSafeInteger(bps) ? bps : null);
  }

  const globalPercent = globalSettings ? (globalSettings.globalMarkupBps / 100).toFixed(2) : null;
  const minimumPercent = globalSettings ? (globalSettings.minimumMarginBps / 100).toFixed(2) : null;
  const belowMinimum = globalSettings && percent !== '' && toBps(percent) < globalSettings.minimumMarginBps;

  return (
    <div className="rounded-xl border border-line bg-surface-sunken p-4">
      <p className="label mb-3">Customer price for this service</p>

      <div className="space-y-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface p-3 has-[:checked]:border-brand-purple has-[:checked]:ring-1 has-[:checked]:ring-brand-purple/30">
          <input
            type="radio"
            name="markupMode"
            checked={!useCustom}
            onChange={() => toggle(false)}
            className="mt-0.5 h-4 w-4 accent-brand-magenta"
          />
          <span>
            <span className="block text-sm font-medium text-ink">Use the store-wide markup</span>
            <span className="block text-xs text-ink-muted">
              {globalPercent === null ? 'Loading current markup…' : `Currently ${globalPercent}% over provider cost`}
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface p-3 has-[:checked]:border-brand-purple has-[:checked]:ring-1 has-[:checked]:ring-brand-purple/30">
          <input
            type="radio"
            name="markupMode"
            checked={useCustom}
            onChange={() => toggle(true)}
            className="mt-0.5 h-4 w-4 accent-brand-magenta"
          />
          <span className="w-full">
            <span className="block text-sm font-medium text-ink">Set a markup just for this service</span>
            <span className="block text-xs text-ink-muted">Overrides the store-wide markup above</span>

            {useCustom && (
              <span className="mt-3 block">
                <label htmlFor="service-markup-percent" className="sr-only">Markup percentage for this service</label>
                <span className="flex items-center gap-2">
                  <input
                    id="service-markup-percent"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={percent}
                    onChange={handlePercentChange}
                    onClick={(event) => event.stopPropagation()}
                    className="input tnum w-28"
                    placeholder="e.g. 40"
                  />
                  <span className="text-sm text-ink-muted">%</span>
                </span>

                {minimumPercent !== null && (
                  <span className="mt-1.5 block text-xs text-ink-muted">Minimum allowed: {minimumPercent}%</span>
                )}
                {belowMinimum && (
                  <span className="mt-1.5 block text-xs font-medium text-state-danger">
                    Below the {minimumPercent}% floor — this will be rejected on save.
                  </span>
                )}
                {previewError && (
                  <span className="mt-1.5 block text-xs font-medium text-state-danger">{previewError}</span>
                )}
                {preview && !belowMinimum && (
                  <span className="mt-2 flex items-center gap-1.5 rounded-lg bg-state-success-bg px-2.5 py-1.5 text-xs font-medium text-state-success">
                    <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Customer pays ₹{preview.sellingRate.toFixed(2)} per {preview.pricingUnit.toLocaleString('en-IN')}
                  </span>
                )}
              </span>
            )}
          </span>
        </label>
      </div>
    </div>
  );
}
