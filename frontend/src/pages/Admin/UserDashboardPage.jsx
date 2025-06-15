import React, { useState } from 'react';
import { ToastContainer, toast } from 'react-toastify';
import { User, IndianRupee, ListOrdered, Receipt, RefreshCcw, Search, Menu, X, XCircle } from 'lucide-react';
import ResponsiveNavbar from '../../components/NavBar'
import {serviceApi} from '../../service/api'

const UserDashboardPage = () => {
    const [userIdInput, setUserIdInput] = useState('');
    const [selectedUserId, setSelectedUserId] = useState(null);
    const [userData, setUserData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    /**
     * Fetches user data (balance, orders, transactions) from the mock API.
     * @param {string} id - The user ID to fetch data for.
     */
    const fetchUserData = async (id) => {
        setLoading(true);
        setError(null);
        setUserData(null); // Clear previous user data
        try {
            const response = await serviceApi.getUser(id);
            setUserData(response.data);
            setSelectedUserId(id); // Set the successfully fetched user ID
            toast.success(`Data loaded for user: ${id}`, { theme: "dark" });
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to fetch user data. Please try again.');
            toast.error(err.response?.data?.message || 'Failed to fetch user data!', { theme: "dark" });
            setUserData(null);
            setSelectedUserId(null); // Clear selected user ID on error
        } finally {
            setLoading(false);
        }
    };

    /**
     * Handles the search button click or form submission.
     */
    const handleSearch = () => {
        if (!userIdInput.trim()) {
            toast.error('Please enter a User ID to search.', { theme: "dark" });
            return;
        }
        fetchUserData(userIdInput.trim());
    };

    // Helper function to format date strings
    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        const options = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
        return new Date(dateString).toLocaleDateString(undefined, options);
    };

    return (
        <div className="min-h-screen bg-gray-950 text-gray-100 font-inter antialiased">
            {/* Inline CSS for react-toastify and custom theme colors (similar to previous apps) */}
            <style>
                {`
                /* Custom Theme Colors */
                .bg-dark-background { background-color: #1a1a1a; } /* Near black */
                .bg-dark-card { background-color: #2a2a2a; } /* Slightly lighter black for cards */
                .text-text-light { color: #f5f3ff; } /* purple-50 */
                .text-text-dim { color: #a78bfa; } /* purple-400 */
                .bg-primary-purple { background-color: #8b5cf6; } /* purple-500 */
                .hover\\:bg-secondary-purple:hover { background-color: #7c3aed; } /* purple-600 */
                .border-primary-purple { border-color: #8b5cf6; } /* purple-500 */
                .text-danger-red { color: #ef4444; } /* red-500 */
                .border-danger-red { border-color: #ef4444; } /* red-500 */

                /* react-toastify custom theme */
                .Toastify__toast-container {
                    font-family: 'Inter', sans-serif;
                    z-index: 9999;
                }
                .Toastify__toast {
                    border-radius: 0.5rem; /* rounded-lg */
                    padding: 1rem;
                    display: flex;
                    align-items: center;
                    gap: 0.75rem; /* gap-3 */
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); /* shadow-md */
                    background-color: rgba(0, 0, 0, 0.9); /* bg-black/90 */
                    border: 1px solid rgba(76, 29, 149, 0.3); /* border-purple-900/30 */
                    color: #f5f3ff; /* text-white */
                }
                .Toastify__toast--success {
                    background-color: rgba(0, 0, 0, 0.9);
                    border-color: #10b981; /* green-500 */
                    color: #f5f3ff;
                }
                .Toastify__toast--error {
                    background-color: rgba(0, 0, 0, 0.9);
                    border-color: #ef4444; /* red-500 */
                    color: #f5f3ff;
                }
                .Toastify__progress-bar {
                    background-color: #a78bfa; /* purple-400 */
                }
                .Toastify__close-button {
                    color: #f5f3ff; /* white */
                    opacity: 0.7;
                }
                .Toastify__close-button:hover {
                    opacity: 1;
                }

                /* Loading spinner animation */
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .animate-spin-slow { animation: spin 2s linear infinite; }
                `}
            </style>

            {/* Navbar */}
            <ResponsiveNavbar/>

            {/* Main content area */}
            <main className="container mx-auto px-4 py-8">
                <div className="bg-dark-card p-8 rounded-lg shadow-2xl w-full max-w-2xl mx-auto border border-primary-purple">
                    <h1 className="text-3xl font-bold text-text-light mb-6 text-center">
                        User Dashboard
                    </h1>

                    {/* User ID Search Input */}
                    <div className="mb-8 flex flex-col sm:flex-row gap-4 items-center">
                        <div className="relative flex-grow w-full">
                            <input
                                type="text"
                                placeholder="Enter User ID (e.g., user123 or demoUser)"
                                className="w-full p-3 pl-10 bg-dark-background text-text-light border border-primary-purple rounded-md focus:outline-none focus:ring-2 focus:ring-primary-purple"
                                value={userIdInput}
                                onChange={(e) => setUserIdInput(e.target.value)}
                                onKeyPress={(e) => {
                                    if (e.key === 'Enter') {
                                        handleSearch();
                                    }
                                }}
                            />
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" size={20} />
                        </div>
                        <button
                            onClick={handleSearch}
                            className="w-full sm:w-auto flex items-center justify-center bg-primary-purple hover:bg-secondary-purple text-text-light font-semibold py-3 px-6 rounded-md transition duration-300 ease-in-out transform hover:scale-105 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={loading}
                        >
                            {loading ? (
                                <RefreshCcw className="animate-spin-slow mr-2" size={20} />
                            ) : (
                                <Search className="mr-2" size={20} />
                            )}
                            {loading ? 'Searching...' : 'Search User'}
                        </button>
                    </div>

                    {/* Loading, Error, or User Data Display */}
                    {loading && (
                        <div className="text-center py-12 text-text-dim">
                            <RefreshCcw className="animate-spin-slow mx-auto mb-4" size={48} />
                            <p>Loading user data for {userIdInput}...</p>
                        </div>
                    )}

                    {error && (
                        <div className="bg-danger-red/20 text-danger-red p-4 rounded-md flex items-center gap-3 mb-8">
                            <XCircle size={24} />
                            <p>{error}</p>
                        </div>
                    )}

                    {userData && (
                        <div className="space-y-8 mt-8">
                            {/* User Info & Balance */}
                            <div className="bg-dark-background p-6 rounded-lg border border-primary-purple/50 shadow-md">
                                <h2 className="text-2xl font-bold text-text-light mb-4 flex items-center">
                                    <User className="mr-2 text-primary-purple" size={24} /> User: {userData.userId}
                                </h2>
                                <div className="flex items-center text-text-light text-lg">
                                    <IndianRupee className="mr-2 text-primary-purple" size={24} /> {/* Changed to IndianRupee */}
                                    <strong>Balance:</strong> <span className="ml-2 font-medium">{userData.balance}</span>
                                </div>
                            </div>

                            {/* Orders Section */}
                            <div className="bg-dark-background p-6 rounded-lg border border-primary-purple/50 shadow-md">
                                <h2 className="text-2xl font-bold text-text-light mb-4 flex items-center">
                                    <ListOrdered className="mr-2 text-primary-purple" size={24} /> Orders
                                </h2>
                                {userData.orders && userData.orders.length > 0 ? (
                                    <div className="space-y-3">
                                        {userData.orders.map((order) => (
                                            // Using order._id for key as it's unique from MongoDB
                                            <div key={order._id} className="bg-dark-card p-4 rounded-md flex flex-col sm:flex-row justify-between items-start sm:items-center border border-primary-purple/30">
                                                <div className="mb-2 sm:mb-0">
                                                    <p className="font-semibold text-text-light">Order ID: {order.orderid}</p>
                                                    <p className="text-text-dim text-sm">Service: {order.service}</p>
                                                    <p className="text-text-dim text-sm">Qty: {order.quantity} | Rate: ₹{order.rate.toFixed(2)}</p>
                                                </div>
                                                <div className="text-left sm:text-right">
                                                    <p className="font-bold text-text-light">Total: ₹{(order.quantity * order.rate).toFixed(2)}</p>
                                                    <span className={`text-sm font-medium uppercase ${order.status === 'completed' ? 'text-green-500' : order.status === 'pending' ? 'text-yellow-500' : 'text-blue-400'}`}>
                                                        {order.status}
                                                    </span>
                                                    <p className="text-text-dim text-xs mt-1">Date: {formatDate(order.date)}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-text-dim text-center py-4">No orders found for this user.</p>
                                )}
                            </div>

                            {/* Transactions Section */}
                            <div className="bg-dark-background p-6 rounded-lg border border-primary-purple/50 shadow-md">
                                <h2 className="text-2xl font-bold text-text-light mb-4 flex items-center">
                                    <Receipt className="mr-2 text-primary-purple" size={24} /> Transactions
                                </h2>
                                {userData.transactions && userData.transactions.length > 0 ? (
                                    <div className="space-y-3">
                                        {userData.transactions.map((transaction) => (
                                            // Using transaction._id for key
                                            <div key={transaction._id} className="bg-dark-card p-4 rounded-md flex flex-col sm:flex-row justify-between items-start sm:items-center border border-primary-purple/30">
                                                <div className="mb-2 sm:mb-0">
                                                    <p className="font-semibold text-text-light">Type: {transaction.type}</p>
                                                    <p className="text-text-dim text-sm">Order ID: {transaction.orderId}</p>
                                                </div>
                                                <div className="text-left sm:text-right">
                                                    <p className={`font-bold ${transaction.amount < 0 ? 'text-red-500' : 'text-green-500'}`}>
                                                        Amount: ₹{transaction.amount.toFixed(2)}
                                                    </p>
                                                    <span className={`text-sm font-medium uppercase ${transaction.status === 'completed' ? 'text-green-500' : transaction.status === 'pending' ? 'text-yellow-500' : 'text-red-500'}`}>
                                                        Status: {transaction.status}
                                                    </span>
                                                    <p className="text-text-dim text-xs mt-1">Date: {formatDate(transaction.date)}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-text-dim text-center py-4">No transactions found for this user.</p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {/* React Toastify Container */}
            <ToastContainer
                position="top-right"
                autoClose={3000}
                hideProgressBar={false}
                newestOnTop={true}
                closeOnClick
                rtl={false}
                pauseOnFocusLoss
                draggable
                pauseOnHover
            />
        </div>
    );
};

export default UserDashboardPage;