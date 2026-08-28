import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ManualTasksPage from './ManualTasksPage';
import { manualTaskApi } from '../../service/api';

vi.mock('../../components/NavBar', () => ({ default: () => null }));
vi.mock('../../service/api', () => ({
  manualTaskApi: {
    list: vi.fn(),
    claim: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function task(status, assignedTo = null) {
  return {
    _id: 'task-1',
    status,
    assignedTo,
    notes: '',
    proof: '',
    dueAt: null,
    orderId: {
      orderId: 'ord-manual-1',
      quantity: 1000,
      target: 'https://example.com/target',
      service: 'manual-service',
      user: { userId: 'customer-1' },
    },
  };
}

describe('ManualTasksPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    manualTaskApi.claim.mockResolvedValue({});
    manualTaskApi.update.mockResolvedValue({});
  });

  it('claims an unassigned pending task through the centralized API', async () => {
    manualTaskApi.list.mockResolvedValue({ tasks: [task('PENDING')] });
    render(<ManualTasksPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Claim' }));
    await waitFor(() => expect(manualTaskApi.claim).toHaveBeenCalledWith('task-1'));
  });

  it('offers only valid in-progress transitions', async () => {
    manualTaskApi.list.mockResolvedValue({
      tasks: [task('IN_PROGRESS', { userId: 'admin-1' })],
    });
    render(<ManualTasksPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }));
    expect(screen.getByRole('button', { name: /Await Approval/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /In Progress/ })).not.toBeInTheDocument();
  });

  it('renders resolved tasks as immutable', async () => {
    manualTaskApi.list.mockResolvedValue({
      tasks: [task('COMPLETED', { userId: 'admin-1' })],
    });
    render(<ManualTasksPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }));
    expect(screen.getByLabelText('Admin Notes')).toBeDisabled();
    expect(screen.getByLabelText('Proof of Delivery')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Refund/ })).not.toBeInTheDocument();
  });
});
