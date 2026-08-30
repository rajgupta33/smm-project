import { useEffect, useState } from 'react';
import { ShieldCheck, Wallet } from 'lucide-react';
import { paymentApi } from '../service/api';
import { openCashfreeCheckout } from '../service/cashfreeCheckout';
import { useAuth } from '../context/Authcontext';

const presets = [500, 1000, 2000];

function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() || `topup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function WalletTopUp({ onCreated }) {
  const [amount, setAmount] = useState('500');
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState('info');
  const auth = useAuth();

  useEffect(() => {
    paymentApi.config().then(setConfig).catch(() => {
      setTone('danger');
      setMessage('Top-ups are temporarily unavailable.');
    });
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setTone('info');
    setMessage('Creating a secure Cashfree checkout…');
    try {
      const response = await paymentApi.createOrder(amount, newIdempotencyKey());
      onCreated?.();
      if (response.creationPending || !response.data.paymentSessionId) {
        setTone('warning');
        setMessage('Cashfree is confirming this request. It will be reconciled automatically; do not submit it again.');
        return;
      }
      await openCashfreeCheckout({
        paymentSessionId: response.data.paymentSessionId,
        mode: response.checkoutMode,
      });
    } catch (error) {
      setTone('danger');
      setMessage(error.response?.data?.error || error.message || 'Could not start checkout.');
    } finally {
      setBusy(false);
    }
  }

  const minimum = (config?.minTopupMinor || 10000) / 100;
  const maximum = (config?.maxTopupMinor || 10000000) / 100;
  const walletRupees = Number(auth.user?.wallet);
  const toneClass = {
    info: 'border-state-info/30 bg-state-info-bg text-state-info',
    warning: 'border-state-warning/30 bg-state-warning-bg text-state-warning',
    danger: 'border-state-danger/30 bg-state-danger-bg text-state-danger',
  }[tone];

  return (
    <section className="card card-p">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Add money to your wallet</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Your balance is verified by our server before it changes.
          </p>
        </div>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-gradient">
          <Wallet className="h-5 w-5 text-white" aria-hidden="true" />
        </span>
      </div>

      {Number.isFinite(walletRupees) && (
        <div className="mb-5 rounded-xl bg-surface-sunken px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Current balance</p>
          <p className="tnum mt-0.5 text-2xl font-bold text-ink">
            ₹{walletRupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {presets.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setAmount(String(value))}
              className={
                String(value) === String(amount)
                  ? 'min-h-[44px] rounded-xl border border-brand-magenta bg-brand-magenta/10 px-3 py-2 text-sm font-semibold text-brand-magenta'
                  : 'min-h-[44px] rounded-xl border border-line px-3 py-2 text-sm font-semibold text-ink-soft transition-colors hover:border-brand-purple/50 hover:bg-surface-sunken'
              }
            >
              ₹{value.toLocaleString('en-IN')}
            </button>
          ))}
        </div>

        <div className="field">
          <label htmlFor="topup-amount" className="label">Custom amount (₹)</label>
          <input
            id="topup-amount"
            aria-label="Top-up amount"
            type="number"
            min={minimum}
            max={maximum}
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
            className="input tnum"
          />
          <p className="hint">
            Between ₹{minimum.toLocaleString('en-IN')} and ₹{maximum.toLocaleString('en-IN')} per top-up.
          </p>
        </div>

        <button disabled={busy || !config} type="submit" className="btn-primary btn-block">
          {busy ? 'Please wait…' : 'Continue securely with Cashfree'}
        </button>
      </form>

      {message && (
        <p role="status" className={`mt-4 rounded-xl border px-3 py-2.5 text-sm font-medium ${toneClass}`}>
          {message}
        </p>
      )}

      <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-ink-muted">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-state-success" aria-hidden="true" />
        Payments are processed by Cashfree. We never see your card details.
      </p>
    </section>
  );
}
