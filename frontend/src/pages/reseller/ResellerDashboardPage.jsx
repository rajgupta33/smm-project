import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Copy, IndianRupee, Users, Clock, MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import ResponsiveNavbar from '../../components/NavBar';
import DataTable from '../../components/ui/DataTable';
import {
  Card, EmptyState, LoadingRows, Money, Notice, PageHeader, StatusBadge,
} from '../../components/ui/Primitives';
import { resellerApi } from '../../service/api';

/**
 * What a reseller earns and where it came from.
 *
 * Commission states, in the order a reseller sees them:
 *   Pending   the order is still running
 *   Held      the order completed; waiting out the safety period
 *   Paid      credited to the panel wallet
 *   Reversed  the order was refunded, so the commission was taken back
 */

const STATE_COPY = {
  PENDING: 'Order still running',
  HELD: 'Completed, clearing',
  AVAILABLE: 'Clearing now',
  PAID: 'In your wallet',
  REVERSED: 'Order refunded',
};

function StatTile({ icon: Icon, label, children, hint }) {
  return (
    <Card className="flex items-start gap-3">
      <span className="rounded-xl bg-surface-sunken p-2 text-brand">
        {Icon && <Icon className="h-5 w-5" aria-hidden="true" />}
      </span>
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-ink-muted">{label}</p>
        <p className="mt-1 text-xl font-semibold text-ink">{children}</p>
        {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
      </div>
    </Card>
  );
}

export default function ResellerDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await resellerApi.dashboard());
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not load your dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const referralLink = data?.reseller?.referralCode
    ? `${window.location.origin}/r/${data.reseller.referralCode}`
    : '';

  const copyReferral = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      toast.success('Referral link copied');
    } catch {
      toast.info(referralLink);
    }
  };

  const columns = [
    {
      key: 'orderReference',
      header: 'Order',
      primary: true,
      render: (row) => <span className="font-mono text-xs">{row.orderReference}</span>,
    },
    {
      key: 'attribution',
      header: 'Source',
      render: (row) => (row.attribution === 'OWN_ORDER' ? 'Your own order' : 'Referred customer'),
    },
    {
      key: 'orderProfitMinor',
      header: 'Order profit',
      mobileHidden: true,
      render: (row) => <Money minor={row.orderProfitMinor} />,
    },
    {
      key: 'commissionBps',
      header: 'Your share',
      mobileHidden: true,
      render: (row) => `${(row.commissionBps / 100).toFixed(2)}%`,
    },
    {
      key: 'commissionMinor',
      header: 'Commission',
      render: (row) => <Money minor={row.commissionMinor} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div>
          <StatusBadge status={row.status} />
          <p className="mt-1 text-xs text-ink-muted">{STATE_COPY[row.status]}</p>
        </div>
      ),
    },
    {
      key: 'availableAt',
      header: 'Clears on',
      mobileHidden: true,
      render: (row) => (row.availableAt
        ? new Date(row.availableAt).toLocaleDateString('en-IN')
        : '—'),
    },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-sunken text-ink">
        <ResponsiveNavbar />
        <div className="mx-auto max-w-5xl px-4 py-8"><LoadingRows rows={4} /></div>
      </div>
    );
  }

  const totals = data?.reseller?.totals || {};
  const recentOrders = data?.recentOrders || [];
  const hasZeroMarginOrders = recentOrders.some((order) => order.commissionStatus === 'ZERO_MARGIN');

  const orderColumns = [
    {
      key: 'orderReference',
      header: 'Order',
      primary: true,
      render: (row) => <span className="font-mono text-xs">{row.orderReference}</span>,
    },
    {
      key: 'attribution',
      header: 'Source',
      render: (row) => (row.attribution === 'OWN_ORDER' ? 'Your own order' : 'Referred customer'),
    },
    {
      key: 'service',
      header: 'Service',
      mobileHidden: true,
      render: (row) => <span className="font-mono text-xs">{row.service}</span>,
    },
    {
      key: 'sellingTotalMinor',
      header: 'Order total',
      render: (row) => (row.sellingTotalMinor != null ? <Money minor={row.sellingTotalMinor} /> : '—'),
    },
    {
      key: 'lastStatus',
      header: 'Order status',
      render: (row) => <StatusBadge status={row.lastStatus || row.lifecycleStatus} />,
    },
    {
      key: 'commission',
      header: 'Commission',
      render: (row) => {
        if (row.commissionStatus === 'ZERO_MARGIN') {
          return <span className="text-xs text-ink-muted">₹0.00 (0% margin)</span>;
        }
        if (row.commissionStatus === 'NOT_ELIGIBLE') {
          return <span className="text-xs text-ink-muted">Not eligible</span>;
        }
        if (row.commissionStatus === 'PENDING_SCAN') {
          return <span className="text-xs text-ink-muted">Calculating…</span>;
        }
        return (
          <div className="flex items-center gap-2">
            <Money minor={row.commissionMinor || 0} />
            <StatusBadge status={row.commissionStatus} />
          </div>
        );
      },
    },
  ];

  return (
    <div className="min-h-screen bg-surface-sunken text-ink">
      <ResponsiveNavbar />
      <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <PageHeader
          title="Reseller earnings"
          subtitle={`You earn ${(data?.reseller?.commissionPercent ?? 0).toFixed(2)}% of the profit on every order you or your referred customers place.`}
          actions={(
            <Link to="/reseller/marketing" className="btn btn-primary">
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              Start sending
            </Link>
          )}
        />

        {data?.reseller?.status === 'PAUSED' && (
          <Notice tone="warning">
            Your account is paused, so new orders will not earn commission. Anything already in the
            ledger is safe and will still be paid.
          </Notice>
        )}

        {!(data?.commissions?.length) && hasZeroMarginOrders && (
          <Notice tone="info">
            Commission is a share of each order&apos;s profit margin (selling price minus provider cost).
            Your recent order(s) earned ₹0.00 because those services currently have 0% markup configured.
          </Notice>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={IndianRupee} label="Paid to your wallet">
            <Money minor={totals.paidMinor || 0} />
          </StatTile>
          <StatTile
            icon={Clock}
            label="Clearing"
            hint={`Released ${data?.reseller?.holdDays ?? 7} days after an order completes`}
          >
            <Money minor={(totals.heldMinor || 0) + (totals.availableMinor || 0)} />
          </StatTile>
          <StatTile icon={Clock} label="Pending" hint="Orders still running">
            <Money minor={totals.pendingMinor || 0} />
          </StatTile>
          <StatTile icon={Users} label="Referred customers">
            {data?.referredCustomers ?? 0}
          </StatTile>
        </div>

        <Card>
          <p className="text-xs uppercase tracking-wide text-ink-muted">Your referral link</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="flex-1 min-w-[14rem] break-all rounded-lg bg-surface-sunken px-3 py-2 text-sm">
              {referralLink || '—'}
            </code>
            <button type="button" className="btn btn-secondary" onClick={copyReferral} disabled={!referralLink}>
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Anyone the admin signs up against this code counts as your customer, and every order they
            place earns you commission.
          </p>
        </Card>

        <Card padded={false}>
          <h2 className="border-b border-line p-4 text-lg font-semibold">Commission ledger</h2>
          <div className="p-4">
            <DataTable
              columns={columns}
              rows={data?.commissions || []}
              rowKey={(row) => row._id}
              caption="Your commission entries"
              empty={(
                <EmptyState
                  icon={IndianRupee}
                  title="No commission yet"
                  description="Place an order, or bring in a customer, and it will appear here."
                />
              )}
            />
          </div>
        </Card>

        {recentOrders.length > 0 && (
          <Card padded={false}>
            <h2 className="border-b border-line p-4 text-lg font-semibold">Recent attributed orders</h2>
            <div className="p-4">
              <DataTable
                columns={orderColumns}
                rows={recentOrders}
                rowKey={(row) => row.orderReference}
                caption="Recent orders placed by you or your referred customers"
              />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
