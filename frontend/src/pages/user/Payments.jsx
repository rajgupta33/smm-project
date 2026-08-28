import { useCallback, useEffect, useState } from 'react';
import ResponsiveNavbar from '../../components/NavBar';
import WalletTopUp from '../../components/WalletTopUp';
import { paymentApi } from '../../service/api';

const money = (minor) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR',
}).format(minor / 100);

export default function Payments() {
  const [payments, setPayments] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await paymentApi.listMine();
      setPayments(response.data);
      setError('');
    } catch {
      setError('Could not load payment history.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <ResponsiveNavbar />
      <main className="min-h-screen bg-gradient-to-br from-black to-purple-950 p-4 text-white sm:p-8">
        <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <WalletTopUp onCreated={load} />
          <section>
            <h2 className="text-3xl font-bold text-purple-300">Payment history</h2>
            {loading && <p className="mt-5 text-purple-200">Loading payments…</p>}
            {error && <p role="alert" className="mt-5 text-red-300">{error}</p>}
            {!loading && !error && payments.length === 0 && <p className="mt-5 text-purple-200">No top-ups yet.</p>}
            <div className="mt-5 space-y-3">
              {payments.map((payment) => (
                <article key={payment.id} className="rounded-xl border border-purple-800 bg-black/60 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <strong>{money(payment.amountMinor)}</strong>
                    <span className="rounded-full bg-purple-900 px-3 py-1 text-xs">{payment.status}</span>
                  </div>
                  <p className="mt-2 break-all text-xs text-purple-200">{payment.merchantOrderId}</p>
                  <time className="text-xs text-gray-400">{new Date(payment.createdAt).toLocaleString()}</time>
                </article>
              ))}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
