import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { serviceApi } from '../service/api'; 
// AlertCircle and Check are used only inside toast `icon` props, which ESLint
// cannot see as references without the React plugin -- do not "clean up" these
// imports based on a lint pass alone.
import { RotateCcw, Search, Info, RefreshCcw, AlertCircle, Check } from 'lucide-react';
import { StatusBadge } from '../components/ui/Primitives';

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
          icon: <Check className="text-state-success" />
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
          icon: <AlertCircle className="text-state-danger" />
        });
      }
    } catch (error) {
      console.error("Error requesting refill:", error);
      toast.error(error.response?.data?.message || "An error occurred while requesting refill.", {
        icon: <AlertCircle className="text-state-danger" />,
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
        const toastIcon = status === 'Completed' ? <Check className="text-state-success" /> : <Info className="text-blue-400" />;

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
          icon: <AlertCircle className="text-state-danger" />
        });
      }
    } catch (error) {
      console.error("Error checking refill status:", error);
      toast.error(error.response?.data?.message || "An error occurred while checking refill status.", {
        icon: <AlertCircle className="text-state-danger" />,
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
        const toastIcon = status === 'Completed' ? <Check className="text-state-success" /> : <Info className="text-blue-400" />;

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
          icon: <AlertCircle className="text-state-danger" />
        });
      }
    } catch (error) {
      console.error("Error checking order status:", error);
      toast.error(error.response?.data?.message || "An error occurred while checking order status.", {
        icon: <AlertCircle className="text-state-danger" />,
        theme: "dark"
      });
    } finally {
      setCheckingOrderStatusLoading(false);
    }
  };

  // Status colour now comes from the shared StatusBadge so every screen tones
  // the same backend status identically.
  const displayStatus = lastCheckedOrderStatusDetails?.status || order.lastStatus;
  const startCount = lastCheckedOrderStatusDetails?.start_count ?? order.start_count;

  const refillLabel = order.refillRequest
    ? `${order.refillRequest.status} (request ${order.refillRequest.id})`
    : order.refill === null
      ? 'Not Available'
      : order.refill === ''
        ? 'Available (click to request)'
        : `Refill in progress (ID: ${order.refill})`;

  return (
    <article className="card card-hover flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Order</p>
          <h3 className="truncate font-mono text-sm font-semibold text-ink" title={order.orderId}>
            {order.orderId}
          </h3>
        </div>
        <StatusBadge status={displayStatus} />
      </div>

      <dl className="mt-4 flex-1">
        <div className="stack-row">
          <dt className="stack-key">Service</dt>
          <dd className="stack-val">{order.service}</dd>
        </div>
        <div className="stack-row">
          <dt className="stack-key">Quantity</dt>
          <dd className="stack-val tnum">{Number(order.quantity).toLocaleString('en-IN')}</dd>
        </div>
        <div className="stack-row">
          <dt className="stack-key">Rate</dt>
          <dd className="stack-val tnum">₹{order.rate} / 1000</dd>
        </div>
        <div className="stack-row">
          <dt className="stack-key">Placed</dt>
          <dd className="stack-val">
            {new Date(order.createdAt).toLocaleDateString('en-IN', {
              year: 'numeric', month: 'short', day: 'numeric',
            })}
          </dd>
        </div>
        <div className="stack-row">
          <dt className="stack-key">Start count</dt>
          <dd className="stack-val tnum">{startCount ?? '—'}</dd>
        </div>
        <div className="stack-row">
          <dt className="stack-key">Refill</dt>
          <dd className="stack-val">{refillLabel}</dd>
        </div>
      </dl>

      {order.lifecycleStatus === 'RECONCILIATION_REQUIRED' && (
        <p className="mt-3 rounded-xl border border-state-warning/30 bg-state-warning-bg px-3 py-2.5 text-xs leading-relaxed text-state-warning">
          Provider confirmation is uncertain. Support is reconciling this order and it will not be
          submitted again automatically.
        </p>
      )}
      {order.lifecycleStatus === 'PROVIDER_REJECTED' && (
        <p className="mt-3 rounded-xl border border-state-danger/30 bg-state-danger-bg px-3 py-2.5 text-xs leading-relaxed text-state-danger">
          The provider rejected this order and your wallet was refunded.
        </p>
      )}

      {lastCheckedOrderStatusDetails && (
        <div className="mt-3 rounded-xl bg-surface-sunken px-3 py-2.5 text-xs text-ink-soft">
          <span className="font-semibold text-ink">Charge:</span>{' '}
          {lastCheckedOrderStatusDetails.charge} {lastCheckedOrderStatusDetails.currency}
          <span className="mx-2 text-ink-faint">|</span>
          <span className="font-semibold text-ink">Remains:</span>{' '}
          {lastCheckedOrderStatusDetails.remains}
        </div>
      )}

      {currentRefillStatus && (
        <p className="mt-3 text-center text-xs text-ink-muted">Refill status: {currentRefillStatus}</p>
      )}

      <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
        <button
          type="button"
          onClick={() => navigate(`/orders/${order.orderId || order.localOrderId}`)}
          className="btn-secondary btn-sm"
        >
          <Info size={16} aria-hidden="true" />
          View Timeline &amp; Details
        </button>

        {canContactProvider && order.refill !== null && !activeRefill && (
          <button
            type="button"
            onClick={handleRequestRefill}
            disabled={refillStatusLoading || checkingOrderStatusLoading}
            className="btn-secondary btn-sm"
          >
            <RotateCcw size={16} aria-hidden="true" />
            Request Refill
          </button>
        )}

        {canContactProvider && order.refillRequest && (
          <button
            type="button"
            onClick={handleCheckRefillStatus}
            disabled={refillStatusLoading || checkingOrderStatusLoading}
            className="btn-secondary btn-sm"
          >
            <Search size={16} aria-hidden="true" />
            {refillStatusLoading ? 'Checking Refill...' : 'Check Refill Status'}
          </button>
        )}

        {canContactProvider && order.lastStatus !== 'Completed' && (
          <button
            type="button"
            onClick={handleCheckOrderStatus}
            disabled={checkingOrderStatusLoading || refillStatusLoading}
            className="btn-primary btn-sm"
          >
            <RefreshCcw size={16} aria-hidden="true" />
            {checkingOrderStatusLoading ? 'Updating Status...' : 'Check Order Status'}
          </button>
        )}
      </div>
    </article>
  );
};

export default OrderCard;
