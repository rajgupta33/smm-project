import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReconciliationPage from './ReconciliationPage';
import { operationsApi } from '../../service/api';

vi.mock('../../components/NavBar', () => ({ default: () => null }));
vi.mock('../../service/api', () => ({
  operationsApi: {
    listReconciliationOrders: vi.fn(),
    resolveReconciliation: vi.fn(),
  },
}));
vi.mock('react-toastify', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const order = {
  _id: 'order-db-1', localOrderId: 'ord-1', service: 'Followers', quantity: 1000,
  providerServiceId: '77', providerId: { name: 'Provider A' },
  pricingSnapshot: { sellingTotalMinor: 2500 },
  reconciliationContext: { workflowKind: 'STANDARD', refundEligibleMinor: 2500 },
  reconciliationReason: 'Provider submission outcome is unknown (TIMEOUT)',
  reconciliationRequiredAt: '2026-08-29T00:00:00.000Z',
};

describe('ReconciliationPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    operationsApi.listReconciliationOrders.mockResolvedValue([order]);
    operationsApi.resolveReconciliation.mockResolvedValue({});
  });

  it('requires evidence and confirmation before recording verified acceptance', async () => {
    render(<ReconciliationPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Investigate' }));
    fireEvent.click(screen.getByRole('radio', { name: /Provider accepted/i }));
    fireEvent.change(screen.getByLabelText('Verified provider order ID'), { target: { value: 'provider-order-99' } });
    fireEvent.change(screen.getByLabelText('Evidence note'), { target: { value: 'Verified in provider history by target and quantity.' } });
    const apply = screen.getByRole('button', { name: 'Apply verified resolution' });
    expect(apply).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(apply);

    await waitFor(() => expect(operationsApi.resolveReconciliation).toHaveBeenCalledWith('order-db-1', {
      resolution: 'CONFIRMED_ACCEPTED',
      providerOrderId: 'provider-order-99',
      evidenceNote: 'Verified in provider history by target and quantity.',
      evidenceUrl: null,
    }));
  });

  it('submits confirmed non-acceptance without a provider order ID', async () => {
    render(<ReconciliationPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Investigate' }));
    fireEvent.click(screen.getByRole('radio', { name: /Provider did not accept/i }));
    fireEvent.change(screen.getByLabelText('Evidence note'), { target: { value: 'Provider history and support response confirm no order.' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply verified resolution' }));

    await waitFor(() => expect(operationsApi.resolveReconciliation).toHaveBeenCalledWith('order-db-1', {
      resolution: 'CONFIRMED_NOT_ACCEPTED',
      providerOrderId: null,
      evidenceNote: 'Provider history and support response confirm no order.',
      evidenceUrl: null,
    }));
  });
});
