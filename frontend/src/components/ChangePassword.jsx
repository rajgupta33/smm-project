import React, { useState } from 'react';
import { toast } from 'react-toastify';
import { Lock, User, CheckCircle } from 'lucide-react';
import 'react-toastify/dist/ReactToastify.css';

const ChangePasswordForm = () => {
  const [userId, setUserId] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!userId || !newPassword || !confirmPassword) {
      toast.error('Please fill in all fields', {
        theme: "dark",
        className: "bg-purple-950 text-purple-50 border-purple-700",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match', {
        theme: "dark",
        className: "bg-purple-950 text-purple-50 border-purple-700",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await axios.post('/api/change-password', {
        userId,
        newPassword
      });

      toast.success(response.data.message, {
        theme: "dark",
        className: "bg-purple-950 text-purple-50 border-purple-700",
      });

      setUserId('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error) {
      if (error.response) {
        toast.error(error.response.data.error || 'Failed to change password', {
          theme: "dark",
          className: "bg-purple-950 text-purple-50 border-purple-700",
        });
      } else {
        toast.error('Failed to change password', {
          theme: "dark",
          className: "bg-purple-950 text-purple-50 border-purple-700",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-md mx-auto space-y-4 p-6 bg-black/90 rounded-lg shadow-xl">
      <div className="space-y-2">
        <label htmlFor="userId" className="text-purple-400 flex items-center gap-2">
          <User className="w-4 h-4 text-purple-400" />
          User ID
        </label>
        <input
          id="userId"
          type="text"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="Enter user ID"
          className="w-full px-4 py-2 bg-black border border-purple-900 rounded-md text-purple-50 focus:border-purple-600 focus:outline-none"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="newPassword" className="text-purple-400 flex items-center gap-2">
          <Lock className="w-4 h-4 text-purple-400" />
          New Password
        </label>
        <input
          id="newPassword"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="Enter new password"
          className="w-full px-4 py-2 bg-black border border-purple-900 rounded-md text-purple-50 focus:border-purple-600 focus:outline-none"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="confirmPassword" className="text-purple-400 flex items-center gap-2">
          <Lock className="w-4 h-4 text-purple-400" />
          Confirm Password
        </label>
        <input
          id="confirmPassword"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Confirm new password"
          className="w-full px-4 py-2 bg-black border border-purple-900 rounded-md text-purple-50 focus:border-purple-600 focus:outline-none"
        />
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full py-2 bg-purple-900 hover:bg-purple-800 text-purple-50 rounded-md flex items-center justify-center gap-2 transition-colors"
      >
        {isSubmitting ? 'Changing...' : 'Change Password'}
        <CheckCircle className="w-4 h-4 text-purple-50" />
      </button>
    </form>
  );
};

export default ChangePasswordForm;