import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  MessageCircle, Plus, RefreshCw, FileSpreadsheet, Settings2, Pencil, Eye, CheckCircle2,
} from 'lucide-react';
import ResponsiveNavbar from '../../components/NavBar';
import DataTable from '../../components/ui/DataTable';
import {
  Card, EmptyState, LoadingRows, Notice, PageHeader, StatusBadge, Value,
} from '../../components/ui/Primitives';
import { promoCampaignApi, resellerAdminApi } from '../../service/api';

/**
 * Admin screen for the WhatsApp promo sheets and Google Apps Script bridge.
 *
 * The Google Sheet and Apps Script credentials live here and on the backend
 * only: resellers never see the sheet URL, tab name, or secret key.
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
  dailyShareCapOverride: '',
};

function errorMessage(error, fallback) {
  return error?.response?.data?.error || error?.message || fallback;
}

export default function PromoCampaignsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [campaigns, setCampaigns] = useState([]);
  const [resellers, setResellers] = useState([]);
  const [sheetConfigured, setSheetConfigured] = useState(true);
  const [sheetSettings, setSheetSettings] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ appsScriptUrl: '', secretKey: '' });
  const [settingsFeedback, setSettingsFeedback] = useState(null);
  const [testingSettings, setTestingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(BLANK_FORM);
  const [tabs, setTabs] = useState([]);
  const [loadingTabs, setLoadingTabs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncingId, setSyncingId] = useState(null);

  const [detailCampaign, setDetailCampaign] = useState(null);
  const [detailLeads, setDetailLeads] = useState([]);
  const [detailStateFilter, setDetailStateFilter] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [campaignData, resellerData] = await Promise.all([
        promoCampaignApi.list({ limit: 100 }),
        resellerAdminApi.list({ status: 'ACTIVE', limit: 200 }),
      ]);
      setCampaigns(campaignData.campaigns || []);
      const configured = campaignData.sheetConfigured !== false;
      setSheetConfigured(configured);
      if (!configured) setShowSettings(true);
      if (campaignData.sheetSettings) {
        setSheetSettings(campaignData.sheetSettings);
        setSettingsForm((prev) => ({
          appsScriptUrl: campaignData.sheetSettings.appsScriptUrl || prev.appsScriptUrl || '',
          secretKey: '',
        }));
      }
      setResellers(resellerData.resellers || []);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not load campaigns'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const preselectResellerId = searchParams.get('resellerId');
    if (preselectResellerId) {
      setEditingId(null);
      setForm({
        ...BLANK_FORM,
        assignToAllResellers: false,
        assignedResellerIds: [preselectResellerId],
      });
      setShowForm(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleTestSettings = async () => {
    const url = settingsForm.appsScriptUrl.trim();
    if (!url) {
      const msg = 'Enter the Apps Script Web App URL first.';
      setSettingsFeedback({ tone: 'danger', message: msg });
      toast.error(msg);
      return;
    }
    setTestingSettings(true);
    setSettingsFeedback({ tone: 'info', message: 'Testing Apps Script connection…' });
    try {
      await promoCampaignApi.testSettings({
        appsScriptUrl: url,
        secretKey: settingsForm.secretKey.trim(),
      });
      setSettingsFeedback({ tone: 'success', message: 'Connected! Your Apps Script URL and secret key work.' });
      toast.success('Apps Script connection succeeded');
    } catch (error) {
      const msg = errorMessage(error, 'Connection test failed');
      setSettingsFeedback({ tone: 'danger', message: msg });
      toast.error(msg);
    } finally {
      setTestingSettings(false);
    }
  };

  const handleSaveSettings = async (event) => {
    event.preventDefault();
    setSavingSettings(true);
    setSettingsFeedback(null);
    try {
      const saved = await promoCampaignApi.updateSettings({
        appsScriptUrl: settingsForm.appsScriptUrl.trim(),
        secretKey: settingsForm.secretKey.trim(),
      });
      setSheetSettings(saved);
      setSheetConfigured(Boolean(saved.configured));
      setSettingsForm({ appsScriptUrl: saved.appsScriptUrl || '', secretKey: '' });
      setSettingsFeedback({ tone: 'success', message: 'Google Apps Script settings saved.' });
      toast.success('Google Apps Script settings saved');
      setShowSettings(false);
      load();
    } catch (error) {
      const msg = errorMessage(error, 'Could not save connection settings');
      setSettingsFeedback({ tone: 'danger', message: msg });
      toast.error(msg);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleLoadTabs = async () => {
    if (!form.sheetUrl.trim()) {
      toast.error('Paste the Google Sheet link first');
      return;
    }
    setLoadingTabs(true);
    try {
      const data = await promoCampaignApi.sheetTabs(form.sheetUrl.trim());
      setTabs(data.tabs || []);
      setForm((prev) => ({
        ...prev,
        tab: data.tabs?.length && !data.tabs.includes(prev.tab) ? data.tabs[0] : (prev.tab || data.tabs?.[0] || ''),
        name: prev.name.trim() ? prev.name : (data.title || prev.name),
      }));
      toast.success(`Read "${data.title}"`);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not read the sheet'));
    } finally {
      setLoadingTabs(false);
    }
  };

  const openNewForm = () => {
    setEditingId(null);
    setForm(BLANK_FORM);
    setTabs([]);
    setShowForm((open) => (editingId ? true : !open));
  };

  const handleEdit = async (campaignId) => {
    try {
      const detail = await promoCampaignApi.get(campaignId);
      const c = detail.campaign;
      setEditingId(c._id);
      setTabs(c.tab ? [c.tab] : []);
      setForm({
        name: c.name || '',
        description: c.description || '',
        sheetUrl: c.sheetUrl || '',
        tab: c.tab || '',
        columns: {
          name: c.columns?.name || 'A',
          number: c.columns?.number || 'B',
          link: c.columns?.link || 'C',
          status: c.columns?.status || 'D',
        },
        startRow: String(c.startRow ?? 2),
        endRow: c.endRow == null ? '' : String(c.endRow),
        messageTemplate: c.messageTemplate || '',
        defaultCountryCode: c.defaultCountryCode || '91',
        status: c.status || 'ACTIVE',
        assignToAllResellers: Boolean(c.assignToAllResellers),
        assignedResellerIds: (c.assignedResellerIds || []).map((r) => (typeof r === 'string' ? r : r._id)),
        claimExpiryMinutes: String(c.claimExpiryMinutes ?? 30),
        releaseAfterDays: String(c.releaseAfterDays ?? 30),
        maxContactsPerNumber: String(c.maxContactsPerNumber ?? 2),
        dailyShareCapOverride: c.dailyShareCapOverride == null ? '' : String(c.dailyShareCapOverride),
      });
      setShowForm(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      toast.error(errorMessage(error, 'Could not load campaign details'));
    }
  };

  const handleSaveCampaign = async (event) => {
    event.preventDefault();
    setSaving(true);
    const payload = {
      ...form,
      startRow: Number(form.startRow),
      endRow: form.endRow === '' ? null : Number(form.endRow),
      claimExpiryMinutes: Number(form.claimExpiryMinutes),
      releaseAfterDays: Number(form.releaseAfterDays),
      maxContactsPerNumber: Number(form.maxContactsPerNumber),
      dailyShareCapOverride: form.dailyShareCapOverride === '' ? null : Number(form.dailyShareCapOverride),
    };
    try {
      if (editingId) {
        await promoCampaignApi.update(editingId, payload);
        toast.success('Campaign updated. Syncing the sheet…');
        const updatedId = editingId;
        setEditingId(null);
        setForm(BLANK_FORM);
        setTabs([]);
        setShowForm(false);
        await handleSync(updatedId);
      } else {
        const { campaignId } = await promoCampaignApi.create(payload);
        toast.success('Campaign created. Syncing the sheet…');
        setForm(BLANK_FORM);
        setTabs([]);
        setShowForm(false);
        await handleSync(campaignId);
      }
      load();
    } catch (error) {
      toast.error(errorMessage(error, editingId ? 'Could not update the campaign' : 'Could not create the campaign'));
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
      if (detailCampaign?.campaign?._id === campaignId) {
        loadDetail(campaignId, detailStateFilter);
      }
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

  const loadDetail = async (campaignId, state = '') => {
    setLoadingDetail(true);
    try {
      const [detail, leadsData] = await Promise.all([
        promoCampaignApi.get(campaignId),
        promoCampaignApi.leads(campaignId, { state: state || undefined, limit: 100 }),
      ]);
      setDetailCampaign(detail);
      setDetailLeads(leadsData.leads || []);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not load campaign leads'));
    } finally {
      setLoadingDetail(false);
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
        : (row.assignedResellerIds?.length
          ? row.assignedResellerIds.map((r) => r.displayName || r.referralCode).join(', ')
          : 'No reseller selected')),
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
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className="btn btn-ghost btn-sm text-xs"
            onClick={() => handleSync(row._id)}
            disabled={syncingId === row._id}
          >
            <RefreshCw className={`h-3 w-3 ${syncingId === row._id ? 'animate-spin' : ''}`} aria-hidden="true" />
            Sync
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm text-xs"
            onClick={() => handleEdit(row._id)}
          >
            <Pencil className="h-3 w-3" aria-hidden="true" />
            Edit
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm text-xs"
            onClick={() => {
              setDetailStateFilter('');
              loadDetail(row._id, '');
            }}
          >
            <Eye className="h-3 w-3" aria-hidden="true" />
            Leads
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm text-xs"
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
          subtitle="Connect your Google Apps Script and assign Google Sheets to your resellers."
          actions={(
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowSettings((open) => !open)}
              >
                <Settings2 className="h-4 w-4" aria-hidden="true" />
                Sheet connection
                {sheetConfigured && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
              </button>
              <button type="button" className="btn btn-primary" onClick={openNewForm}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New campaign
              </button>
            </>
          )}
        />

        {!sheetConfigured && (
          <Notice tone="warning">
            Google Apps Script is not connected yet. Deploy <code>tools/promo-sheet/Code.gs</code> as a Web App
            (Execute as: <strong>Me</strong>, Who has access: <strong>Anyone</strong>) and save its URL &amp; secret key below.
          </Notice>
        )}

        {showSettings && (
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">Google Apps Script connection</h2>
                <p className="text-xs text-ink-muted">
                  One Apps Script deployment works for all Google Sheets your account can edit.
                  {sheetSettings?.source === 'panel' && ' Currently saved in panel settings.'}
                  {sheetSettings?.source === 'env' && ' Currently loaded from backend environment variables.'}
                </p>
              </div>
              <StatusBadge status={sheetConfigured ? 'CONNECTED' : 'NOT CONFIGURED'} />
            </div>

            <form onSubmit={handleSaveSettings} className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm sm:col-span-2">
                <span className="text-ink-muted">Apps Script Web App URL</span>
                <input
                  className="input mt-1 w-full"
                  type="url"
                  placeholder="https://script.google.com/macros/s/.../exec"
                  value={settingsForm.appsScriptUrl}
                  onChange={(event) => setSettingsForm({ ...settingsForm, appsScriptUrl: event.target.value })}
                  required
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="text-ink-muted">Secret key (SECRET_KEY in Code.gs)</span>
                <input
                  className="input mt-1 w-full"
                  type="password"
                  placeholder={sheetSettings?.hasSecretKey ? 'Leave blank to keep existing key' : 'Enter your secret key'}
                  value={settingsForm.secretKey}
                  onChange={(event) => setSettingsForm({ ...settingsForm, secretKey: event.target.value })}
                  autoComplete="off"
                />
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleTestSettings}
                  disabled={testingSettings || savingSettings}
                >
                  {testingSettings ? 'Testing…' : 'Test connection'}
                </button>
                <button type="submit" className="btn btn-primary" disabled={savingSettings}>
                  {savingSettings ? 'Saving…' : 'Save connection'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowSettings(false)}>
                  Close
                </button>
              </div>
              {settingsFeedback && (
                <div className="sm:col-span-2">
                  <Notice tone={settingsFeedback.tone}>{settingsFeedback.message}</Notice>
                </div>
              )}
            </form>
          </Card>
        )}

        <Notice tone="info">
          Send only to people who agreed to be contacted. WhatsApp bans numbers that message strangers in
          bulk, and unsolicited promotion breaches India&apos;s DPDP Act. The daily cap and the opt-out
          button exist to keep your senders safe — leave them on.
        </Notice>

        {showForm && (
          <Card>
            <h2 className="mb-4 text-lg font-semibold">
              {editingId ? 'Edit Google Sheet campaign' : 'Assign a Google Sheet campaign'}
            </h2>
            <form onSubmit={handleSaveCampaign} className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm sm:col-span-2">
                <span className="text-ink-muted">Google Sheet link</span>
                <div className="mt-1 flex gap-2">
                  <input
                    className="input flex-1"
                    type="url"
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    value={form.sheetUrl}
                    onChange={(event) => setForm({ ...form, sheetUrl: event.target.value })}
                    required={!editingId}
                  />
                  <button type="button" className="btn btn-secondary" onClick={handleLoadTabs} disabled={loadingTabs}>
                    <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                    {loadingTabs ? 'Reading…' : 'Load tabs'}
                  </button>
                </div>
              </label>
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
                <span className="text-ink-muted">Daily limit override (blank = reseller default)</span>
                <input
                  className="input mt-1 w-full"
                  type="number"
                  min="0"
                  max="5000"
                  value={form.dailyShareCapOverride}
                  onChange={(event) => setForm({ ...form, dailyShareCapOverride: event.target.value })}
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
              <label className="block text-sm">
                <span className="text-ink-muted">Status</span>
                <select
                  className="input mt-1 w-full"
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="PAUSED">Paused</option>
                  <option value="DRAFT">Draft</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.assignToAllResellers}
                  onChange={(event) => setForm({ ...form, assignToAllResellers: event.target.checked })}
                />
                <span>Give this Google Sheet campaign to every active reseller</span>
              </label>
              {!form.assignToAllResellers && (
                <div className="sm:col-span-2 space-y-2">
                  <span className="block text-sm text-ink-muted">Assigned resellers (pick one or more)</span>
                  <div className="grid max-h-44 gap-2 overflow-y-auto rounded-xl border border-line bg-surface-sunken p-3 sm:grid-cols-2">
                    {resellers.length === 0 ? (
                      <p className="text-xs text-ink-muted">No active resellers found.</p>
                    ) : resellers.map((reseller) => {
                      const checked = form.assignedResellerIds.includes(reseller._id);
                      return (
                        <label key={reseller._id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              const next = event.target.checked
                                ? [...form.assignedResellerIds, reseller._id]
                                : form.assignedResellerIds.filter((id) => id !== reseller._id);
                              setForm({ ...form, assignedResellerIds: next });
                            }}
                          />
                          <span className="truncate">
                            {reseller.displayName || reseller.login} ({reseller.referralCode})
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex gap-2 sm:col-span-2">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : (editingId ? 'Save & sync' : 'Create & sync')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowForm(false);
                    setEditingId(null);
                  }}
                >
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

        {detailCampaign && (
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">{detailCampaign.campaign?.name} — Leads &amp; Progress</h2>
                <p className="text-xs text-ink-muted">
                  Tab: {detailCampaign.campaign?.tab} · Available: {detailCampaign.byState?.AVAILABLE || 0} ·{' '}
                  Claimed: {detailCampaign.byState?.CLAIMED || 0} · Sent: {(detailCampaign.byState?.SENT || 0) + (detailCampaign.byState?.EXHAUSTED || 0)} ·{' '}
                  Opted out: {detailCampaign.byState?.OPTED_OUT || 0}
                </p>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDetailCampaign(null)}>
                Close
              </button>
            </div>

            {detailCampaign.byReseller?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {detailCampaign.byReseller.map((entry) => (
                  <span key={entry.resellerProfileId} className="badge-neutral">
                    {entry.displayName || entry.referralCode}: {entry.sent} sent
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <label htmlFor="lead-state-filter" className="text-sm text-ink-muted">Filter state</label>
              <select
                id="lead-state-filter"
                className="select w-48"
                value={detailStateFilter}
                onChange={(event) => {
                  const next = event.target.value;
                  setDetailStateFilter(next);
                  loadDetail(detailCampaign.campaign._id, next);
                }}
              >
                <option value="">All states</option>
                <option value="AVAILABLE">Available</option>
                <option value="CLAIMED">Claimed</option>
                <option value="SENT">Sent</option>
                <option value="EXHAUSTED">Exhausted</option>
                <option value="OPTED_OUT">Opted out</option>
              </select>
            </div>

            {loadingDetail ? (
              <LoadingRows rows={2} />
            ) : (
              <DataTable
                columns={[
                  { key: 'rowNumber', header: 'Row', primary: true, render: (r) => <span className="tnum">#{r.rowNumber}</span> },
                  { key: 'displayName', header: 'Name', render: (r) => <Value>{r.displayName}</Value> },
                  { key: 'normalizedPhone', header: 'Phone', render: (r) => <span className="font-mono text-xs">+{r.normalizedPhone}</span> },
                  { key: 'state', header: 'State', render: (r) => <StatusBadge status={r.state} /> },
                  {
                    key: 'sentBy',
                    header: 'Sent by',
                    mobileHidden: true,
                    render: (r) => <Value>{r.sentByProfileId?.displayName || r.sentByProfileId?.referralCode}</Value>,
                  },
                  { key: 'sheetStatus', header: 'Sheet status', mobileHidden: true, render: (r) => <Value>{r.sheetStatus}</Value> },
                ]}
                rows={detailLeads}
                rowKey={(r) => r._id}
                caption="Campaign sheet leads"
                empty={<p className="text-sm text-ink-muted">No leads match this filter.</p>}
              />
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
