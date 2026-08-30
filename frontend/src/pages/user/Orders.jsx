import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, PackageOpen, Plus } from 'lucide-react';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import OrderCard from '../../cards/OrderCard';
import ResponsiveNavbar from '../../components/NavBar';
import { EmptyState, LoadingRows } from '../../components/ui/Primitives';
import { serviceApi } from '../../service/api';

const LIMIT = 10;

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await serviceApi.getOrders(page, LIMIT);
      const fetchedOrders = response.data?.data || response.data;

      if (Array.isArray(fetchedOrders)) {
        setOrders((previous) => (page === 1 ? fetchedOrders : [...previous, ...fetchedOrders]));
        setHasMore(fetchedOrders.length === LIMIT);
      } else {
        setOrders([]);
        setHasMore(false);
        console.warn('Unexpected orders payload:', fetchedOrders);
      }
    } catch (err) {
      console.error('Failed to fetch orders:', err);
      setError('Failed to load your orders. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [page]);

  const handleOrderUpdate = useCallback(async () => {
    await fetchOrders();
    toast.success('Order status refreshed.', { autoClose: 2000 });
  }, [fetchOrders]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const handleLoadMore = () => setPage((previous) => previous + 1);

  return (
    <div className="min-h-screen bg-surface-sunken">
      <ResponsiveNavbar />

      <main className="page">
        <header className="page-head">
          <div>
            <h1 className="page-title">Your orders</h1>
            <p className="page-sub">Status updates on its own. No need to keep refreshing.</p>
          </div>
          <Link to="/home" className="btn-primary btn-sm">
            <Plus className="h-4 w-4" aria-hidden="true" />
            New order
          </Link>
        </header>

        {loading && orders.length === 0 && <LoadingRows rows={3} />}

        {error && !loading && (
          <div className="card card-p">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-state-danger" aria-hidden="true" />
              <div>
                <p className="font-semibold text-ink">We could not load your orders</p>
                <p className="mt-1 text-sm text-ink-muted">{error}</p>
                <button type="button" onClick={fetchOrders} className="btn-secondary btn-sm mt-4">
                  Try again
                </button>
              </div>
            </div>
          </div>
        )}

        {!loading && !error && orders.length === 0 && (
          <EmptyState
            icon={PackageOpen}
            title="No orders yet"
            description="Once you place an order it will appear here with live status."
            action={<Link to="/home" className="btn-primary btn-sm">Place your first order</Link>}
          />
        )}

        {!error && orders.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {orders.map((order) => (
              <OrderCard
                key={order._id || order.orderId}
                order={order}
                onOrderUpdate={handleOrderUpdate}
              />
            ))}
          </div>
        )}

        {!loading && hasMore && !error && orders.length > 0 && (
          <div className="mt-8 flex justify-center">
            <button type="button" onClick={handleLoadMore} className="btn-secondary">
              Load more orders
            </button>
          </div>
        )}

        {loading && orders.length > 0 && (
          <p className="mt-8 text-center text-sm text-ink-muted" role="status">Loading more…</p>
        )}
      </main>

      <ToastContainer position="top-center" autoClose={4000} theme="light" newestOnTop closeOnClick />
    </div>
  );
}
