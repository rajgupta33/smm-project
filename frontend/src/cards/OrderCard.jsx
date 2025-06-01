import React from 'react';
import { Package, AlertCircle, CheckCircle } from 'lucide-react';

const OrderCard = ({ order }) => {
  // Calculate total cost
  const totalCost = order.cost * order.quantity;

  // Status configuration
  const statusConfig = {
    pending: {
      icon: <AlertCircle className="w-5 h-5 text-yellow-400" />,
      text: "Pending",
      bgColor: "bg-yellow-900/30"
    },
    completed: {
      icon: <CheckCircle className="w-5 h-5 text-green-400" />,
      text: "Completed",
      bgColor: "bg-green-900/30"
    },
    cancelled: {
      icon: <AlertCircle className="w-5 h-5 text-red-400" />,
      text: "Cancelled",
      bgColor: "bg-red-900/30"
    }
  };

  return (
    <div className="bg-black/90 backdrop-blur-sm shadow-xl rounded-2xl max-w-md w-full p-6 border border-purple-900/30 transition-all duration-300 hover:shadow-2xl">
      <div className="flex items-center gap-3 mb-4">
        <Package className="w-6 h-6 text-purple-400" />
        <h3 className="text-xl font-semibold text-purple-400">Order Details</h3>
      </div>
      
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-purple-200">Service:</span>
          <span className="text-purple-50 font-medium">{order.service}</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-purple-200">Quantity:</span>
          <span className="text-purple-50 font-medium">{order.quantity}</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-purple-200">Cost:</span>
          <span className="text-purple-50 font-medium">${order.cost.toFixed(2)}</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-purple-200">Total:</span>
          <span className="text-purple-50 font-medium">${totalCost.toFixed(2)}</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-purple-200">Order ID:</span>
          <span className="text-purple-50 font-medium">{order.orderId}</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-purple-200">Status:</span>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${statusConfig[order.status]?.bgColor || 'bg-gray-900/30'}`}>
            {statusConfig[order.status]?.icon}
            <span className="text-purple-50 font-medium">{statusConfig[order.status]?.text || 'Unknown'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderCard;