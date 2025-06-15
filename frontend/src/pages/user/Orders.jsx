// src/pages/OrdersPage.jsx (or src/pages/Order.jsx)
import React, { useEffect, useState } from "react";
import OrderCard from "../../cards/OrderCard"; // Ensure this path is correct
import ResponsiveNavbar from "../../components/NavBar"; // Ensure this path is correct
import { serviceApi } from '../../service/api'; // Ensure this path is correct

export default function Orders() { // Renamed to OrdersPage for clarity
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchOrders = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await serviceApi.getOrders();
        const fetchedOrders = response.data.orders || response.data;
        setOrders(Array.isArray(fetchedOrders) ? fetchedOrders : []);
      } catch (err) {
        console.error("Failed to fetch orders:", err);
        setError("Failed to load your orders. Please try again later.");
      } finally {
        setLoading(false);
      }
    };
    fetchOrders();
  }, []);

  return (
    <div className="min-h-screenbg-gradient-to-br from-gray-900 to-black text-gray-100 font-inter antialiased flex flex-col"> {/* Using custom dark-background */}
      <ResponsiveNavbar />

      <main className="flex-grow max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 w-full" id="orders-main-content">
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-center mb-10 mt-4 sm:mt-8
                       text-transparent bg-clip-text bg-gradient-to-r from-primary-purple to-secondary-purple tracking-tight leading-tight select-none"> {/* Using custom purple gradient */}
          Your Order History
        </h1>

        {/* Loading State */}
        {loading && (
          <div className="flex justify-center items-center py-12">
            <svg className="animate-spin h-10 w-10 text-primary-purple" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="ml-4 text-primary-purple text-xl font-medium">
              Loading your orders...
            </p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="flex justify-center items-center py-12">
            <div className="bg-danger-red/40 border border-danger-red rounded-lg p-6 text-center shadow-lg max-w-md mx-auto"> {/* Using custom danger-red */}
              <p className="text-text-light text-lg font-semibold mb-2"> {/* Using custom text-light */}
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-8 h-8 inline-block mr-2 -mt-1">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.38 3.375 2.07 3.375h14.071c1.69 0 2.936-1.875 2.07-3.375L13.5 4.375c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                Oops!
              </p>
              <p className="text-text-light">{error}</p> {/* Using custom text-light */}
            </div>
          </div>
        )}

        {/* No Orders State */}
        {!loading && !error && orders.length === 0 && (
          <div className="flex justify-center items-center py-12">
            <div className="bg-dark-card backdrop-blur-sm shadow-xl rounded-2xl p-8 border border-primary-purple/40 max-w-lg mx-auto animate-fadeIn text-center"> {/* Using custom colors and fadeIn animation */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
                className="w-16 h-16 text-primary-purple mx-auto mb-6 opacity-80"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.75 3.104v5.433c0 .526.119 1.037.348 1.515l3.682 7.737a.75.75 0 0 1-1.045 1.054L8.85 18.067a.75.75 0 0 1-.223-.585v-5.433c0-.526-.119-1.037-.348-1.515l-3.682-7.737a.75.75 0 0 1 1.045-1.054L8.85 5.933a.75.75 0 0 1 .223.585Z"
                />
              </svg>
              <h2 className="text-3xl font-bold text-primary-purple mb-3">No Orders Placed Yet!</h2> {/* Using custom primary-purple */}
              <p className="text-lg text-text-dim leading-relaxed"> {/* Using custom text-dim */}
                It looks like you haven't placed any orders with us. Start exploring our services!
              </p>
              <button className="mt-8 px-6 py-3 bg-primary-purple text-text-light font-semibold rounded-lg shadow-md hover:bg-secondary-purple transition duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-secondary-purple focus:ring-opacity-75 animate-scaleUp"> {/* Using custom colors and scaleUp animation */}
                Explore Services
              </button>
            </div>
          </div>
        )}

        {/* Orders Grid */}
        {!loading && !error && orders.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 justify-items-center animate-slideInDown"> {/* Using slideInDown animation */}
            {orders.map((order) => (
              <OrderCard key={order.orderid} order={order} />
            ))}
          </div>
        )}
      </main>

      <footer className="text-center py-6 text-text-dim select-none mt-auto"> {/* Using custom text-dim */}
        &copy; {new Date().getFullYear()} OrderHub. All rights reserved.
      </footer>
    </div>
  );
}
