import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import {
  MessageCircle, Send, SkipForward, Ban, RefreshCw, ShieldAlert,
} from 'lucide-react';
import ResponsiveNavbar from '../../components/NavBar';
import {
  Card, EmptyState, LoadingRows, Notice, PageHeader,
} from '../../components/ui/Primitives';
import { resellerApi } from '../../service/api';

/**
 * WhatsApp sending for resellers, ported from the standalone WA Sender PWA.
 *
 * One number at a time: tap Send, WhatsApp opens with the message already
 * written, and on return the panel asks whether it actually went out. The panel
 * cannot observe WhatsApp, so the confirmation is explicit rather than assumed —
 * guessing wrong would either burn a lead or message someone twice.
 *
 * Which numbers exist, and what they say, is set by the admin. A reseller only
 * ever receives the next one in their queue.
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
  // True once the reseller has been sent off to WhatsApp for the current lead.
  const openedRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await resellerApi.marketing();
      setStatus(data);
      setLead(data.activeLead || null);
      if (data.activeLead) setAwaitingConfirm(false);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not load your campaigns'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Coming back from WhatsApp is the moment to ask whether the message went out.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && openedRef.current) {
        setAwaitingConfirm(true);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

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
    window.open(lead.sendLink, '_blank', 'noopener,noreferrer');
  };

  const handleConfirmSent = async () => {
    if (!lead) return;
    setBusy(true);
    try {
      const result = await resellerApi.markSent(lead.leadId);
      if (result.sheetUpdated) {
        toast.success('Marked as sent.');
      } else {
        toast.warning('Marked as sent here. The sheet will be updated automatically shortly.');
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
          subtitle="Send the campaign your admin set up, one number at a time."
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
            The sheet connection is not set up yet, so no numbers can be loaded. Please tell your admin.
          </Notice>
        )}

        {status?.marketingEnabled && status?.configured && !status?.campaigns?.length && (
          <EmptyState
            icon={MessageCircle}
            title="No campaign assigned yet"
            description="Your admin has not given you a lead list. Once they do, numbers appear here."
          />
        )}

        {lead && (
          <Card className="space-y-4">
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

            {!awaitingConfirm ? (
              <button type="button" className="btn btn-primary btn-block" onClick={handleSend}>
                <Send className="h-4 w-4" aria-hidden="true" />
                Send message to {lead.displayName || `+${lead.phone}`}
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium">Did the message go out?</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-primary" onClick={handleConfirmSent} disabled={busy}>
                    Yes, sent
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={handleCouldNotSend} disabled={busy}>
                    No, put it back
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={handleSend}>
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
              {status.campaigns.map((campaign) => (
                <li key={campaign.campaignId} className="flex flex-wrap items-center justify-between gap-3 p-4">
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
                </li>
              ))}
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
