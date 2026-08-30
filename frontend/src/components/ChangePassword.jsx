import React, { useState } from 'react';
import { toast } from 'react-toastify';
import { Lock, User, CheckCircle } from 'lucide-react';
import 'react-toastify/dist/ReactToastify.css';
import { serviceApi } from '../service/api'

const ChangePasswordForm = () => {
  const [userId, setUserId] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * Handles form submission for changing the password.
   * Performs client-side validation and calls the mock API.
   * @param {Object} e - The form submission event.
   */
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Client-side validation
    if (!userId.trim() || !newPassword.trim() || !confirmPassword.trim()) {
      toast.error('Please fill in all fields', {
        theme: "dark",
        className: "bg-surface-sunken text-ink border-line",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match', {
        theme: "dark",
        className: "bg-surface-sunken text-ink border-line",
      });
      return;
    }

    if (newPassword.length < 6) {
        toast.error('New password must be at least 6 characters long.', {
            theme: "dark",
            className: "bg-surface-sunken text-ink border-line",
        });
        return;
    }

    setIsSubmitting(true); // Set submitting state to true
    try {
      // Call the mock axios API
      const response = await serviceApi.changeUserPassword({ userId, newPassword });

      if (!response.success) {
        throw new Error(response.message || 'Failed to change password');
      }
      
      // Show success toast
      toast.success("password change successful", {
        theme: "dark",
        className: "bg-surface-sunken text-ink border-line",
      });
      await new Promise((resolve) => setTimeout(resolve, 3000));
      // Clear form fields on success
      setUserId('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      // Handle API errors and show error toast
      if (error.response) {
        toast.error(error.response.data.error || 'Failed to change password', {
          theme: "dark",
          className: "bg-surface-sunken text-ink border-line",
        });
      } else {
        toast.error(error.message || 'Failed to change password', {
          theme: "dark",
          className: "bg-surface-sunken text-ink border-line",
        });
      }
    } finally {
      setIsSubmitting(false); // Reset submitting state
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-md mx-auto space-y-4 p-6 bg-surface rounded-lg shadow-card border border-line">
      <h2 className="text-2xl font-bold text-center text-ink-muted mb-6">Change Password</h2>
      {/* User ID Input */}
      <div className="space-y-2">
        <label htmlFor="userId" className="text-ink-muted flex items-center gap-2">
          <User className="w-4 h-4 text-ink-muted" />
          User ID
        </label>
        <input
          id="userId"
          type="text"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="Enter user ID"
          className="w-full px-4 py-2 bg-surface border border-line rounded-md text-ink focus:border-line focus:outline-none transition-colors"
        />
      </div>

      {/* New Password Input */}
      <div className="space-y-2">
        <label htmlFor="newPassword" className="text-ink-muted flex items-center gap-2">
          <Lock className="w-4 h-4 text-ink-muted" />
          New Password
        </label>
        <input
          id="newPassword"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="Enter new password"
          className="w-full px-4 py-2 bg-surface border border-line rounded-md text-ink focus:border-line focus:outline-none transition-colors"
        />
      </div>

      {/* Confirm Password Input */}
      <div className="space-y-2">
        <label htmlFor="confirmPassword" className="text-ink-muted flex items-center gap-2">
          <Lock className="w-4 h-4 text-ink-muted" />
          Confirm Password
        </label>
        <input
          id="confirmPassword"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Confirm new password"
          className="w-full px-4 py-2 bg-surface border border-line rounded-md text-ink focus:border-line focus:outline-none transition-colors"
        />
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isSubmitting} // Disable button while submitting
        className="w-full py-3 bg-brand-gradient text-white hover:brightness-110 text-ink font-semibold rounded-md flex items-center justify-center gap-2 transition-colors transform hover:scale-105 active:scale-95"
      >
        {isSubmitting ? 'Changing...' : 'Change Password'}
        <CheckCircle className="w-5 h-5 text-ink" />
      </button>
    </form>
  );
};

export default ChangePasswordForm;
