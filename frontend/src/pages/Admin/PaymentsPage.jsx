import { useCallback, useEffect, useState } from 'react';
import ResponsiveNavbar from '../../components/NavBar';
import { paymentApi } from '../../service/api';

const statuses = ['', 'CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'REFUNDED', 'DISPUTED'];

export default function PaymentsPage() {
  const [payments, setPayments] = useState([]);
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await paymentApi.listAdmin({ status });
      setPayments(response.data);
      setMessage('');
    } catch (error) {
      setMessage(error.response?.data?.error || 'Could not load payments.');
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  async function reconcile(payment) {
    setMessage(`Reconciling ${payment.merchantOrderId}…`);
    try {
      await paymentApi.reconcile(payment.id);
      await load();
    } catch (error) {
      setMessage(error.response?.data?.error || 'Reconciliation failed.');
    }
  }

  return (
    <>
      <ResponsiveNavbar />
      <main className="min-h-screen bg-gradient-to-br from-black to-purple-950 p-6 text-white">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="text-4xl font-bold text-purple-300">Cashfree payments</h1>
            <select aria-label="Filter payment status" value={status} onChange={(event) => setStatus(event.target.value)}
              className="rounded-lg border border-purple-700 bg-black px-4 py-2">
              {statuses.map((value) => <option key={value} value={value}>{value || 'ALL STATUSES'}</option>)}
            </select>
          </div>
          {message && <p role="status" className="my-4 text-purple-200">{message}</p>}
          <div className="mt-6 overflow-x-auto rounded-xl border border-purple-800">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="bg-purple-950 text-purple-200"><tr>
                <th className="p-3">Order</th><th className="p-3">User</th><th className="p-3">Amount</th>
                <th className="p-3">Gateway / reference</th><th className="p-3">Status</th>
                <th className="p-3">Wallet credited</th><th className="p-3">Created</th><th className="p-3">Action</th>
              </tr></thead>
              <tbody>
                {payments.map((payment) => <tr key={payment.id} className="border-t border-purple-900 bg-black/60">
                  <td className="p-3">{payment.merchantOrderId}</td>
                  <td className="p-3">{payment.customerId || payment.userId}</td>
                  <td className="p-3">₹{(payment.amountMinor / 100).toLocaleString('en-IN')}</td>
                  <td className="p-3">{payment.gateway}<br />{payment.gatewayPaymentId || payment.gatewayOrderId || '—'}</td>
                  <td className="p-3">{payment.status}</td>
                  <td className="p-3">{payment.creditedAt ? new Date(payment.creditedAt).toLocaleString() : 'No'}</td>
                  <td className="p-3">{new Date(payment.createdAt).toLocaleString()}</td>
                  <td className="p-3"><button type="button" onClick={() => reconcile(payment)}
                    disabled={payment.status === 'SUCCESS'} className="rounded bg-purple-700 px-3 py-2 disabled:opacity-40">
                    Reconcile
                  </button></td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  );
}
