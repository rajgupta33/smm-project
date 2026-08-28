// components/TransactionCard.jsx
import React from 'react';
import { CreditCard, Calendar, ShoppingBag } from 'lucide-react'; // Import necessary icons


const TransactionCard = ({ payment }) => {
  const status = payment.status || 'RECORDED';
  const normalizedStatus = status.toLowerCase();

  return (
    <div className="bg-black/90 backdrop-blur-sm shadow-xl rounded-2xl max-w-md w-full p-6 border border-purple-900/30 transition-all duration-300 hover:shadow-2xl hover:scale-105">
      <div className="flex items-center gap-3 mb-4">
        <CreditCard className="w-6 h-6 text-purple-400" />
        <h3 className="text-xl font-semibold text-purple-400">Wallet Activity</h3>
      </div>

      <div className="flex items-center gap-2 mb-3"> {/* Added margin-bottom */}
          <span className="text-purple-200">Status:</span>
          <span className={`font-medium ${
            ['recorded', 'completed', 'legacy_recorded'].includes(normalizedStatus) ? 'text-green-400' :
            normalizedStatus === 'pending' ? 'text-yellow-400' :
            'text-red-400'
          }`}>
            {status.replaceAll('_', ' ')}
          </span>
        </div>
      
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-purple-200">Amount:</span>
          <span className="text-purple-50 font-medium">₹{payment.amount.toFixed(2)}</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-purple-200">Order ID:</span>
          <span className="text-purple-50 font-medium break-all">{payment.orderId}</span> {/* break-all for long IDs */}
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-purple-200">Date:</span>
          <span className="text-purple-50 font-medium">
            {new Date(payment.date).toLocaleDateString('en-IN', {
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            })}
          </span>
        </div>
      </div>
    </div>
  );
};

export default TransactionCard;
