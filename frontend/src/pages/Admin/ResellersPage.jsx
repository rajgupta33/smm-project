import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { Users, Plus, RefreshCw, Link2, Percent } from 'lucide-react';
import ResponsiveNavbar from '../../components/NavBar';
import DataTable from '../../components/ui/DataTable';
import {
  Card, EmptyState, LoadingRows, Money, Notice, PageHeader, StatusBadge, Value,
} from '../../components/ui/Primitives';
import { resellerAdminApi } from '../../service/api';

/**
 * Admin screen for creating resellers and setting each one's commission.
 *
 * Commission is expressed to the admin as a percentage but sent and stored as
 * basis points, so 25% is exactly 2500 and no floating-point drift can creep
 * into a money calculation.
 */

const BLANK_FORM = {
  userId: '',
  password: '',
  displayName: '',
  contactPhone: '',
  contactEmail: '',
  commissionPercent: '25',
  holdDays: '7',
  dailyShareCap: '100',
  referralCode: '',
  marketingEnabled: true,
  notes: '',
};

function percentToBps(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return null;
  return Math.round(numeric * 100);
}

function errorMessage(error, fallback) {
  return error?.response?.data?.error || error?.message || fallback;
}

export default function ResellersPage() {
  const [resellers, setResellers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await resellerAdminApi.list({
        status: statusFilter || undefined,
        search: search || undefined,
        limit: 100,
      });
      setResellers(data.resellers || []);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not load resellers'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  const referralBase = useMemo(() => `${window.location.origin}/r/`, []);

  const handleCreate = async (event) => {
    event.preventDefault();
    const commissionBps = percentToBps(form.commissionPercent);
    if (commissionBps === null) {
      toast.error('Commission must be between 0 and 100 percent');
      return;
    }
    if (form.password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setSaving(true);
    try {
      const created = await resellerAdminApi.create({
        userId: form.userId.trim(),
        password: form.password,
        displayName: form.displayName.trim(),
        contactPhone: form.contactPhone.trim(),
        contactEmail: form.contactEmail.trim(),
        commissionBps,
        holdDays: Number(form.holdDays),
        dailyShareCap: Number(form.dailyShareCap),
        marketingEnabled: form.marketingEnabled,
        notes: form.notes.trim(),
        ...(form.referralCode.trim() ? { referralCode: form.referralCode.trim() } : {}),
      });
      toast.success(`Reseller created. Referral code: ${created.referralCode}`);
      setForm(BLANK_FORM);
      setShowForm(false);
      load();
    } catch (error) {
      toast.error(errorMessage(error, 'Could not create the reseller'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    const commissionBps = percentToBps(editing.commissionPercent);
    if (commissionBps === null) {
      toast.error('Commission must be between 0 and 100 percent');
      return;
    }
    setSaving(true);
    try {
      await resellerAdminApi.update(editing._id, {
        commissionBps,
        holdDays: Number(editing.holdDays),
        dailyShareCap: Number(editing.dailyShareCap),
        status: editing.status,
        marketingEnabled: editing.marketingEnabled,
      });
      toast.success('Reseller updated. New rates apply to future orders only.');
      setEditing(null);
      load();
    } catch (error) {
      toast.error(errorMessage(error, 'Could not update the reseller'));
    } finally {
      setSaving(false);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const counts = await resellerAdminApi.runCommissionScan();
      toast.success(`Commission scan done: ${counts.accrued} new, ${counts.paid} paid out.`);
      load();
    } catch (error) {
      toast.error(errorMessage(error, 'Commission scan failed'));
    } finally {
      setScanning(false);
    }
  };

  const copyReferral = async (code) => {
    try {
      await navigator.clipboard.writeText(`${referralBase}${code}`);
      toast.success('Referral link copied');
    } catch {
      toast.info(`${referralBase}${code}`);
    }
  };

  const columns = [
    {
      key: 'login',
      header: 'Reseller',
      primary: true,
      render: (row) => (
        <div>
          <p className="font-semibold text-ink">{row.displayName || row.login}</p>
          <p className="text-xs text-ink-muted">{row.login}</p>
        </div>
      ),
    },
    {
      key: 'referralCode',
      header: 'Referral code',
      render: (row) => (
        <button
          type="button"
          onClick={() => copyReferral(row.referralCode)}
          className="inline-flex items-center gap-1 font-mono text-xs text-brand hover:underline"
          title="Copy the referral link"
        >
          <Link2 className="h-3 w-3" aria-hidden="true" />
          {row.referralCode}
        </button>
      ),
    },
    {
      key: 'commission',
      header: 'Commission',
      render: (row) => (
        <span className="tnum font-semibold">{(row.commissionBps / 100).toFixed(2)}%</span>
      ),
    },
    { key: 'holdDays', header: 'Hold', render: (row) => `${row.holdDays}d`, mobileHidden: true },
    {
      key: 'earned',
      header: 'Paid out',
      render: (row) => <Money minor={row.totals?.paidMinor || 0} />,
    },
    {
      key: 'outstanding',
      header: 'Unpaid',
      render: (row) => (
        <Money minor={
          (row.outstanding?.pendingMinor || 0)
          + (row.outstanding?.heldMinor || 0)
          + (row.outstanding?.availableMinor || 0)
        }
        />
      ),
    },
    {
      key: 'customers',
      header: 'Customers',
      render: (row) => <Value>{row.totals?.referredCustomers || 0}</Value>,
      mobileHidden: true,
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <button
          type="button"
          className="btn btn-ghost text-xs"
          onClick={() => setEditing({
            _id: row._id,
            login: row.login,
            commissionPercent: String(row.commissionBps / 100),
            holdDays: String(row.holdDays),
            dailyShareCap: String(row.dailyShareCap),
            status: row.status,
            marketingEnabled: row.marketingEnabled,
          })}
        >
          Edit
        </button>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-surface-sunken text-ink">
      <ResponsiveNavbar />
      <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
        <PageHeader
          title="Resellers"
          subtitle="Create reseller logins and set each one's share of order profit."
          actions={(
            <>
              <button type="button" className="btn btn-ghost" onClick={handleScan} disabled={scanning}>
                <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} aria-hidden="true" />
                {scanning ? 'Scanning…' : 'Run commission scan'}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setShowForm((open) => !open)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New reseller
              </button>
            </>
          )}
        />

        <Notice tone="info">
          Commission is a share of each order&apos;s <strong>profit</strong>, not of the order value, so a
          reseller can never be paid more than the order earned. Changing a rate affects future orders
          only — commissions already in the ledger keep the rate they were accrued at.
        </Notice>

        {showForm && (
          <Card>
            <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-ink-muted">Login ID</span>
                <input
                  className="input mt-1 w-full"
                  value={form.userId}
                  onChange={(event) => setForm({ ...form, userId: event.target.value })}
                  required
                  autoComplete="off"
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-muted">Password (min 8 characters)</span>
                <input
                  className="input mt-1 w-full"
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-muted">Display name</span>
                <input
                  className="input mt-1 w-full"
                  value={form.displayName}
                  onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-muted">Referral code (blank = generated)</span>
                <input
                  className="input mt-1 w-full font-mono uppercase"
                  value={form.referralCode}
                  onChange={(event) => setForm({ ...form, referralCode: event.target.value.toUpperCase() })}
                  maxLength={24}
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-muted">Commission (% of order profit)</span>
                <input
                  className="input mt-1 w-full"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.commissionPercent}
                  onChange={(event) => setForm({ ...form, commissionPercent: event.target.value })}
                  required
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-muted">Hold period (days before wallet credit)</span>
                <input
                  className="input mt-1 w-full"
                  type="number"
                  min="0"
                  max="365"
                  value={form.holdDays}
                  onChange={(event) => setForm({ ...form, holdDays: event.target.value })}
                  required
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-muted">WhatsApp numbers per day</span>
                <input
                  className="input mt-1 w-full"
                  type="number"
                  min="0"
                  max="5000"
                  value={form.dailyShareCap}
                  onChange={(event) => setForm({ ...form, dailyShareCap: event.target.value })}
                  required
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-muted">Phone</span>
                <input
                  className="input mt-1 w-full"
                  value={form.contactPhone}
                  onChange={(event) => setForm({ ...form, contactPhone: event.target.value })}
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="text-ink-muted">Email</span>
                <input
                  className="input mt-1 w-full"
                  type="email"
                  value={form.contactEmail}
                  onChange={(event) => setForm({ ...form, contactEmail: event.target.value })}
                />
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.marketingEnabled}
                  onChange={(event) => setForm({ ...form, marketingEnabled: event.target.checked })}
                />
                <span>Enable the WhatsApp marketing section for this reseller</span>
              </label>
              <div className="flex gap-2 sm:col-span-2">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Creating…' : 'Create reseller'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </Card>
        )}

        {editing && (
          <Card>
            <h2 className="mb-4 text-lg font-semibold">
              Edit {editing.login}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-ink-muted">Commission (% of order profit)</span>
                <input
                  className="input mt-1 w-full"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={editing.commissionPercent}
                  onChange={(event) => setEditing({ ...editing, commissionPercent: event.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-muted">Hold period (days)</span>
                <input
                  className="input mt-1 w-full"
                  type="number"
                  min="0"
                  max="365"
                  value={editing.holdDays}
                  onChange={(event) => setEditing({ ...editing, holdDays: event.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-muted">WhatsApp numbers per day</span>
                <input
                  className="input mt-1 w-full"
                  type="number"
                  min="0"
                  max="5000"
                  value={editing.dailyShareCap}
                  onChange={(event) => setEditing({ ...editing, dailyShareCap: event.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-muted">Status</span>
                <select
                  className="input mt-1 w-full"
                  value={editing.status}
                  onChange={(event) => setEditing({ ...editing, status: event.target.value })}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="PAUSED">Paused (no new commission)</option>
                  <option value="DISABLED">Disabled (no access)</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={editing.marketingEnabled}
                  onChange={(event) => setEditing({ ...editing, marketingEnabled: event.target.checked })}
                />
                <span>WhatsApp marketing enabled</span>
              </label>
              <div className="flex gap-2 sm:col-span-2">
                <button type="button" className="btn btn-primary" onClick={handleSaveEdit} disabled={saving}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </Card>
        )}

        <Card padded={false}>
          <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
            <label className="text-sm text-ink-muted" htmlFor="reseller-status">Status</label>
            <select
              id="reseller-status"
              className="input"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
              <option value="DISABLED">Disabled</option>
            </select>
            <input
              className="input flex-1 min-w-[12rem]"
              placeholder="Search code, name or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="p-4">
            {loading ? (
              <LoadingRows rows={3} />
            ) : (
              <DataTable
                columns={columns}
                rows={resellers}
                rowKey={(row) => row._id}
                caption="Resellers and their commission rates"
                empty={(
                  <EmptyState
                    icon={Users}
                    title="No resellers yet"
                    description="Create one to start paying commission on the profit their orders generate."
                    action={(
                      <button type="button" className="btn btn-primary" onClick={() => setShowForm(true)}>
                        <Percent className="h-4 w-4" aria-hidden="true" />
                        New reseller
                      </button>
                    )}
                  />
                )}
              />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
