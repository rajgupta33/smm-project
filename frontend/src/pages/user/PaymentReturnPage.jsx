import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ResponsiveNavbar from '../../components/NavBar';
import { useAuth } from '../../context/Authcontext';
import { paymentApi } from '../../service/api';

const terminal = new Set(['SUCCESS', 'FAILED', 'EXPIRED', 'REFUNDED', 'DISPUTED']);

export default function PaymentReturnPage() {
  const [params] = useSearchParams();
  const orderId = params.get('order_id');
  const [status, setStatus] = useState('PENDING');
  const [message, setMessage] = useState('We are confirming your payment with Cashfree…');
  const { refreshAuth } = useAuth();

  useEffect(() => {
    let cancelled = false;
    let timer;
    let attempts = 0;
    async function poll() {
      if (!orderId) {
        setMessage('The payment return link is missing its order reference.');
        return;
      }
      try {
        const payment = await paymentApi.getMine(orderId);
        if (cancelled) return;
        setStatus(payment.status);
        if (payment.status === 'SUCCESS') {
          setMessage('Payment verified. Your wallet has been credited.');
          await refreshAuth();
          return;
        }
        if (terminal.has(payment.status)) {
          setMessage(`Payment ended with status ${payment.status}. Your wallet was not credited.`);
          return;
        }
      } catch {
        if (cancelled) return;
      }
      attempts += 1;
      if (attempts < 20) timer = setTimeout(poll, 3000);
      else setMessage('Confirmation is still pending. Reconciliation will continue automatically.');
    }
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [orderId, refreshAuth]);

  return (
    <>
      <ResponsiveNavbar />
      <main className="flex min-h-screen items-start justify-center bg-surface-sunken p-8">
        <section className="mt-12 max-w-lg rounded-2xl border border-line bg-surface p-8 text-center">
          <p className="text-sm uppercase tracking-widest text-ink">{status}</p>
          <h1 className="mt-3 text-3xl font-bold">Payment confirmation</h1>
          <p role="status" className="mt-4 text-ink-soft">{message}</p>
          <Link to="/payments" className="mt-7 inline-block rounded-lg bg-brand-gradient text-white px-5 py-3 font-semibold">Back to payments</Link>
        </section>
      </main>
    </>
  );
}
