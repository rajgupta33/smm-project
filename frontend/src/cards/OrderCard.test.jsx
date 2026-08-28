import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OrderCard from './OrderCard';

vi.mock('../service/api', () => ({
  serviceApi: { requestRefill: vi.fn(), checkRefillStatus: vi.fn(), checkOrderStatus: vi.fn() },
}));
vi.mock('react-toastify', () => ({
  toast: { loading: vi.fn(), update: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

describe('OrderCard durable refill state', () => {
  afterEach(cleanup);

  it('does not offer another refill while an ambiguous request needs support', () => {
    render(
      <MemoryRouter>
        <OrderCard order={{
          orderId: 'ord_1', service: 'service-1', quantity: 1000, rate: 10,
          createdAt: '2026-08-01T00:00:00Z', lastStatus: 'Completed', start_count: '0',
          lifecycleStatus: 'SUBMITTED', refill: '',
          refillRequest: { id: 'refill-1', status: 'NEEDS_SUPPORT' },
        }} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/NEEDS_SUPPORT/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request Refill' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check Refill Status' })).toBeInTheDocument();
  });
});
