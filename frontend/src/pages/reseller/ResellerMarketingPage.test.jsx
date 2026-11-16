import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'react-toastify';
import ResellerMarketingPage from './ResellerMarketingPage';
import { resellerApi } from '../../service/api';
import { buildWhatsAppTargetUrl, parseWhatsAppLink } from '../../service/whatsappLink';

vi.mock('../../components/NavBar', () => ({ default: () => null }));
vi.mock('../../service/api', () => ({
  resellerApi: {
    marketing: vi.fn(),
    claimLead: vi.fn(),
    markSent: vi.fn(),
    releaseLead: vi.fn(),
    optOutLead: vi.fn(),
  },
}));
vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const sampleStatus = {
  marketingEnabled: true,
  configured: true,
  dailyShareCap: 100,
  campaigns: [
    {
      campaignId: 'camp-1',
      name: 'Diwali Leads',
      description: 'Warm leads',
      availableLeads: 12,
      sentByMe: 3,
      dailyUsed: 3,
      dailyCap: 100,
      dailyRemaining: 97,
    },
  ],
  activeLead: {
    leadId: 'lead-1',
    campaignId: 'camp-1',
    campaignName: 'Diwali Leads',
    displayName: 'Asha Sharma',
    phone: '919876543210',
    sendLink: 'https://api.whatsapp.com/send?phone=919876543210&text=Hello%20Asha%2C%20check%20our%20offer',
    contactCount: 0,
  },
};

describe('whatsappLink helpers', () => {
  it('parses phone and message text from WhatsApp links and builds mobile launch URLs', () => {
    const link = 'https://api.whatsapp.com/send?phone=919876543210&text=Hi%20there';
    expect(parseWhatsAppLink(link)).toEqual({ phone: '919876543210', text: 'Hi there' });
    expect(buildWhatsAppTargetUrl(link, 'app')).toBe('whatsapp://send?phone=919876543210&text=Hi%20there');
    expect(buildWhatsAppTargetUrl(link, 'business')).toBe(
      'intent://send?phone=919876543210&text=Hi%20there#Intent;scheme=whatsapp;package=com.whatsapp.w4b;end'
    );
    expect(buildWhatsAppTargetUrl(link, 'link')).toBe(link);
  });
});

describe('ResellerMarketingPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resellerApi.marketing.mockResolvedValue(sampleStatus);
    resellerApi.markSent.mockResolvedValue({ leadId: 'lead-1', sheetUpdated: true });
    vi.stubGlobal('open', vi.fn());
  });

  it('displays the parsed message preview bubble and confirms sent status', async () => {
    render(<ResellerMarketingPage />);

    expect(await screen.findByText('Asha Sharma')).toBeInTheDocument();
    expect(screen.getByText('Hello Asha, check our offer')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Open messages with/i), { target: { value: 'link' } });
    fireEvent.click(screen.getByRole('button', { name: /Send message to Asha Sharma/i }));

    expect(window.open).toHaveBeenCalledWith(sampleStatus.activeLead.sendLink, '_blank', 'noopener,noreferrer');
    expect(await screen.findByText(/Did the message go out in WhatsApp/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Yes, mark sent/i }));

    await waitFor(() => expect(resellerApi.markSent).toHaveBeenCalledWith('lead-1'));
    expect(toast.success).toHaveBeenCalledWith('Marked as sent in the Google Sheet.');
  });
});
