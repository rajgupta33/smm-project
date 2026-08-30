import { useCallback, useEffect, useState } from 'react';
import { ReceiptText } from 'lucide-react';
import ResponsiveNavbar from '../../components/NavBar';
import WalletTopUp from '../../components/WalletTopUp';
import { EmptyState, LoadingRows, Notice, StatusBadge } from '../../components/ui/Primitives';
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
    <div className="min-h-screen bg-surface-sunken">
      <ResponsiveNavbar />
      <main className="page">
        <header className="page-head">
          <div>
            <h1 className="page-title">Wallet</h1>
            <p className="page-sub">Top up your balance and review every payment.</p>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start lg:gap-6">
          <div className="lg:sticky lg:top-24">
            <WalletTopUp onCreated={load} />
          </div>

          <section>
            <h2 className="mb-4 text-lg font-semibold text-ink">Payment history</h2>

            {loading && <LoadingRows rows={3} />}
            {error && <Notice tone="danger">{error}</Notice>}

            {!loading && !error && payments.length === 0 && (
              <EmptyState
                icon={ReceiptText}
                title="No top-ups yet"
                description="Once you add money to your wallet, every payment will be listed here."
              />
            )}

            {!loading && !error && payments.length > 0 && (
              <ul className="space-y-3">
                {payments.map((payment) => (
                  <li key={payment.id} className="card card-hover p-4 sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="tnum text-lg font-bold text-ink">{money(payment.amountMinor)}</span>
                      <StatusBadge status={payment.status} />
                    </div>
                    <dl className="mt-3 border-t border-line pt-3">
                      <div className="stack-row">
                        <dt className="stack-key">Reference</dt>
                        <dd className="stack-val break-all font-mono text-xs">{payment.merchantOrderId}</dd>
                      </div>
                      <div className="stack-row">
                        <dt className="stack-key">Date</dt>
                        <dd className="stack-val">
                          {new Date(payment.createdAt).toLocaleString('en-IN', {
                            dateStyle: 'medium', timeStyle: 'short',
                          })}
                        </dd>
                      </div>
                      {payment.creditedAt && (
                        <div className="stack-row">
                          <dt className="stack-key">Credited</dt>
                          <dd className="stack-val">
                            {new Date(payment.creditedAt).toLocaleString('en-IN', {
                              dateStyle: 'medium', timeStyle: 'short',
                            })}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
