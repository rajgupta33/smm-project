import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { MessageCircle, Plus, RefreshCw, FileSpreadsheet } from 'lucide-react';
import ResponsiveNavbar from '../../components/NavBar';
import DataTable from '../../components/ui/DataTable';
import {
  Card, EmptyState, LoadingRows, Notice, PageHeader, StatusBadge, Value,
} from '../../components/ui/Primitives';
import { promoCampaignApi, resellerAdminApi } from '../../service/api';

/**
 * Admin screen for the WhatsApp promo sheets.
 *
 * The Google Sheet is assigned here and only here: resellers never see the
 * link, the tab or the Apps Script key. Sync copies the rows into the lead pool
 * so a reseller's click can claim exactly one number.
 */

const BLANK_FORM = {
  name: '',
  description: '',
  sheetUrl: '',
  tab: '',
  columns: { name: 'A', number: 'B', link: 'C', status: 'D' },
  startRow: '2',
  endRow: '',
  messageTemplate: '',
  defaultCountryCode: '91',
  status: 'ACTIVE',
  assignToAllResellers: true,
  assignedResellerIds: [],
  claimExpiryMinutes: '30',
  releaseAfterDays: '30',
  maxContactsPerNumber: '2',
};

function errorMessage(error, fallback) {
  return error?.response?.data?.error || error?.message || fallback;
}

export default function PromoCampaignsPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [resellers, setResellers] = useState([]);
  const [sheetConfigured, setSheetConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);
  const [tabs, setTabs] = useState([]);
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [campaignData, resellerData] = await Promise.all([
        promoCampaignApi.list({ limit: 100 }),
        resellerAdminApi.list({ status: 'ACTIVE', limit: 200 }),
      ]);
      setCampaigns(campaignData.campaigns || []);
      setSheetConfigured(campaignData.sheetConfigured !== false);
      setResellers(resellerData.resellers || []);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not load campaigns'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleLoadTabs = async () => {
    if (!form.sheetUrl.trim()) {
      toast.error('Paste the Google Sheet link first');
      return;
    }
    setLoadingTabs(true);
    try {
      const data = await promoCampaignApi.sheetTabs(form.sheetUrl.trim());
      setTabs(data.tabs || []);
      if (data.tabs?.length && !form.tab) setForm((prev) => ({ ...prev, tab: data.tabs[0] }));
      toast.success(`Read "${data.title}"`);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not read the sheet'));
    } finally {
      setLoadingTabs(false);
    }
  };

  const handleCreate = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { campaignId } = await promoCampaignApi.create({
        ...form,
        startRow: Number(form.startRow),
        endRow: form.endRow === '' ? null : Number(form.endRow),
        claimExpiryMinutes: Number(form.claimExpiryMinutes),
        releaseAfterDays: Number(form.releaseAfterDays),
        maxContactsPerNumber: Number(form.maxContactsPerNumber),
      });
      toast.success('Campaign created. Syncing the sheet…');
      setForm(BLANK_FORM);
      setTabs([]);
      setShowForm(false);
      await handleSync(campaignId);
      load();
    } catch (error) {
      toast.error(errorMessage(error, 'Could not create the campaign'));
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async (campaignId) => {
    setSyncingId(campaignId);
    try {
      const result = await promoCampaignApi.sync(campaignId);
      toast.success(
        `Synced ${result.imported} rows. ${result.availableLeads} numbers ready`
        + (result.skippedDuplicates ? `, ${result.skippedDuplicates} duplicates skipped` : '')
        + (result.skippedInvalid ? `, ${result.skippedInvalid} unusable` : '')
        + '.'
      );
      load();
    } catch (error) {
      toast.error(errorMessage(error, 'Sync failed'));
    } finally {
      setSyncingId(null);
    }
  };

  const handleStatusChange = async (campaign, status) => {
    try {
      await promoCampaignApi.update(campaign._id, { status });
      toast.success(`Campaign ${status.toLowerCase()}`);
      load();
    } catch (error) {
      toast.error(errorMessage(error, 'Could not update the campaign'));
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Campaign',
      primary: true,
      render: (row) => (
        <div>
          <p className="font-semibold text-ink">{row.name}</p>
          <p className="text-xs text-ink-muted">Tab: {row.tab}</p>
        </div>
      ),
    },
    {
      key: 'leads',
      header: 'Numbers',
      render: (row) => (
        <span className="tnum">
          {row.stats?.availableLeads ?? 0} ready / {row.stats?.totalLeads ?? 0} total
        </span>
      ),
    },
    {
      key: 'sent',
      header: 'Sent',
      render: (row) => <Value>{row.stats?.sentLeads ?? 0}</Value>,
    },
    {
      key: 'assigned',
      header: 'Assigned to',
      mobileHidden: true,
      render: (row) => (row.assignToAllResellers
        ? 'All active resellers'
        : `${row.assignedResellerIds?.length || 0} reseller(s)`),
    },
    {
      key: 'synced',
      header: 'Last sync',
      mobileHidden: true,
      render: (row) => (
        <Value>
          {row.lastSyncedAt ? new Date(row.lastSyncedAt).toLocaleString('en-IN') : null}
        </Value>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-ghost text-xs"
            onClick={() => handleSync(row._id)}
            disabled={syncingId === row._id}
          >
            <RefreshCw className={`h-3 w-3 ${syncingId === row._id ? 'animate-spin' : ''}`} aria-hidden="true" />
            Sync
          </button>
          <button
            type="button"
            className="btn btn-ghost text-xs"
            onClick={() => handleStatusChange(row, row.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE')}
          >
            {row.status === 'ACTIVE' ? 'Pause' : 'Activate'}
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
          title="WhatsApp campaigns"
          subtitle="Assign the lead sheets your resellers send from."
          actions={(
            <button type="button" className="btn btn-primary" onClick={() => setShowForm((open) => !open)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New campaign
            </button>
          )}
        />

        {!sheetConfigured && (
          <Notice tone="warning">
            The Google Apps Script bridge is not configured, so campaigns cannot read or stamp a sheet.
            Deploy <code>tools/promo-sheet/Code.gs</code> as a web app and set
            <code> PROMO_SHEET_SCRIPT_URL</code> and <code>PROMO_SHEET_SECRET_KEY</code> in the backend
            environment.
          </Notice>
        )}

        <Notice tone="info">
          Send only to people who agreed to be contacted. WhatsApp bans numbers that message strangers in
          bulk, and unsolicited promotion breaches India&apos;s DPDP Act. The daily cap and the opt-out
          button exist to keep your senders safe — leave them on.
        </Notice>

        {showForm && (
          <Card>
            <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-ink-muted">Campaign name</span>
                <input
                  className="input mt-1 w-full"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  required
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-muted">Description (shown to resellers)</span>
                <input
                  className="input mt-1 w-full"
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="text-ink-muted">Google Sheet link</span>
                <div className="mt-1 flex gap-2">
                  <input
                    className="input flex-1"
                    type="url"
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    value={form.sheetUrl}
                    onChange={(event) => setForm({ ...form, sheetUrl: event.target.value })}
                    required
                  />
                  <button type="button" className="btn btn-secondary" onClick={handleLoadTabs} disabled={loadingTabs}>
                    <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                    {loadingTabs ? 'Reading…' : 'Load tabs'}
                  </button>
                </div>
              </label>
              <label className="block text-sm">
                <span className="text-ink-muted">Tab</span>
                {tabs.length ? (
                  <select
                    className="input mt-1 w-full"
                    value={form.tab}
                    onChange={(event) => setForm({ ...form, tab: event.target.value })}
                    required
                  >
                    {tabs.map((tab) => <option key={tab} value={tab}>{tab}</option>)}
                  </select>
                ) : (
                  <input
                    className="input mt-1 w-full"
                    value={form.tab}
                    onChange={(event) => setForm({ ...form, tab: event.target.value })}
                    placeholder="Sheet1"
                    required
                  />
                )}
              </label>
              <div className="grid grid-cols-4 gap-2 text-sm">
                {['name', 'number', 'link', 'status'].map((field) => (
                  <label key={field} className="block">
                    <span className="text-ink-muted capitalize">{field}</span>
                    <input
                      className="input mt-1 w-full uppercase"
                      maxLength={3}
                      value={form.columns[field]}
                      onChange={(event) => setForm({
                        ...form,
                        columns: { ...form.columns, [field]: event.target.value.toUpperCase() },
                      })}
                    />
                  </label>
                ))}
              </div>
              <label className="block text-sm">
                <span className="text-ink-muted">Start row</span>
                <input
                  className="input mt-1 w-full"
                  type="number"
                  min="1"
                  value={form.startRow}
                  onChange={(event) => setForm({ ...form, startRow: event.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-muted">End row (blank = to the end)</span>
                <input
                  className="input mt-1 w-full"
                  type="number"
                  min="1"
                  value={form.endRow}
                  onChange={(event) => setForm({ ...form, endRow: event.target.value })}
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="text-ink-muted">
                  Fallback message, used when a row has no ready-made link. {'{{name}}'} and {'{{number}}'} are filled in.
                </span>
                <textarea
                  className="input mt-1 w-full"
                  rows={3}
                  value={form.messageTemplate}
                  onChange={(event) => setForm({ ...form, messageTemplate: event.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-muted">Country code for bare numbers</span>
                <input
                  className="input mt-1 w-full"
                  value={form.defaultCountryCode}
                  onChange={(event) => setForm({ ...form, defaultCountryCode: event.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-muted">Hold a claimed number for (minutes)</span>
                <input
                  className="input mt-1 w-full"
                  type="number"
                  min="1"
                  max="1440"
                  value={form.claimExpiryMinutes}
                  onChange={(event) => setForm({ ...form, claimExpiryMinutes: event.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-muted">Retry an unconverted number after (days, 0 = never)</span>
                <input
                  className="input mt-1 w-full"
                  type="number"
                  min="0"
                  max="365"
                  value={form.releaseAfterDays}
                  onChange={(event) => setForm({ ...form, releaseAfterDays: event.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="text-ink-muted">Never contact one number more than</span>
                <input
                  className="input mt-1 w-full"
                  type="number"
                  min="1"
                  max="10"
                  value={form.maxContactsPerNumber}
                  onChange={(event) => setForm({ ...form, maxContactsPerNumber: event.target.value })}
                />
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.assignToAllResellers}
                  onChange={(event) => setForm({ ...form, assignToAllResellers: event.target.checked })}
                />
                <span>Give this campaign to every active reseller</span>
              </label>
              {!form.assignToAllResellers && (
                <label className="block text-sm sm:col-span-2">
                  <span className="text-ink-muted">Assigned resellers</span>
                  <select
                    multiple
                    className="input mt-1 h-32 w-full"
                    value={form.assignedResellerIds}
                    onChange={(event) => setForm({
                      ...form,
                      assignedResellerIds: [...event.target.selectedOptions].map((option) => option.value),
                    })}
                  >
                    {resellers.map((reseller) => (
                      <option key={reseller._id} value={reseller._id}>
                        {reseller.displayName || reseller.login} ({reseller.referralCode})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="flex gap-2 sm:col-span-2">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Creating…' : 'Create and sync'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </Card>
        )}

        <Card padded={false}>
          <div className="p-4">
            {loading ? (
              <LoadingRows rows={3} />
            ) : (
              <DataTable
                columns={columns}
                rows={campaigns}
                rowKey={(row) => row._id}
                caption="WhatsApp promo campaigns"
                empty={(
                  <EmptyState
                    icon={MessageCircle}
                    title="No campaigns yet"
                    description="Assign a Google Sheet of leads and your resellers can start sending."
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
