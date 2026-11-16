import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import {
  MessageCircle, Send, SkipForward, Ban, RefreshCw, ShieldAlert, Smartphone,
} from 'lucide-react';
import ResponsiveNavbar from '../../components/NavBar';
import {
  Card, EmptyState, LoadingRows, Notice, PageHeader,
} from '../../components/ui/Primitives';
import { resellerApi } from '../../service/api';
import {
  WA_OPEN_MODES,
  buildWhatsAppTargetUrl,
  defaultWhatsAppOpenMode,
  parseWhatsAppLink,
  saveWhatsAppOpenMode,
} from '../../service/whatsappLink';

/**
 * WhatsApp sending for resellers, integrating the WA Sender mobile workflow
 * (`whatsapp-mobile-sender-googel-sheet`) with the panel's atomic lead pool.
 *
 * One number at a time: preview the message, pick WhatsApp / WhatsApp Business /
 * Web link, tap Send, and confirm whether the message actually went out so the
 * backend marks the admin's Google Sheet row as Sent.
 */

function errorMessage(error, fallback) {
  return error?.response?.data?.error || error?.message || fallback;
}

export default function ResellerMarketingPage() {
  const [status, setStatus] = useState(null);
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [openMode, setOpenMode] = useState(defaultWhatsAppOpenMode);
  const openedRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await resellerApi.marketing();
      setStatus(data);
      setLead(data.activeLead || null);
      if (!data.activeLead) {
        setAwaitingConfirm(false);
        openedRef.current = false;
      }
    } catch (error) {
      toast.error(errorMessage(error, 'Could not load your campaigns'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && openedRef.current) {
        setAwaitingConfirm(true);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const handleOpenModeChange = (mode) => {
    setOpenMode(mode);
    saveWhatsAppOpenMode(mode);
  };

  const handleClaim = async (campaignId = null) => {
    setBusy(true);
    try {
      const next = await resellerApi.claimLead(campaignId);
      setLead(next);
      setAwaitingConfirm(false);
      openedRef.current = false;
      if (next.resumed) toast.info('You still have this number open.');
    } catch (error) {
      toast.error(errorMessage(error, 'No number available'));
    } finally {
      setBusy(false);
    }
  };

  const handleSend = () => {
    if (!lead) return;
    openedRef.current = true;
    setAwaitingConfirm(true);
    const targetUrl = buildWhatsAppTargetUrl(lead.sendLink, openMode);
    if (openMode === 'link') {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    } else {
      window.location.assign(targetUrl);
    }
  };

  const handleConfirmSent = async () => {
    if (!lead) return;
    setBusy(true);
    try {
      const result = await resellerApi.markSent(lead.leadId);
      if (result.sheetUpdated) {
        toast.success('Marked as sent in the Google Sheet.');
      } else {
        toast.warning('Marked as sent here. The Google Sheet will sync automatically shortly.');
      }
      setLead(null);
      setAwaitingConfirm(false);
      openedRef.current = false;
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error, 'Could not mark it sent'));
    } finally {
      setBusy(false);
    }
  };

  const handleCouldNotSend = async () => {
    if (!lead) return;
    setBusy(true);
    try {
      await resellerApi.releaseLead(lead.leadId, 'Reseller could not send');
      toast.info('Number returned to the pool. It does not count against your daily limit.');
      setLead(null);
      setAwaitingConfirm(false);
      openedRef.current = false;
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error, 'Could not release the number'));
    } finally {
      setBusy(false);
    }
  };

  const handleOptOut = async () => {
    if (!lead) return;
    setBusy(true);
    try {
      await resellerApi.optOutLead(lead.leadId);
      toast.success('Recorded. Nobody will contact this number again.');
      setLead(null);
      setAwaitingConfirm(false);
      openedRef.current = false;
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error, 'Could not record the opt-out'));
    } finally {
      setBusy(false);
    }
  };

  const parsedLead = useMemo(() => (lead ? parseWhatsAppLink(lead.sendLink) : null), [lead]);

  const activeCampaignSummary = useMemo(() => {
    if (!lead || !status?.campaigns?.length) return null;
    return status.campaigns.find((c) => c.campaignId === lead.campaignId) || null;
  }, [lead, status]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-sunken text-ink">
        <ResponsiveNavbar />
        <div className="mx-auto max-w-2xl px-4 py-8"><LoadingRows rows={3} /></div>
      </div>
    );
  }

  const totalRemaining = (status?.campaigns || []).reduce(
    (sum, campaign) => sum + Math.min(campaign.availableLeads, campaign.dailyRemaining), 0
  );

  return (
    <div className="min-h-screen bg-surface-sunken text-ink">
      <ResponsiveNavbar />
      <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
        <PageHeader
          title="WhatsApp marketing"
          subtitle="Send from the Google Sheet campaigns your admin assigned, one number at a time."
          actions={(
            <button type="button" className="btn btn-ghost" onClick={refresh} disabled={busy}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </button>
          )}
        />

        {!status?.marketingEnabled && (
          <Notice tone="warning">
            WhatsApp marketing is turned off for your account. Ask the admin to enable it.
          </Notice>
        )}

        {status?.marketingEnabled && !status?.configured && (
          <Notice tone="warning">
            The Google Sheet connection is not set up yet, so no numbers can be loaded. Please tell your admin.
          </Notice>
        )}

        {status?.marketingEnabled && status?.configured && !status?.campaigns?.length && (
          <EmptyState
            icon={MessageCircle}
            title="No campaign assigned yet"
            description="Your admin has not assigned a Google Sheet to you yet. Once they do, numbers appear here."
          />
        )}

        {status?.marketingEnabled && status?.configured && status?.campaigns?.length > 0 && (
          <Card className="flex flex-wrap items-center justify-between gap-3 py-3">
            <label htmlFor="wa-open-mode" className="flex items-center gap-2 text-sm font-medium text-ink">
              <Smartphone className="h-4 w-4 text-ink-muted" aria-hidden="true" />
              <span>Open messages with</span>
            </label>
            <select
              id="wa-open-mode"
              className="select w-full sm:w-64"
              value={openMode}
              onChange={(event) => handleOpenModeChange(event.target.value)}
            >
              {WA_OPEN_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>{mode.label}</option>
              ))}
            </select>
          </Card>
        )}

        {lead && (
          <Card className="space-y-4">
            {activeCampaignSummary && activeCampaignSummary.dailyCap > 0 && (
              <div className="space-y-1.5">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                    style={{
                      width: `${Math.min(100, (activeCampaignSummary.dailyUsed / activeCampaignSummary.dailyCap) * 100)}%`,
                    }}
                  />
                </div>
                <p className="tnum text-center text-xs text-ink-muted">
                  {activeCampaignSummary.dailyUsed} of {activeCampaignSummary.dailyCap} sent today ·{' '}
                  {activeCampaignSummary.availableLeads} left in campaign
                </p>
              </div>
            )}

            <div>
              <p className="text-xs uppercase tracking-wide text-ink-muted">{lead.campaignName}</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{lead.displayName || 'Unnamed contact'}</p>
              <p className="font-mono text-sm text-ink-muted">+{lead.phone}</p>
              {lead.contactCount > 0 && (
                <p className="mt-1 text-xs text-state-warning">
                  This number was contacted {lead.contactCount} time(s) before.
                </p>
              )}
            </div>

            <div className="rounded-xl rounded-bl-sm border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-950 whitespace-pre-wrap break-words max-h-60 overflow-y-auto dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100">
              {parsedLead?.text ? parsedLead.text : (
                <span className="italic opacity-75">(no pre-filled message text)</span>
              )}
            </div>

            {!awaitingConfirm ? (
              <button type="button" className="btn btn-primary btn-block" onClick={handleSend}>
                <Send className="h-4 w-4" aria-hidden="true" />
                Send message to {lead.displayName || `+${lead.phone}`}
              </button>
            ) : (
              <div className="space-y-2 rounded-xl border border-line bg-surface-sunken p-3">
                <p className="text-sm font-medium text-ink">Did the message go out in WhatsApp?</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-primary" onClick={handleConfirmSent} disabled={busy}>
                    Yes, mark sent
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={handleCouldNotSend} disabled={busy}>
                    No, put it back
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={handleSend} disabled={busy}>
                    Open WhatsApp again
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <button type="button" className="btn btn-ghost text-xs" onClick={handleCouldNotSend} disabled={busy}>
                <SkipForward className="h-3 w-3" aria-hidden="true" />
                Skip this one
              </button>
              <button type="button" className="btn btn-danger text-xs" onClick={handleOptOut} disabled={busy}>
                <Ban className="h-3 w-3" aria-hidden="true" />
                They asked not to be contacted
              </button>
            </div>
          </Card>
        )}

        {!lead && status?.marketingEnabled && status?.configured && status?.campaigns?.length > 0 && (
          <Card className="text-center">
            <p className="text-sm text-ink-muted">
              {totalRemaining > 0
                ? 'Ready when you are.'
                : 'Nothing left to send right now — either your daily limit is reached or the list is empty.'}
            </p>
            <button
              type="button"
              className="btn btn-primary btn-block mt-4"
              onClick={() => handleClaim()}
              disabled={busy || totalRemaining === 0}
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              {busy ? 'Getting the next number…' : 'Get next number'}
            </button>
          </Card>
        )}

        {status?.campaigns?.length > 0 && (
          <Card padded={false}>
            <h2 className="border-b border-line p-4 text-sm font-semibold uppercase tracking-wide text-ink-muted">
              Your campaigns today
            </h2>
            <ul className="divide-y divide-line">
              {status.campaigns.map((campaign) => {
                const pct = campaign.dailyCap > 0
                  ? Math.min(100, (campaign.dailyUsed / campaign.dailyCap) * 100)
                  : 0;
                return (
                  <li key={campaign.campaignId} className="space-y-2 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{campaign.name}</p>
                        {campaign.description && (
                          <p className="text-xs text-ink-muted">{campaign.description}</p>
                        )}
                        <p className="mt-1 text-xs text-ink-muted">
                          {campaign.availableLeads} numbers left · {campaign.sentByMe} sent by you
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="tnum text-sm font-semibold">
                          {campaign.dailyUsed} / {campaign.dailyCap}
                        </p>
                        <p className="text-xs text-ink-muted">sent today</p>
                        {!lead && campaign.dailyRemaining > 0 && campaign.availableLeads > 0 && (
                          <button
                            type="button"
                            className="btn btn-ghost mt-1 text-xs"
                            onClick={() => handleClaim(campaign.campaignId)}
                            disabled={busy}
                          >
                            Send from this
                          </button>
                        )}
                      </div>
                    </div>
                    {campaign.dailyCap > 0 && (
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <Notice tone="info">
          <span className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Only message people who agreed to hear from you, and always use the opt-out button when
              someone asks you to stop. WhatsApp bans numbers that bulk-message strangers, and your
              daily limit is there to protect your own number.
            </span>
          </span>
        </Notice>
      </div>
    </div>
  );
}
