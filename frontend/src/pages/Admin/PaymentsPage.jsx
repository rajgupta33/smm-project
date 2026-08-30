import { useCallback, useEffect, useState } from 'react';
import { ReceiptText } from 'lucide-react';
import ResponsiveNavbar from '../../components/NavBar';
import DataTable from '../../components/ui/DataTable';
import { EmptyState, Notice, StatusBadge } from '../../components/ui/Primitives';
import { paymentApi } from '../../service/api';

const statuses = ['', 'CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'REFUNDED', 'DISPUTED'];

const dateTime = (value) =>
  new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

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

  const columns = [
    {
      key: 'order',
      header: 'Order',
      primary: true,
      render: (row) => <span className="break-all font-mono text-xs">{row.merchantOrderId}</span>,
    },
    { key: 'user', header: 'User', render: (row) => row.customerId || row.userId },
    {
      key: 'amount',
      header: 'Amount',
      render: (row) => (
        <span className="tnum font-semibold text-ink">
          ₹{(row.amountMinor / 100).toLocaleString('en-IN')}
        </span>
      ),
    },
    {
      key: 'gateway',
      header: 'Gateway',
      render: (row) => (
        <span className="text-xs">
          {row.gateway}
          <br />
          <span className="font-mono text-ink-muted">
            {row.gatewayPaymentId || row.gatewayOrderId || '—'}
          </span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'credited',
      header: 'Wallet credited',
      render: (row) => (row.creditedAt ? dateTime(row.creditedAt) : <span className="text-ink-faint">No</span>),
    },
    { key: 'created', header: 'Created', render: (row) => dateTime(row.createdAt), mobileHidden: true },
  ];

  return (
    <div className="min-h-screen bg-surface-sunken">
      <ResponsiveNavbar />
      <main className="page">
        <header className="page-head">
          <div>
            <h1 className="page-title">Cashfree payments</h1>
            <p className="page-sub">Every top-up, and whether the wallet was credited.</p>
          </div>
          <div className="field">
            <label htmlFor="payment-status" className="sr-only">Filter payment status</label>
            <select
              id="payment-status"
              aria-label="Filter payment status"
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
          caption="Cashfree payments"
          columns={columns}
          rows={payments}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              icon={ReceiptText}
              title="No payments to show"
              description="Payments matching this filter will appear here."
            />
          }
          actions={(row) => (
            <button
              type="button"
              onClick={() => reconcile(row)}
              disabled={row.status === 'SUCCESS'}
              className="btn-secondary btn-sm"
            >
              Reconcile
            </button>
          )}
        />
      </main>
    </div>
  );
}
