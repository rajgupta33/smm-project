import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProviderRoutingPage from './ProviderRoutingPage';
import { providerApi } from '../../service/api';

vi.mock('../../components/NavBar', () => ({ default: () => null }));
vi.mock('../../service/api', () => ({
  providerApi: {
    listProviders: vi.fn(), listCatalogue: vi.fn(), listOffers: vi.fn(),
    listSyncRuns: vi.fn(), getSyncRun: vi.fn(), applySyncRun: vi.fn(),
    createProvider: vi.fn(), updateRouting: vi.fn(), queueSyncReport: vi.fn(),
  },
}));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('ProviderRoutingPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    providerApi.listProviders.mockResolvedValue([
      { _id: 'provider-1', code: 'primary', name: 'Primary', enabled: true, healthStatus: 'HEALTHY' },
      { _id: 'provider-2', code: 'fallback', name: 'Fallback', enabled: true, healthStatus: 'HEALTHY' },
    ]);
    providerApi.listCatalogue.mockResolvedValue([
      { _id: 'catalogue-1', displayName: 'Followers', fulfilmentType: 'PROVIDER', min: 100, max: 1000, pricingUnit: 1000 },
    ]);
    providerApi.listOffers.mockResolvedValue([
      { providerId: 'provider-1', catalogueServiceId: 'catalogue-1', availability: 'AVAILABLE', min: 100, max: 1000, pricingUnit: 1000 },
      { providerId: 'provider-2', catalogueServiceId: 'catalogue-1', availability: 'AVAILABLE', min: 100, max: 1000, pricingUnit: 1000 },
    ]);
    providerApi.listSyncRuns.mockResolvedValue([]);
    providerApi.updateRouting.mockResolvedValue({});
  });

  it('saves an explicit primary and fallback provider instead of an automatic strategy', async () => {
    render(<ProviderRoutingPage />);
    const primary = await screen.findByLabelText('Primary provider for Followers');
    const fallback = screen.getByLabelText('Fallback provider for Followers');
    fireEvent.change(primary, { target: { value: 'provider-1' } });
    fireEvent.change(fallback, { target: { value: 'provider-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(providerApi.updateRouting).toHaveBeenCalledWith('catalogue-1', {
      routingStrategy: 'MANUAL_PRIORITY',
      primaryProviderId: 'provider-1',
      fallbackProviderId: 'provider-2',
    }));
  });

  it('requires review confirmation and applies server report data with only catalogue mappings', async () => {
    providerApi.listSyncRuns.mockResolvedValue([{
      _id: 'run-1', providerId: 'provider-1', status: 'COMPLETED', applicationStatus: 'PENDING',
      completedAt: '2026-08-29T00:00:00.000Z', counts: { new: 1, changed: 0, missing: 0 },
    }]);
    providerApi.getSyncRun.mockResolvedValue({
      _id: 'run-1', providerId: 'provider-1', status: 'COMPLETED', applicationStatus: 'PENDING',
      report: {
        generatedAt: '2026-08-29T00:00:00.000Z', changed: [], missing: [], invalid: [],
        new: [{ providerServiceId: '77', providerNameSnapshot: 'New followers', costRateMinor: 250, pricingUnit: 1000, min: 100, max: 1000 }],
      },
    });
    providerApi.applySyncRun.mockResolvedValue({});

    render(<ProviderRoutingPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review report' }));
    const mapping = await screen.findByLabelText('Catalogue mapping for New followers');
    fireEvent.change(mapping, { target: { value: 'catalogue-1' } });
    const applyButton = screen.getByRole('button', { name: 'Apply reviewed report' });
    expect(applyButton).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(applyButton);

    await waitFor(() => expect(providerApi.applySyncRun).toHaveBeenCalledWith('run-1', [{
      providerServiceId: '77', catalogueServiceId: 'catalogue-1',
    }]));
  });
});
