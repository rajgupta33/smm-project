import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { Users, Plus, RefreshCw, Link2, Percent, FileSpreadsheet, Eye } from 'lucide-react';
import ResponsiveNavbar from '../../components/NavBar';
import DataTable from '../../components/ui/DataTable';
import {
  Card, EmptyState, LoadingRows, Money, Notice, PageHeader, StatusBadge, Value,
} from '../../components/ui/Primitives';
import { promoCampaignApi, resellerAdminApi } from '../../service/api';

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
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [assigningReseller, setAssigningReseller] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [customerToLink, setCustomerToLink] = useState('');
  const [linkingCustomer, setLinkingCustomer] = useState(false);
  const [updatingCampaignId, setUpdatingCampaignId] = useState(null);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [resellerData, campaignData] = await Promise.all([
        resellerAdminApi.list({
          status: statusFilter || undefined,
          search: search || undefined,
          limit: 100,
        }),
        promoCampaignApi.list({ limit: 100 }).catch(() => ({ campaigns: [] })),
      ]);
      setResellers(resellerData.resellers || []);
      setCampaigns(campaignData.campaigns || []);
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
      if (detailData?.reseller?._id) openResellerDetail(detailData.reseller._id);
    } catch (error) {
      toast.error(errorMessage(error, 'Commission scan failed'));
    } finally {
      setScanning(false);
    }
  };

  const openResellerDetail = async (profileId) => {
    setLoadingDetail(true);
    try {
      const data = await resellerAdminApi.get(profileId);
      setDetailData(data);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not load reseller details'));
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleLinkCustomer = async (event) => {
    event.preventDefault();
    if (!detailData?.reseller?.referralCode || !customerToLink.trim()) return;
    setLinkingCustomer(true);
    try {
      await resellerAdminApi.reassignCustomer({
        customerUserId: customerToLink.trim(),
        referralCode: detailData.reseller.referralCode,
      });
      toast.success(`Linked ${customerToLink.trim()} to ${detailData.reseller.referralCode}`);
      setCustomerToLink('');
      await openResellerDetail(detailData.reseller._id);
      load();
    } catch (error) {
      toast.error(errorMessage(error, 'Could not link customer'));
    } finally {
      setLinkingCustomer(false);
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

  const campaignsForReseller = (resellerId) => campaigns.filter(
    (c) => c.status === 'ACTIVE'
      && (c.assignToAllResellers || (c.assignedResellerIds || []).some((r) => (r._id || r) === resellerId))
  );

  const handleToggleCampaignForReseller = async (campaign, resellerId, shouldInclude) => {
    setUpdatingCampaignId(campaign._id);
    try {
      const currentIds = (campaign.assignedResellerIds || []).map((r) => (typeof r === 'string' ? r : r._id));
      const nextIds = shouldInclude
        ? [...new Set([...currentIds, resellerId])]
        : currentIds.filter((id) => id !== resellerId);
      await promoCampaignApi.update(campaign._id, {
        assignToAllResellers: false,
        assignedResellerIds: nextIds,
      });
      toast.success(`Updated sheet assignment for ${campaign.name}`);
      await load();
    } catch (error) {
      toast.error(errorMessage(error, 'Could not update sheet assignment'));
    } finally {
      setUpdatingCampaignId(null);
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
    {
      key: 'sheets',
      header: 'Google Sheets',
      mobileHidden: true,
      render: (row) => {
        const active = campaignsForReseller(row._id);
        return active.length
          ? <span className="text-xs text-ink">{active.length} active</span>
          : <span className="text-xs text-ink-faint">None</span>;
      },
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className="btn btn-ghost btn-sm text-xs"
            onClick={() => openResellerDetail(row._id)}
          >
            <Eye className="h-3 w-3" aria-hidden="true" />
            Details
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm text-xs"
            onClick={() => setAssigningReseller(row)}
          >
            <FileSpreadsheet className="h-3 w-3" aria-hidden="true" />
            Sheets
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm text-xs"
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
        </div>
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

        {assigningReseller && (
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">
                  Google Sheets for {assigningReseller.displayName || assigningReseller.login}
                </h2>
                <p className="text-xs text-ink-muted">
                  Toggle existing campaigns for this reseller or attach a new Google Sheet.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to={`/adminPromoCampaigns?resellerId=${encodeURIComponent(assigningReseller._id)}`}
                  className="btn btn-primary btn-sm"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  New Google Sheet for this reseller
                </Link>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAssigningReseller(null)}>
                  Close
                </button>
              </div>
            </div>

            {campaigns.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No Google Sheet campaigns created yet. Click &ldquo;New Google Sheet for this reseller&rdquo; to set one up.
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {campaigns.map((campaign) => {
                  const isAll = Boolean(campaign.assignToAllResellers);
                  const isExplicit = (campaign.assignedResellerIds || []).some(
                    (r) => (r._id || r) === assigningReseller._id
                  );
                  const assigned = isAll || isExplicit;
                  return (
                    <li key={campaign._id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{campaign.name}</p>
                        <p className="text-xs text-ink-muted">
                          Tab: {campaign.tab} · {campaign.stats?.availableLeads ?? 0} ready ·{' '}
                          {isAll ? 'Shared with all active resellers' : 'Specific resellers'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={campaign.status} />
                        {isAll ? (
                          <span className="text-xs text-ink-muted">Included (All)</span>
                        ) : (
                          <button
                            type="button"
                            className={`btn btn-sm ${assigned ? 'btn-secondary' : 'btn-primary'}`}
                            disabled={updatingCampaignId === campaign._id}
                            onClick={() => handleToggleCampaignForReseller(campaign, assigningReseller._id, !assigned)}
                          >
                            {assigned ? 'Remove' : 'Assign'}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}

        {(loadingDetail || detailData) && (
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">
                  {detailData?.reseller?.displayName || detailData?.reseller?.login || 'Reseller details'}
                </h2>
                {detailData?.reseller && (
                  <p className="text-xs text-ink-muted">
                    Code: <code>{detailData.reseller.referralCode}</code> ·{' '}
                    Rate: {(detailData.reseller.commissionBps / 100).toFixed(2)}% of order profit ·{' '}
                    Hold: {detailData.reseller.holdDays} day(s)
                  </p>
                )}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDetailData(null)}>
                Close
              </button>
            </div>

            {loadingDetail ? (
              <LoadingRows rows={2} />
            ) : detailData && (
              <>
                <form onSubmit={handleLinkCustomer} className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface-sunken p-3">
                  <label className="flex-1 min-w-[12rem] text-sm">
                    <span className="text-ink-muted">Link an existing customer login ID to this reseller</span>
                    <input
                      className="input mt-1 w-full"
                      placeholder="Customer userId"
                      value={customerToLink}
                      onChange={(event) => setCustomerToLink(event.target.value)}
                      required
                    />
                  </label>
                  <button type="submit" className="btn btn-primary" disabled={linkingCustomer}>
                    {linkingCustomer ? 'Linking…' : 'Link customer'}
                  </button>
                </form>

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-ink">
                    Referred customers ({detailData.referredCustomers?.length || 0})
                  </h3>
                  {detailData.referredCustomers?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {detailData.referredCustomers.map((c) => (
                        <span key={c._id} className="badge-neutral font-mono text-xs">{c.userId}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-ink-muted">No referred customers linked yet.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-ink">
                    Commission ledger ({detailData.commissionTotal || 0})
                  </h3>
                  <DataTable
                    columns={[
                      { key: 'orderReference', header: 'Order', primary: true, render: (r) => <span className="font-mono text-xs">{r.orderReference}</span> },
                      { key: 'attribution', header: 'Source', render: (r) => r.attribution },
                      { key: 'orderProfitMinor', header: 'Profit', render: (r) => <Money minor={r.orderProfitMinor} /> },
                      { key: 'commissionMinor', header: 'Commission', render: (r) => <Money minor={r.commissionMinor} /> },
                      { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                    ]}
                    rows={detailData.commissions || []}
                    rowKey={(r) => r._id}
                    caption="Reseller commissions"
                    empty={<p className="text-xs text-ink-muted">No commission entries yet. Commissions accrue only when orders have &gt;0% profit margin.</p>}
                  />
                </div>
              </>
            )}
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
