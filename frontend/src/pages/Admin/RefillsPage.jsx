import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import ResponsiveNavbar from '../../components/NavBar';
import DataTable from '../../components/ui/DataTable';
import { EmptyState, Notice, StatusBadge, Value } from '../../components/ui/Primitives';
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
    try {
      setRefills(await refillApi.listAdmin(status));
      setMessage('');
    } catch (error) {
      setMessage(error.response?.data?.error || 'Could not load refills.');
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  async function poll(refill) {
    setMessage(`Checking ${refill.id}…`);
    try {
      await refillApi.pollAdmin(refill.id);
      await load();
    } catch (error) {
      setMessage(error.response?.data?.error || 'Status check failed.');
    }
  }

  const columns = [
    {
      key: 'request',
      header: 'Request',
      primary: true,
      render: (row) => <span className="break-all font-mono text-xs">{row.id}</span>,
    },
    {
      key: 'order',
      header: 'Order',
      render: (row) => <span className="font-mono text-xs">{row.publicOrderId || row.orderId}</span>,
    },
    { key: 'customer', header: 'Customer', render: (row) => row.customerId || row.userId },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'providerRefill',
      header: 'Provider refill',
      render: (row) => <Value mono>{row.providerRefillId}</Value>,
    },
    {
      key: 'requested',
      header: 'Requested',
      render: (row) =>
        new Date(row.requestedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
      mobileHidden: true,
    },
    { key: 'failure', header: 'Failure', render: (row) => <Value>{row.failureReason}</Value> },
  ];

  return (
    <div className="min-h-screen bg-surface-sunken">
      <ResponsiveNavbar />
      <main className="page">
        <header className="page-head">
          <div>
            <h1 className="page-title">Refill requests</h1>
            <p className="page-sub">Track guarantee claims and poll the provider for status.</p>
          </div>
          <div className="field">
            <label htmlFor="refill-status" className="sr-only">Filter refill status</label>
            <select
              id="refill-status"
              aria-label="Filter refill status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="select"
            >
              {statuses.map((value) => (
                <option key={value} value={value}>{value || 'All statuses'}</option>
              ))}
            </select>
          </div>
        </header>

        {message && <div className="mb-4"><Notice tone="info">{message}</Notice></div>}

        <DataTable
          caption="Refill requests"
          columns={columns}
          rows={refills}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              icon={RotateCcw}
              title="No refill requests"
              description="Refill claims matching this filter will appear here."
            />
          }
          actions={(row) => (
            <button
              type="button"
              onClick={() => poll(row)}
              disabled={!['SENT_TO_PROVIDER', 'IN_PROGRESS'].includes(row.status)}
              className="btn-secondary btn-sm"
            >
              Check status
            </button>
          )}
        />
      </main>
    </div>
  );
}
