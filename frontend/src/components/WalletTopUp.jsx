import { useEffect, useState } from 'react';
import { paymentApi } from '../service/api';
import { openCashfreeCheckout } from '../service/cashfreeCheckout';

const presets = [500, 1000, 2000];

function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() || `topup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function WalletTopUp({ onCreated }) {
  const [amount, setAmount] = useState('500');
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    paymentApi.config().then(setConfig).catch(() => setMessage('Top-ups are temporarily unavailable.'));
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('Creating a secure Cashfree checkout…');
    try {
      const response = await paymentApi.createOrder(amount, newIdempotencyKey());
      onCreated?.();
      if (response.creationPending || !response.data.paymentSessionId) {
        setMessage('Cashfree is confirming this request. It will be reconciled automatically; do not submit it again.');
        return;
      }
      await openCashfreeCheckout({
        paymentSessionId: response.data.paymentSessionId,
        mode: response.checkoutMode,
      });
    } catch (error) {
      setMessage(error.response?.data?.error || error.message || 'Could not start checkout.');
    } finally {
      setBusy(false);
    }
  }

  const minimum = (config?.minTopupMinor || 10000) / 100;
  const maximum = (config?.maxTopupMinor || 10000000) / 100;

  return (
    <section className="rounded-2xl border border-purple-700/60 bg-black/70 p-6 shadow-xl">
      <h1 className="text-3xl font-bold text-purple-300">Add money to your wallet</h1>
      <p className="mt-2 text-sm text-purple-100">Payments are verified by the server before your balance changes.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="flex flex-wrap gap-2">
          {presets.map((value) => (
            <button key={value} type="button" onClick={() => setAmount(String(value))}
              className="rounded-lg border border-purple-500 px-4 py-2 hover:bg-purple-900">
              ₹{value.toLocaleString('en-IN')}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="text-sm text-purple-100">Custom amount (₹)</span>
          <input aria-label="Top-up amount" type="number" min={minimum} max={maximum} step="0.01"
            value={amount} onChange={(event) => setAmount(event.target.value)} required
            className="mt-1 w-full rounded-lg border border-purple-700 bg-gray-950 px-4 py-3 text-white" />
        </label>
        <button disabled={busy || !config} type="submit"
          className="w-full rounded-lg bg-purple-600 px-5 py-3 font-semibold hover:bg-purple-500 disabled:opacity-50">
          {busy ? 'Please wait…' : 'Continue securely with Cashfree'}
        </button>
      </form>
      {message && <p role="status" className="mt-4 text-sm text-purple-200">{message}</p>}
    </section>
  );
}
