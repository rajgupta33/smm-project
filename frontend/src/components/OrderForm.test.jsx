import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OrderForm from './OrderForm';
import { serviceApi } from '../service/api';
import { toast } from 'react-toastify';

vi.mock('../context/Authcontext', () => ({
  useAuth: () => ({ refreshAuth: vi.fn() }),
}));
vi.mock('../service/api', () => ({
  serviceApi: {
    getUserServices: vi.fn(),
    placeOrder: vi.fn(),
  },
}));
vi.mock('react-toastify', () => ({
  ToastContainer: () => null,
  toast: {
    loading: vi.fn(() => 'toast-1'),
    update: vi.fn(),
    error: vi.fn(),
  },
}));

describe('OrderForm', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    serviceApi.getUserServices.mockResolvedValue({
      success: true,
      data: [{ serviceId: 'service-1', name: 'Followers', rate: 125, min: '1', max: '1000' }],
    });
    serviceApi.placeOrder.mockResolvedValue({ success: false, message: 'Provider unavailable' });
  });

  it('keeps one idempotency key across a failed retry and closes the loading toast', async () => {
    render(<OrderForm />);
    await screen.findByRole('option', { name: /Followers/ });
    fireEvent.change(screen.getByLabelText('Link'), { target: { value: 'https://example.com/post' } });
    fireEvent.change(screen.getByLabelText('Select Product/Service'), { target: { value: 'service-1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Submit Order' }));
    await waitFor(() => expect(serviceApi.placeOrder).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Order' }));
    await waitFor(() => expect(serviceApi.placeOrder).toHaveBeenCalledTimes(2));

    expect(serviceApi.placeOrder.mock.calls[0][1]).toBe(serviceApi.placeOrder.mock.calls[1][1]);
    expect(toast.update).toHaveBeenCalledWith('toast-1', expect.objectContaining({
      type: 'error',
      isLoading: false,
    }));
  });

  it('shows durable queue acceptance instead of claiming provider submission completed', async () => {
    serviceApi.placeOrder.mockResolvedValue({
      success: true,
      data: { orderId: 'ord_1', code: 'ORDER_QUEUED', queueDispatchPending: false },
    });
    render(<OrderForm />);
    await screen.findByRole('option', { name: /Followers/ });
    fireEvent.change(screen.getByLabelText('Link'), { target: { value: 'https://example.com/post' } });
    fireEvent.change(screen.getByLabelText('Select Product/Service'), { target: { value: 'service-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Order' }));

    await waitFor(() => expect(toast.update).toHaveBeenCalledWith('toast-1', expect.objectContaining({
      render: 'Order recorded and queued for provider submission.',
      type: 'success',
      isLoading: false,
    })));
  });

  it('shows manual fulfilment acceptance without claiming provider submission', async () => {
    serviceApi.placeOrder.mockResolvedValue({
      success: true,
      data: { orderId: 'ord_manual', code: 'MANUAL_ORDER_ACCEPTED' },
    });
    render(<OrderForm />);
    await screen.findByRole('option', { name: /Followers/ });
    fireEvent.change(screen.getByLabelText('Link'), { target: { value: 'https://example.com/post' } });
    fireEvent.change(screen.getByLabelText('Select Product/Service'), { target: { value: 'service-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Order' }));

    await waitFor(() => expect(toast.update).toHaveBeenCalledWith('toast-1', expect.objectContaining({
      render: 'Order recorded for manual fulfilment. Progress will appear in your order timeline.',
      type: 'success',
      isLoading: false,
    })));
  });

  it('submits drip-feed schedule fields and reports first-run queue acceptance', async () => {
    serviceApi.placeOrder.mockResolvedValue({
      success: true,
      data: { orderId: 'ord_drip', code: 'DRIP_FEED_ORDER_ACCEPTED', queueDispatchPending: false },
    });
    render(<OrderForm />);
    await screen.findByRole('option', { name: /Followers/ });
    fireEvent.change(screen.getByLabelText('Link'), { target: { value: 'https://example.com/post' } });
    fireEvent.change(screen.getByLabelText('Select Product/Service'), { target: { value: 'service-1' } });
    fireEvent.change(screen.getByLabelText('Quantity per run'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Runs'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Interval (minutes)'), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Order' }));

    await waitFor(() => expect(serviceApi.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 100, runs: 3, interval: 45 }),
      expect.any(String),
    ));
    expect(toast.update).toHaveBeenCalledWith('toast-1', expect.objectContaining({
      render: 'Drip-feed order recorded and the first run is queued.',
      type: 'success',
      isLoading: false,
    }));
  });
});
