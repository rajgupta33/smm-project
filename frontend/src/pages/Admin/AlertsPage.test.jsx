import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'react-toastify';
import AlertsPage from './AlertsPage';
import { alertApi, providerApi } from '../../service/api';

vi.mock('../../components/NavBar', () => ({ default: () => null }));
vi.mock('../../service/api', () => ({
  alertApi: { list: vi.fn(), acknowledge: vi.fn(), resolve: vi.fn() },
  providerApi: { checkBalances: vi.fn(), checkServiceAvailability: vi.fn(), reactivateCatalogueService: vi.fn() },
}));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const criticalAlert = {
  _id: 'alert-1',
  type: 'PROVIDER_LOW_BALANCE',
  severity: 'CRITICAL',
  status: 'OPEN',
  active: true,
  title: 'Main panel balance is critically low',
  message: 'Current balance is ₹300.00 INR.',
  occurrences: 3,
  firstSeenAt: '2026-09-14T08:00:00.000Z',
  lastSeenAt: '2026-09-14T09:00:00.000Z',
};

describe('AlertsPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    alertApi.list.mockResolvedValue([criticalAlert]);
    alertApi.acknowledge.mockResolvedValue({});
    alertApi.resolve.mockResolvedValue({});
  });

  it('acknowledges an open alert and reloads the list', async () => {
    render(<AlertsPage />);
    expect(await screen.findByText('Main panel balance is critically low')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

    await waitFor(() => expect(alertApi.acknowledge).toHaveBeenCalledWith('alert-1'));
    await waitFor(() => expect(alertApi.list).toHaveBeenCalledTimes(2));
  });

  it('shows an empty state and switches to resolved alerts', async () => {
    alertApi.list.mockResolvedValue([]);
    render(<AlertsPage />);
    expect(await screen.findByText('No active alerts')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Resolved' }));
    await waitFor(() => expect(alertApi.list).toHaveBeenLastCalledWith('resolved'));
    expect(await screen.findByText('No resolved alerts yet')).toBeInTheDocument();
  });

  it('runs a provider balance check on demand and reports the counts', async () => {
    providerApi.checkBalances.mockResolvedValue({
      counts: { scanned: 1, ok: 0, warning: 1, critical: 0, failed: 0 },
    });
    render(<AlertsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check provider balances' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Checked 1 provider: 0 critical, 1 low, 0 failed'));
  });

  it('runs a service availability check on demand and reports the counts', async () => {
    providerApi.checkServiceAvailability.mockResolvedValue({
      totals: { scanned: 2, checked: 2, anomalous: 0, failed: 0, removed: 1, offerRemoved: 0, reappeared: 0 },
    });
    render(<AlertsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check service availability' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Checked 2 providers: 1 hidden, 0 offer removed, 0 back, 0 skipped as abnormal'));
  });

  it('reactivates an auto-hidden service and resolves the alert', async () => {
    alertApi.list.mockResolvedValue([{
      ...criticalAlert, type: 'SERVICE_REMOVED', targetType: 'CatalogueService', targetId: 'catalogue-1',
      title: 'Instagram Followers was removed and hidden',
    }]);
    providerApi.reactivateCatalogueService.mockResolvedValue({});
    alertApi.resolve.mockResolvedValue({});

    render(<AlertsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reactivate service' }));

    await waitFor(() => expect(providerApi.reactivateCatalogueService).toHaveBeenCalledWith('catalogue-1'));
    await waitFor(() => expect(alertApi.resolve).toHaveBeenCalledWith('alert-1'));
    expect(toast.success).toHaveBeenCalledWith('Service reactivated and visible to customers again');
  });
});
