import React, { useState } from 'react';
import { CreditCard, User, CheckCircle } from 'lucide-react';
import { toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

const PaymentForm = () => {
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
        const response = await axios.post('/api/add-payment', {
            userId,
            amount: parseFloat(amount)
        });

        toast.success(response.data.message, {
            theme: "dark",
            className: "bg-purple-950 text-purple-50 border-purple-700",
        });
        
        setUserId('');
        setAmount('');
    } catch (error) {
        if (error.response) {
            toast.error(error.response.data.error || 'Payment processing failed', {
                theme: "dark",
                className: "bg-purple-950 text-purple-50 border-purple-700",
            });
        } else {
            toast.error('Failed to process payment', {
                theme: "dark",
                className: "bg-purple-950 text-purple-50 border-purple-700",
            });
        }
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
        <label htmlFor="amount" className="text-purple-400 flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-purple-400" />
          Amount ($)
        </label>
        <input
          id="amount"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Enter amount"
          min="0"
          step="0.01"
          className="w-full px-4 py-2 bg-black border border-purple-900 rounded-md text-purple-50 focus:border-purple-600 focus:outline-none"
        />
      </div>

      <button
        type="submit"
        className="w-full py-2 bg-purple-900 hover:bg-purple-800 text-purple-50 rounded-md flex items-center justify-center gap-2 transition-colors"
      >
        Add Payment
        <CheckCircle className="w-4 h-4 text-purple-50" />
      </button>
    </form>
  );
};

export default PaymentForm;