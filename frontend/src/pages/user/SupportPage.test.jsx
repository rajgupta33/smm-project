import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SupportPage from './SupportPage';
import { ticketApi } from '../../service/api';

vi.mock('../../components/NavBar', () => ({ default: () => null }));
vi.mock('../../service/api', () => ({
  ticketApi: {
    listMine: vi.fn(), getMine: vi.fn(), create: vi.fn(), reply: vi.fn(),
  },
}));

describe('SupportPage ticket safety', () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    ticketApi.listMine.mockResolvedValue([]);
    ticketApi.create.mockRejectedValue(new Error('network unavailable'));
  });

  it('keeps the same ticket idempotency key when a failed creation is retried', async () => {
    render(<SupportPage />);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Please investigate this issue.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
    await waitFor(() => expect(ticketApi.create).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
    await waitFor(() => expect(ticketApi.create).toHaveBeenCalledTimes(2));
    expect(ticketApi.create.mock.calls[0][1]).toBe(ticketApi.create.mock.calls[1][1]);
  });
});
