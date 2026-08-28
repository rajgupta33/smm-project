import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UserProfilePage from './UserProfilePage';
import { serviceApi } from '../../service/api';

vi.mock('../../components/NavBar', () => ({ default: () => <nav>Navigation</nav> }));
vi.mock('../../context/Authcontext', () => ({
  useAuth: () => ({ user: { id: 'customer-1', wallet: 50 } }),
}));
vi.mock('../../service/api', () => ({
  authApi: { me: vi.fn(async () => ({ success: true, data: { user: { wallet: 50 } } })) },
  serviceApi: { changePassword: vi.fn() },
}));

describe('UserProfilePage', () => {
  beforeEach(() => { serviceApi.changePassword.mockReset(); });

  it('submits current and new passwords through the real service boundary', async () => {
    serviceApi.changePassword.mockResolvedValue({ success: true });
    render(<UserProfilePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
    fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: 'OldPassword1!' } });
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'NewPassword1!' } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'NewPassword1!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Change' }));

    await waitFor(() => expect(serviceApi.changePassword).toHaveBeenCalledWith({
      currentPassword: 'OldPassword1!',
      newPassword: 'NewPassword1!',
    }));
  });
});
