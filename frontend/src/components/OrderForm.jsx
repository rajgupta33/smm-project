import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, PackageOpen, ShieldCheck, Wallet } from 'lucide-react';
import { serviceApi } from '../service/api';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useAuth } from '../context/Authcontext';

/** Common order sizes offered as one-tap chips, filtered to the service range. */
const QUANTITY_PRESETS = [100, 500, 1000, 2500, 5000, 10000];

function OrderForm() {
  const auth = useAuth();
  const [formData, setFormData] = useState({
    linkInput: '',
    serviceId: '', // This will hold selectedProduct.serviceId
    quantity: 1,
    runs: 1,
    interval: 60,
    notes: '', // Still managed in state for display/user input
    totalAmount: 0,
  });

  const [servicesData, setServicesData] = useState([]); // State to store fetched services
  const [loading, setLoading] = useState(true); // State for loading indicator
  const [error, setError] = useState(null); // State for error handling
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Fetch services data on component mount
  useEffect(() => {
    const fetchServices = async () => {
      try {
        setLoading(true);
        const response = await serviceApi.getUserServices();
        setServicesData(response.data);
        setError(null); // Clear any previous errors
      } catch (err) {
        console.error("Failed to fetch services:", err);
        setError("Failed to load services. Please try again later.");
      } finally {
        setLoading(false);
      }
    };

    fetchServices();
  }, []); // Empty dependency array means this runs once on mount

  // Find the currently selected product's data using 'serviceId' as the key
  const selectedProduct = servicesData.find(p => p.serviceId === formData.serviceId);

  // Access min and max using 'min' and 'max' keys, parse to integer
  // Provide sensible defaults if no product is selected yet
  const minQuantity = selectedProduct ? parseInt(selectedProduct.min, 10) : 1;
  const maxQuantity = selectedProduct ? parseInt(selectedProduct.max, 10) : 100000;

  // The backend is the only authority on price. Ask it for a quote rather than
  // multiplying the catalogue rate here, so the amount shown before paying is
  // produced by the same code path that debits the wallet at checkout.
  useEffect(() => {
    if (!formData.serviceId || !formData.quantity || formData.quantity < 1) {
      setQuote(null);
      setQuoteError(null);
      setQuoteLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setQuoteLoading(true);
      const result = await serviceApi.quoteOrder({
        serviceId: formData.serviceId,
        quantity: formData.quantity,
        runs: formData.runs,
        interval: formData.runs > 1 ? formData.interval : undefined,
        linkInput: formData.linkInput || undefined,
      }, { signal: controller.signal });

      if (controller.signal.aborted || result.canceled) return;
      if (result.success) {
        setQuote(result.data);
        setQuoteError(null);
      } else {
        setQuote(null);
        setQuoteError(result.message || 'Could not price this order');
      }
      setQuoteLoading(false);
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [formData.serviceId, formData.quantity, formData.runs, formData.interval, formData.linkInput]);

  // Handle input changes
  const handleChange = (e) => {
    const { name, value } = e.target;

    setFormData((prevData) => {
      let newValue = value;
      if (['quantity', 'runs', 'interval'].includes(name)) {
        const numValue = parseInt(value, 10);
        // Ensure quantity is a valid number; if not, default to 1 or previous valid value
        if (isNaN(numValue)) {
            newValue = ''; // Allow empty input temporarily if user is deleting
        } else {
            // Apply min/max bounds only if a product is selected
            if (name === 'quantity' && selectedProduct) {
                if (numValue < parseInt(selectedProduct.min, 10)) newValue = numValue;
                else if (numValue > parseInt(selectedProduct.max, 10)) newValue = parseInt(selectedProduct.max, 10);
                else newValue = numValue;
            } else if (name === 'runs') {
                newValue = Math.min(100, Math.max(1, numValue));
            } else if (name === 'interval') {
                newValue = Math.min(43200, Math.max(1, numValue));
            } else {
                // If no product selected, apply general min/max (or no limits)
                if (numValue < 1) newValue = 1;
                else newValue = numValue;
            }
        }
      }
      return {
        ...prevData,
        [name]: newValue,
      };
    });
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Without this, a second click while the first request is still in
    // flight starts a second toast.loading() with its own toastId. If the
    // first request never settles, its toast is orphaned forever even
    // though the second one completes and closes normally -- which looks
    // exactly like a stuck submission even after an order has succeeded.
    if (submitting) return;

    // Basic client-side validation before sending
    if (!formData.serviceId) {
      toast.error("Please select a product/service.");
      return;
    }
    if (!selectedProduct) {
        toast.error("Selected service details are missing. Please re-select.");
        return;
    }
    if (formData.quantity < minQuantity || formData.quantity > maxQuantity) {
        toast.error(`Quantity must be between ${minQuantity} and ${maxQuantity}.`);
        return;
    }
    if (!Number.isInteger(formData.runs) || formData.runs < 1 || formData.runs > 100) {
        toast.error('Runs must be between 1 and 100.');
        return;
    }
    if (formData.runs > 1 && (!Number.isInteger(formData.interval) || formData.interval < 1 || formData.interval > 43200)) {
        toast.error('Interval must be between 1 and 43200 minutes.');
        return;
    }
    if (!formData.linkInput.trim()) {
        toast.error("Link is required.");
        return;
    }

    // The backend is authoritative for provider mapping, rate, refill, and total.
    const orderData = {
      linkInput: formData.linkInput,
      serviceId: formData.serviceId,
      quantity: formData.quantity,
      runs: formData.runs,
      interval: formData.runs > 1 ? formData.interval : undefined,
    };

    let loadingToastId;
    setSubmitting(true);
    try {
      // Show loading toast immediately
      loadingToastId = toast.loading("Placing your order...", {
        autoClose: false, // Keep open until success/error
      });

      const response = await serviceApi.placeOrder(orderData, idempotencyKey);
      if (response.data?.orderId) await auth.refreshAuth();

      // If response contains an error, show error toast and return
      if (response && !response.success) {
        toast.update(loadingToastId, {
          render: `Order failed: ${response.message}`,
          type: "error",
          isLoading: false,
          autoClose: 5000,
          closeButton: true,
        });
        if (response.data?.code === 'PROVIDER_REJECTED') {
          setIdempotencyKey(crypto.randomUUID());
        }
        return;
      }

      if (response.data?.code === 'RECONCILIATION_REQUIRED') {
        toast.update(loadingToastId, {
          render: 'Order recorded, but provider confirmation is uncertain. Support will reconcile it; it will not be submitted again automatically.',
          type: 'warning',
          isLoading: false,
          autoClose: 8000,
          closeButton: true,
        });
        setIdempotencyKey(crypto.randomUUID());
        setFormData({
          linkInput: '',
          serviceId: '',
          quantity: 1,
          notes: '',
          runs: 1,
          interval: 60,
          totalAmount: 0,
        });
        return;
      }

      if (response.data?.code === 'PROVIDER_REJECTED') {
        toast.update(loadingToastId, {
          render: 'The provider rejected this order and the wallet debit was refunded.',
          type: 'error',
          isLoading: false,
          autoClose: 6000,
          closeButton: true,
        });
        setIdempotencyKey(crypto.randomUUID());
        return;
      }

      if (response.data?.code === 'MANUAL_ORDER_ACCEPTED') {
        toast.update(loadingToastId, {
          render: 'Order recorded for manual fulfilment. Progress will appear in your order timeline.',
          type: 'success',
          isLoading: false,
          autoClose: 5000,
          closeButton: true,
        });
        setFormData({ linkInput: '', serviceId: '', quantity: 1, runs: 1, interval: 60, notes: '', totalAmount: 0 });
        setQuote(null);
        setIdempotencyKey(crypto.randomUUID());
        return;
      }

      if (response.data?.code === 'ORDER_QUEUED') {
        toast.update(loadingToastId, {
          render: response.data.queueDispatchPending
            ? 'Order recorded. Background dispatch is waiting for the queue connection.'
            : 'Order recorded and queued for provider submission.',
          type: response.data.queueDispatchPending ? 'warning' : 'success',
          isLoading: false,
          autoClose: 5000,
          closeButton: true,
        });
        setFormData({ linkInput: '', serviceId: '', quantity: 1, runs: 1, interval: 60, notes: '', totalAmount: 0 });
        setQuote(null);
        setIdempotencyKey(crypto.randomUUID());
        return;
      }

      if (response.data?.code === 'DRIP_FEED_ORDER_ACCEPTED') {
        toast.update(loadingToastId, {
          render: response.data.queueDispatchPending
            ? 'Drip-feed order recorded. The first run is waiting for queue dispatch.'
            : 'Drip-feed order recorded and the first run is queued.',
          type: response.data.queueDispatchPending ? 'warning' : 'success',
          isLoading: false,
          autoClose: 5000,
          closeButton: true,
        });
        setFormData({ linkInput: '', serviceId: '', quantity: 1, runs: 1, interval: 60, notes: '', totalAmount: 0 });
        setQuote(null);
        setIdempotencyKey(crypto.randomUUID());
        return;
      }

      // Update toast on success
      toast.update(loadingToastId, {
        render: response.data?.idempotentReplay ? 'Order was already recorded.' : 'Order submitted successfully!',
        type: "success",
        isLoading: false,
        autoClose: 3000, // Close after 3 seconds
        closeButton: true,
      });

      // Optionally reset form after successful submission
      setFormData({
        linkInput: '',
        serviceId: '',
        quantity: 1,
        runs: 1,
        interval: 60,
        notes: '', // Reset notes field in state as well
        totalAmount: 0,
      });
      setIdempotencyKey(crypto.randomUUID());

    } catch (err) {
      console.error('Failed to submit order:', err);
      // Extract error message from response if available, otherwise use generic
      const errorMessage = err.response?.data?.message || err.message || 'An unexpected error occurred.';
      // Update toast on error
      if (loadingToastId) {
        toast.update(loadingToastId, {
          render: `Failed to submit order: ${errorMessage}`,
          type: "error",
          isLoading: false,
          autoClose: 5000, // Close after 5 seconds
          closeButton: true,
        });
      } else {
        toast.error(`Failed to submit order: ${errorMessage}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="card card-p space-y-4" role="status" aria-label="Loading services">
        <div className="skeleton h-5 w-40" />
        <div className="skeleton h-11 w-full" />
        <div className="skeleton h-11 w-full" />
        <div className="skeleton h-11 w-2/3" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card card-p">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-state-danger" aria-hidden="true" />
          <div>
            <p className="font-semibold text-ink">We could not load your services</p>
            <p className="mt-1 text-sm text-ink-muted">{error}</p>
            <button type="button" onClick={() => window.location.reload()} className="btn-secondary btn-sm mt-4">
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!servicesData.length) {
    return (
      <div className="empty-state">
        <PackageOpen className="h-10 w-10 text-ink-faint" aria-hidden="true" />
        <div>
          <p className="font-semibold text-ink">No services assigned yet</p>
          <p className="mt-1 text-sm text-ink-muted">
            Your account does not have any services enabled yet. Message us and we will set them up.
          </p>
        </div>
        <a
          href="https://wa.me/917906755171"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary btn-sm"
        >
          Ask on WhatsApp
        </a>
      </div>
    );
  }

  const totalMinor = quote ? quote.totalMinor : null;
  // Only warn about funds once the balance is actually known. Before the auth
  // context hydrates, wallet is undefined -- treating that as zero would block
  // ordering for a customer who has plenty of money. The server enforces the
  // real check either way; this is a courtesy so nobody submits a doomed order.
  const rawWallet = Number(auth.user?.wallet);
  const walletKnown = Number.isFinite(rawWallet);
  const walletMinor = walletKnown ? Math.round(rawWallet * 100) : 0;
  const shortBy = totalMinor === null ? 0 : totalMinor - walletMinor;
  const insufficient = walletKnown && totalMinor !== null && shortBy > 0;
  const isDrip = Number(formData.runs) > 1;
  const totalUnits = Number(formData.quantity || 0) * Number(formData.runs || 1);

  return (
    <div className="w-full">
      <ToastContainer
        position="top-center"
        autoClose={4000}
        newestOnTop
        closeOnClick
        pauseOnFocusLoss={false}
        draggable
        theme="light"
      />

      <form onSubmit={handleSubmit} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
        <div className="space-y-5">
          <section className="card card-p space-y-5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white">1</span>
              <h2 className="text-base font-semibold text-ink">Choose what you need</h2>
            </div>

            <div className="field">
              <label htmlFor="serviceId" className="label">Select Product/Service</label>
              <select
                id="serviceId"
                name="serviceId"
                value={formData.serviceId}
                onChange={handleChange}
                required
                className="select"
              >
                <option value="" disabled>Choose a product or service</option>
                {servicesData.map((product) => (
                  <option key={product.serviceId} value={product.serviceId}>
                    {product.name} (Rate: ₹{parseFloat(product.rate)} per 1000)
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="linkInput" className="label">Link</label>
              <input
                type="url"
                id="linkInput"
                name="linkInput"
                value={formData.linkInput}
                onChange={handleChange}
                required
                inputMode="url"
                autoComplete="off"
                className="input"
                placeholder="https://instagram.com/your-post"
              />
              <p className="hint">Paste the exact profile or post link this order should apply to.</p>
            </div>
          </section>

          <section className="card card-p space-y-5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white">2</span>
              <h2 className="text-base font-semibold text-ink">Set the quantity</h2>
            </div>

            <div className="field">
              <label htmlFor="quantity" className="label">Quantity per run</label>
              <input
                type="number"
                id="quantity"
                name="quantity"
                value={formData.quantity}
                onChange={handleChange}
                min={minQuantity}
                max={maxQuantity}
                required
                inputMode="numeric"
                className="input tnum"
                disabled={!formData.serviceId}
              />
              {selectedProduct && (
                <div>
                  <p className="hint">
                    Allowed range{' '}
                    <span className="tnum font-medium text-ink-soft">{minQuantity.toLocaleString('en-IN')}</span>
                    {' to '}
                    <span className="tnum font-medium text-ink-soft">{maxQuantity.toLocaleString('en-IN')}</span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {QUANTITY_PRESETS.filter((value) => value >= minQuantity && value <= maxQuantity).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setFormData((previous) => ({ ...previous, quantity: value }))}
                        className={
                          Number(formData.quantity) === value
                            ? 'rounded-lg border border-brand-magenta bg-brand-magenta/10 px-3 py-1.5 text-xs font-semibold text-brand-magenta'
                            : 'rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition-colors hover:border-brand-purple/50 hover:bg-surface-sunken'
                        }
                      >
                        {value.toLocaleString('en-IN')}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-line bg-surface-sunken p-4">
              <div className="field">
                <label htmlFor="runs" className="label">Runs</label>
                <input
                  type="number"
                  id="runs"
                  name="runs"
                  value={formData.runs}
                  onChange={handleChange}
                  min="1"
                  max="100"
                  required
                  inputMode="numeric"
                  className="input tnum"
                />
                <p className="hint">Use more than one run to create a drip-feed schedule.</p>
              </div>

              {isDrip && (
                <div className="field mt-4 border-t border-line pt-4">
                  <label htmlFor="interval" className="label">Interval (minutes)</label>
                  <input
                    type="number"
                    id="interval"
                    name="interval"
                    value={formData.interval}
                    onChange={handleChange}
                    min="1"
                    max="43200"
                    required
                    inputMode="numeric"
                    className="input tnum"
                  />
                  <p className="hint">
                    {formData.runs} runs of {Number(formData.quantity || 0).toLocaleString('en-IN')}, delivered
                    every {formData.interval} minutes.
                  </p>
                </div>
              )}
            </div>

            <div className="field">
              <label htmlFor="notes" className="label">Notes (Optional)</label>
              <textarea
                id="notes"
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                rows={3}
                className="textarea"
                placeholder="Anything we should know about this order?"
              />
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24">
          <div className="card card-p space-y-4">
            <h2 className="text-base font-semibold text-ink">Order summary</h2>

            <dl>
              <div className="stack-row">
                <dt className="stack-key">Service</dt>
                <dd className="stack-val">
                  {selectedProduct ? selectedProduct.name : <span className="text-ink-faint">Not selected</span>}
                </dd>
              </div>
              <div className="stack-row">
                <dt className="stack-key">Quantity</dt>
                <dd className="stack-val tnum">
                  {Number(formData.quantity || 0).toLocaleString('en-IN')}
                  {isDrip && <span className="text-ink-muted"> x {formData.runs} runs</span>}
                </dd>
              </div>
              {isDrip && (
                <div className="stack-row">
                  <dt className="stack-key">Total units</dt>
                  <dd className="stack-val tnum">{totalUnits.toLocaleString('en-IN')}</dd>
                </div>
              )}
            </dl>

            <div className="rounded-xl bg-surface-sunken p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-ink-soft">Total</span>
                <span className="tnum text-2xl font-bold text-ink" data-testid="order-total">
                  {quoteLoading ? 'Calculating…' : quote ? `₹${(quote.totalMinor / 100).toFixed(2)}` : '—'}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
                Priced by our server, not your browser. This is exactly what will be charged.
              </p>
            </div>

            {quoteError && (
              <p
                role="alert"
                className="rounded-xl border border-state-danger/30 bg-state-danger-bg px-3 py-2.5 text-sm font-medium text-state-danger"
              >
                {quoteError}
              </p>
            )}

            {insufficient && (
              <div className="rounded-xl border border-state-warning/30 bg-state-warning-bg px-3 py-2.5">
                <p className="text-sm font-semibold text-state-warning">
                  You need ₹{(shortBy / 100).toFixed(2)} more
                </p>
                <p className="mt-0.5 text-xs text-state-warning">
                  Wallet balance ₹{(walletMinor / 100).toFixed(2)}
                </p>
                <Link to="/payments" className="btn-secondary btn-sm mt-3">
                  <Wallet className="h-4 w-4" aria-hidden="true" />
                  Add money
                </Link>
              </div>
            )}

            <button
              type="submit"
              disabled={!quote || quoteLoading || submitting || insufficient}
              className="btn-primary btn-block text-base"
            >
              {submitting ? 'Placing order…' : 'Submit Order'}
            </button>

            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-ink-muted">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-state-success" aria-hidden="true" />
              Refunded automatically if the provider rejects it
            </p>
          </div>
        </aside>
      </form>
    </div>
  );
}

export default OrderForm;
