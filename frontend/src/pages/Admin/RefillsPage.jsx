import { useCallback, useEffect, useState } from 'react';
import ResponsiveNavbar from '../../components/NavBar';
import { refillApi } from '../../service/api';

const statuses = [
  '', 'REQUESTED', 'VALIDATING', 'SENT_TO_PROVIDER', 'IN_PROGRESS',
  'COMPLETED', 'REJECTED', 'FAILED', 'EXPIRED', 'NEEDS_SUPPORT',
];

export default function RefillsPage() {
  const [status, setStatus] = useState('');
  const [refills, setRefills] = useState([]);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try { setRefills(await refillApi.listAdmin(status)); setMessage(''); }
    catch (error) { setMessage(error.response?.data?.error || 'Could not load refills.'); }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  async function poll(refill) {
    setMessage(`Checking ${refill.id}…`);
    try { await refillApi.pollAdmin(refill.id); await load(); }
    catch (error) { setMessage(error.response?.data?.error || 'Status check failed.'); }
  }

  return <>
    <ResponsiveNavbar />
    <main className="min-h-screen bg-gradient-to-br from-black to-purple-950 p-6 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-4xl font-bold text-purple-300">Refill requests</h1>
          <select aria-label="Filter refill status" value={status} onChange={(event) => setStatus(event.target.value)}
            className="rounded-lg border border-purple-700 bg-black px-4 py-2">
            {statuses.map((value) => <option key={value} value={value}>{value || 'ALL STATUSES'}</option>)}
          </select>
        </div>
        {message && <p role="status" className="my-4 text-purple-200">{message}</p>}
        <div className="mt-6 overflow-x-auto rounded-xl border border-purple-800">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="bg-purple-950 text-purple-200"><tr>
              <th className="p-3">Request</th><th className="p-3">Order</th><th className="p-3">Customer</th>
              <th className="p-3">Status</th><th className="p-3">Provider refill</th>
              <th className="p-3">Requested</th><th className="p-3">Failure</th><th className="p-3">Action</th>
            </tr></thead>
            <tbody>{refills.map((refill) => <tr key={refill.id} className="border-t border-purple-900 bg-black/60">
              <td className="p-3">{refill.id}</td><td className="p-3">{refill.publicOrderId || refill.orderId}</td>
              <td className="p-3">{refill.customerId || refill.userId}</td><td className="p-3">{refill.status}</td>
              <td className="p-3">{refill.providerRefillId || '—'}</td>
              <td className="p-3">{new Date(refill.requestedAt).toLocaleString()}</td>
              <td className="p-3">{refill.failureReason || '—'}</td>
              <td className="p-3"><button type="button" onClick={() => poll(refill)}
                disabled={!['SENT_TO_PROVIDER', 'IN_PROGRESS'].includes(refill.status)}
                className="rounded bg-purple-700 px-3 py-2 disabled:opacity-40">Check status</button></td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>
    </main>
  </>;
}
