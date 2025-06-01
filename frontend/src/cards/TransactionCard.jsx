// components/TransactionCard.jsx
import React from 'react';
import { CreditCard, Calendar, ShoppingBag } from 'lucide-react'; // Import necessary icons

const TransactionCard = ({ payment }) => {
  return (
    <div className="bg-black/90 backdrop-blur-sm shadow-xl rounded-2xl max-w-md w-full p-6 border border-purple-900/30 transition-all duration-300 hover:shadow-2xl">
      <div className="flex items-center gap-3 mb-4">
        <CreditCard className="w-6 h-6 text-purple-400" />
        <h3 className="text-xl font-semibold text-purple-400">Payment Details</h3>
      </div>
      
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-purple-200">Amount:</span>
          <span className="text-purple-50 font-medium">${payment.amount.toFixed(2)}</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-purple-200">Order ID:</span>
          <span className="text-purple-50 font-medium">{payment.orderId}</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-purple-200">Date:</span>
          <span className="text-purple-50 font-medium">
            {new Date(payment.date).toLocaleDateString()}
          </span>
        </div>
      </div>
    </div>
  );
};

export default TransactionCard;