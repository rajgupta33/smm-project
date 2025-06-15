// src/cards/OrderCard.jsx
import React from 'react';
import { Package, AlertCircle, CheckCircle } from 'lucide-react';

const OrderCard = ({ order }) => {
  // Calculate total cost (using 'rate' from schema)
  const totalCost = (order.rate || 0) * (order.quantity || 0);

  // Status configuration using custom colors
  const statusConfig = {
    pending: {
      icon: <AlertCircle className="w-5 h-5 text-yellow-400" />, // Keeping standard yellow for clear status
      text: "Pending",
      bgColor: "bg-yellow-900/30" // Keeping for transparent background effect
    },
    completed: {
      icon: <CheckCircle className="w-5 h-5 text-green-400" />, // Keeping standard green
      text: "Completed",
      bgColor: "bg-green-900/30"
    },
    cancelled: {
      icon: <AlertCircle className="w-5 h-5 text-danger-red" />, // Using custom danger-red
      text: "Cancelled",
      bgColor: "bg-red-900/30" // Keeping for transparent background effect
    }
  };

  // Get current status config, default to unknown if status not found
  const currentStatus = statusConfig[order.status?.toLowerCase()] || {
    icon: <AlertCircle className="w-5 h-5 text-text-dim" />, // Default icon for unknown status
    text: order.status || 'Unknown', // Use provided status or 'Unknown'
    bgColor: "bg-dark-card/50" // A more neutral transparent background for unknown
  };

  return (
    <div className="bg-dark-card backdrop-blur-sm shadow-xl rounded-2xl w-full p-6 border border-primary-purple/30 transition-all duration-300 hover:shadow-2xl hover:scale-[1.02]">
      <div className="flex items-center gap-3 mb-4">
        <Package className="w-6 h-6 text-primary-purple" />
        <h3 className="text-xl font-semibold text-primary-purple">Order Details</h3>
      </div>
      
      <div className="space-y-3 text-text-light"> {/* Apply text-light to all content */}
        <div className="flex items-center gap-2">
          <span className="text-text-dim">Service:</span>
          <span className="font-medium">{order.service || 'N/A'}</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-text-dim">Quantity:</span>
          <span className="font-medium">{order.quantity || 0}</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-text-dim">Rate:</span>
          <span className="font-medium">₹{(order.rate || 0).toFixed(2)}</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-text-dim">Total:</span>
          <span className="font-medium">₹{totalCost.toFixed(2)}</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-text-dim">Order ID:</span>
          <span className="font-medium break-all">{order.orderId || 'N/A'}</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-text-dim">Status:</span>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${currentStatus.bgColor}`}>
            {currentStatus.icon}
            <span className="font-medium">{currentStatus.text}</span>
          </div>
        </div>
        
        {order.createdAt && (
          <div className="flex items-center gap-2 text-sm text-text-dim pt-2 border-t border-primary-purple/30">
            <span>Ordered On:</span>
            <span className="font-medium">
              {new Date(order.createdAt).toLocaleDateString('en-IN', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderCard;