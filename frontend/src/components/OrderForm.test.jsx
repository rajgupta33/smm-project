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
    quoteOrder: vi.fn(),
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

// The submit button stays disabled until the server has priced the order, so
// every interaction test must wait for the debounced quote to resolve first.
async function submitOnceQuoted() {
  const button = await screen.findByRole('button', { name: 'Submit Order' });
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
}

describe('OrderForm', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    serviceApi.getUserServices.mockResolvedValue({
      success: true,
      data: [{ serviceId: 'service-1', name: 'Followers', rate: 125, min: '1', max: '1000' }],
    });
    serviceApi.placeOrder.mockResolvedValue({ success: false, message: 'Provider unavailable' });
    serviceApi.quoteOrder.mockResolvedValue({
      success: true,
      data: {
        serviceId: 'service-1', quantity: 1, runs: 1, totalQuantity: 1,
        sellingRateMinor: 12500, pricingUnit: 1000, totalMinor: 13,
        currency: 'INR', pricedAt: '2026-08-30T00:00:00.000Z',
      },
    });
  });

  it('ignores a second click while the first submission is still in flight', async () => {
    // A request that never settles (a dropped connection, a slow cold start)
    // must not let a second click spawn its own toast -- otherwise the first
    // toast is orphaned forever even after the second attempt succeeds,
    // which looks exactly like a stuck submission despite a successful order.
    let resolveFirstCall;
    serviceApi.placeOrder.mockImplementation(
      () => new Promise((resolve) => { resolveFirstCall = resolve; })
    );
    render(<OrderForm />);
    await screen.findByRole('option', { name: /Followers/ });
    fireEvent.change(screen.getByLabelText('Link'), { target: { value: 'https://example.com/post' } });
    fireEvent.change(screen.getByLabelText('Select Product/Service'), { target: { value: 'service-1' } });

    const button = await screen.findByRole('button', { name: 'Submit Order' });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    fireEvent.click(button);

    resolveFirstCall({
      success: true,
      data: { orderId: 'ord_1', code: 'ORDER_QUEUED', queueDispatchPending: false },
    });
    await waitFor(() => expect(serviceApi.placeOrder).toHaveBeenCalledTimes(1));
  });

  it('displays the server quote rather than a locally computed total', async () => {
    // The catalogue rate (125) would give a different number if multiplied in the
    // browser. Only the server total may be shown, or the price a customer approves
    // can differ from the amount actually debited.
    serviceApi.quoteOrder.mockResolvedValue({
      success: true,
      data: {
        serviceId: 'service-1', quantity: 1, runs: 1, totalQuantity: 1,
        sellingRateMinor: 12500, pricingUnit: 1000, totalMinor: 4237,
        currency: 'INR', pricedAt: '2026-08-30T00:00:00.000Z',
      },
    });
    render(<OrderForm />);
    await screen.findByRole('option', { name: /Followers/ });
    fireEvent.change(screen.getByLabelText('Select Product/Service'), { target: { value: 'service-1' } });

    await waitFor(() => expect(screen.getByTestId('order-total')).toHaveTextContent('₹42.37'));
  });

  it('blocks submission and surfaces the reason when the server cannot price the order', async () => {
    serviceApi.quoteOrder.mockResolvedValue({
      success: false, message: 'Service is not available', code: 'SERVICE_UNAVAILABLE',
    });
    render(<OrderForm />);
    await screen.findByRole('option', { name: /Followers/ });
    fireEvent.change(screen.getByLabelText('Select Product/Service'), { target: { value: 'service-1' } });

    await screen.findByText('Service is not available');
    expect(screen.getByRole('button', { name: 'Submit Order' })).toBeDisabled();
    expect(serviceApi.placeOrder).not.toHaveBeenCalled();
  });

  it('keeps one idempotency key across a failed retry and closes the loading toast', async () => {
    render(<OrderForm />);
    await screen.findByRole('option', { name: /Followers/ });
    fireEvent.change(screen.getByLabelText('Link'), { target: { value: 'https://example.com/post' } });
    fireEvent.change(screen.getByLabelText('Select Product/Service'), { target: { value: 'service-1' } });

    await submitOnceQuoted();
    await waitFor(() => expect(serviceApi.placeOrder).toHaveBeenCalledTimes(1));
    await submitOnceQuoted();
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
    await submitOnceQuoted();

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
    await submitOnceQuoted();

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
    await submitOnceQuoted();

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
