let sdkPromise;

function loadCashfreeSdk() {
  if (window.Cashfree) return Promise.resolve(window.Cashfree);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
      script.async = true;
      script.onload = () => window.Cashfree
        ? resolve(window.Cashfree)
        : reject(new Error('Cashfree checkout did not initialize'));
      script.onerror = () => reject(new Error('Could not load Cashfree checkout'));
      document.head.appendChild(script);
    });
  }
  return sdkPromise;
}

export async function openCashfreeCheckout({ paymentSessionId, mode }) {
  if (!paymentSessionId) throw new Error('Payment session is not ready yet');
  const Cashfree = await loadCashfreeSdk();
  return Cashfree({ mode }).checkout({ paymentSessionId, redirectTarget: '_self' });
}
