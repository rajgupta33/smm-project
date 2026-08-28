import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { serviceApi } from '../service/api'; 
import { RotateCcw, Search, AlertCircle, Check, Info, IndianRupee, RefreshCcw } from 'lucide-react';

const OrderCard = ({ order, onOrderUpdate }) => {
  const navigate = useNavigate();
  const [refillStatusLoading, setRefillStatusLoading] = useState(false);
  const [currentRefillStatus, setCurrentRefillStatus] = useState(null); 
  
  
  const [checkingOrderStatusLoading, setCheckingOrderStatusLoading] = useState(false);
  
  const [lastCheckedOrderStatusDetails, setLastCheckedOrderStatusDetails] = useState(null); 
  const canContactProvider = !order.lifecycleStatus || order.lifecycleStatus === 'SUBMITTED';
  const activeRefill = order.refillRequest && [
    'REQUESTED', 'VALIDATING', 'SENT_TO_PROVIDER', 'IN_PROGRESS', 'NEEDS_SUPPORT',
  ].includes(order.refillRequest.status);


  
  const handleRequestRefill = async () => {
    
    if (order.refill === null || activeRefill ||
        (!order.refillRequest && typeof order.refill === 'string' && order.refill.trim())) {
      toast.warn("Refill is not available to be requested for this order.", { theme: "dark" });
      return;
    }

    try {
      const loadingToastId = toast.loading("Requesting refill...", { theme: "dark" });

      
      const response = await serviceApi.requestRefill(order.orderId);

      if (response.success) {
        toast.update(loadingToastId, {
          render: `Refill queued safely. Request: ${response.data.id}`,
          type: "success",
          isLoading: false,
          autoClose: 5000,
          theme: "dark",
          icon: <Check className="text-green-500" />
        });
        
        
        if (onOrderUpdate) {
            onOrderUpdate(order.orderId);
        }
      } else {
        toast.update(loadingToastId, {
          render: response.message || "Failed to request refill.",
          type: "error",
          isLoading: false,
          autoClose: 5000,
          theme: "dark",
          icon: <AlertCircle className="text-red-500" />
        });
      }
    } catch (error) {
      console.error("Error requesting refill:", error);
      toast.error(error.response?.data?.message || "An error occurred while requesting refill.", {
        icon: <AlertCircle className="text-red-500" />,
        theme: "dark"
      });
    }
  };

  
  const handleCheckRefillStatus = async () => {
    
    const refillIdToCheck = order.refillRequest?.id;

    
    if (typeof refillIdToCheck !== 'string' || refillIdToCheck.trim() === '') {
      toast.info("No refill request is available to check.", { theme: "dark" });
      return;
    }

    setRefillStatusLoading(true);
    setCurrentRefillStatus(null); 

    try {
      const loadingToastId = toast.loading(`Checking status for Refill ID: ${refillIdToCheck}...`, { theme: "dark" });

      
      const response = await serviceApi.checkRefillStatus(refillIdToCheck); 

      if (response.success) {
        const status = response.data.status;
        setCurrentRefillStatus(status); 

        
        const toastType = status === 'Completed' ? "success" : "info";
        const toastIcon = status === 'Completed' ? <Check className="text-green-500" /> : <Info className="text-blue-400" />;

        toast.update(loadingToastId, {
          render: `Refill Status: ${status}`,
          type: toastType, // Use the determined type
          isLoading: false,
          autoClose: 7000,
          theme: "dark",
          icon: toastIcon // Use the determined icon
        });
      } else {
        toast.update(loadingToastId, {
          render: response.message || "Failed to check refill status.",
          type: "error",
          isLoading: false,
          autoClose: 5000,
          theme: "dark",
          icon: <AlertCircle className="text-red-500" />
        });
      }
    } catch (error) {
      console.error("Error checking refill status:", error);
      toast.error(error.response?.data?.message || "An error occurred while checking refill status.", {
        icon: <AlertCircle className="text-red-500" />,
        theme: "dark"
      });
    } finally {
      setRefillStatusLoading(false);
    }
  };

  // Function to check main order status
  const handleCheckOrderStatus = async () => {
    setCheckingOrderStatusLoading(true);
    setLastCheckedOrderStatusDetails(null); // Clear previous detailed status display

    try {
      const loadingToastId = toast.loading(`Checking status for Order ID: ${order.orderId}...`, { theme: "dark" });
      
      
      const response = await serviceApi.checkOrderStatus(order.orderId);

      if (response.success && response.data) { // Check for both success and data presence
        const status = response.data.status; // Access status from response.data
        setLastCheckedOrderStatusDetails(response.data); // Store the full data object

        // Determine toast type and icon based on status
        const toastType = status === 'Completed' ? "success" : "info";
        const toastIcon = status === 'Completed' ? <Check className="text-green-500" /> : <Info className="text-blue-400" />;

        toast.update(loadingToastId, {
          render: `Order Status: ${status}`,
          type: toastType,
          isLoading: false,
          autoClose: 7000,
          theme: "dark",
          icon: toastIcon
        });

        
        if (onOrderUpdate && order.lastStatus !== status) { // Changed to order.lastStatus
            onOrderUpdate(order.orderId); 
        }

      } else {
        toast.update(loadingToastId, {
          render: response.message || "Failed to check order status.",
          type: "error",
          isLoading: false,
          autoClose: 5000,
          theme: "dark",
          icon: <AlertCircle className="text-red-500" />
        });
      }
    } catch (error) {
      console.error("Error checking order status:", error);
      toast.error(error.response?.data?.message || "An error occurred while checking order status.", {
        icon: <AlertCircle className="text-red-500" />,
        theme: "dark"
      });
    } finally {
      setCheckingOrderStatusLoading(false);
    }
  };

  // Helper to determine the color of the status text
  const getStatusTextColor = (status) => {
    switch (status) {
      case 'Completed': return 'text-green-500';
      case 'Pending': return 'text-yellow-500';
      case 'In Progress': return 'text-blue-500';
      case 'Partial': return 'text-orange-400';
      default: return 'text-red-500'; // For 'Canceled', 'Error', etc.
    }
  };

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg text-white space-y-3 border border-purple-700/50">
      <h3 className="text-xl font-bold text-purple-400">Order ID: {order.orderId}</h3>
      <p>
        <span className="font-semibold">Service:</span> {order.service}
      </p>
      <p>
        <span className="font-semibold">Quantity:</span> {order.quantity}
      </p>
      <p className="flex items-center">
        <span className="font-semibold">Rate:</span> <IndianRupee size={16} className="ml-1 mr-0.5" />{order.rate} per 1000
      </p>
      <p>
        <span className="font-semibold">Date:</span> {new Date(order.createdAt).toLocaleDateString('en-IN', {
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            })}
      </p>
      <p>
        <span className="font-semibold">Last Status:</span>{' '} {/* Changed to Last Status */}
        <span className={`font-bold ${getStatusTextColor(lastCheckedOrderStatusDetails?.status || order.lastStatus)}`}>
          {/* Display the dynamically checked status if available, otherwise default to prop status */}
          {lastCheckedOrderStatusDetails?.status || order.lastStatus}
        </span>
      </p>
      <p>
        <span className="font-semibold">Start Count:</span>{' '}
        {/* Display start_count directly from order prop */}
        {lastCheckedOrderStatusDetails?.start_count || order.start_count} 
      </p>

      {order.lifecycleStatus === 'RECONCILIATION_REQUIRED' && (
        <div className="rounded-md border border-amber-500/60 bg-amber-950/40 p-3 text-sm text-amber-200">
          Provider confirmation is uncertain. This order is held for support reconciliation and will not be submitted again automatically.
        </div>
      )}
      {order.lifecycleStatus === 'PROVIDER_REJECTED' && (
        <div className="rounded-md border border-red-500/60 bg-red-950/40 p-3 text-sm text-red-200">
          The provider rejected this order and the wallet debit was refunded.
        </div>
      )}

      {/* Display additional order status details ONLY if they have been explicitly fetched */}
      {lastCheckedOrderStatusDetails && (
        <div className="bg-gray-700 p-3 rounded-md text-sm space-y-1 border border-gray-600">
          <p><span className="font-semibold text-gray-300">Charge:</span> {lastCheckedOrderStatusDetails.charge} {lastCheckedOrderStatusDetails.currency}</p>
          <p><span className="font-semibold text-gray-300">Remains:</span> {lastCheckedOrderStatusDetails.remains}</p>
          {/* start_count is now always from order.start_count so no need to repeat it here if it's already shown above */}
        </div>
      )}

      <p>
        <span className="font-semibold">Refill:</span>{' '}
        {order.refillRequest ? (
          `${order.refillRequest.status} (request ${order.refillRequest.id})`
        ) : order.refill === null ? (
          'Not Available'
        ) : order.refill === "" ? (
          'Available (click to request)'
        ) : ( // Assuming it's a non-empty string (refillId) if not null or ""
          `Refill in progress (ID: ${order.refill})`
        )}
      </p>

      <div className="flex flex-col gap-2"> {/* Container for buttons */}
        <button
          onClick={() => navigate(`/orders/${order.orderId || order.localOrderId}`)}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Info size={16} className="mr-2" />
          View Timeline & Details
        </button>
        {/* Conditional Refill Button: Show if order.refill is exactly an empty string "" */}
        {canContactProvider && order.refill !== null && !activeRefill && (
          <button
            onClick={handleRequestRefill}
            disabled={refillStatusLoading || checkingOrderStatusLoading} // Disable if any other operation is loading
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-md bg-purple-600 hover:bg-purple-700 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw size={18} />
            Request Refill
          </button>
        )}

        {/* Conditional Check Refill Status Button: Show if order.refill is a non-empty string (refillId) */}
        {canContactProvider && order.refillRequest && (
          <div className="mt-1"> {/* Use mt-1 for a smaller gap if both buttons are present */}
            <button
              onClick={handleCheckRefillStatus}
              disabled={refillStatusLoading || checkingOrderStatusLoading} // Disable if any other operation is loading
              className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Search size={18} />
              {refillStatusLoading ? 'Checking Refill...' : 'Check Refill Status'}
            </button>
            {currentRefillStatus && (
              <p className="mt-2 text-center text-sm text-blue-300">Refill Status: {currentRefillStatus}</p>
            )}
          </div>
        )}

        {/* Check Main Order Status Button */}
        {canContactProvider && order.lastStatus !== 'Completed' && (<div className="mt-1">
          <button
            onClick={handleCheckOrderStatus}
            disabled={checkingOrderStatusLoading || refillStatusLoading} // Disable if any other operation is loading
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-md bg-green-600 hover:bg-green-700 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCcw size={18} />
            {checkingOrderStatusLoading ? 'Updating Status...' : 'Check Order Status'}
          </button>
        </div>)}
      </div>
    </div>
  );
};

export default OrderCard;
