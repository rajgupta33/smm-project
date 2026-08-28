import React, { useEffect, useState } from "react";
import ResponsiveNavbar from "../../components/NavBar";
import { toast } from "react-toastify";
import { Users, CreditCard, ShoppingCart, DollarSign, AlertTriangle, ShieldAlert } from "lucide-react";
import { analyticsApi } from "../../service/api";

export default function AdminOverviewPage() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                setStats(await analyticsApi.overview());
            } catch (err) {
                console.error(err);
                toast.error("Failed to load analytics");
            } finally {
                setLoading(false);
            }
        };
        fetchStats();
    }, []);

    const formatMoney = (minorUnits) => {
        return `₹${(minorUnits / 100).toFixed(2)}`;
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white font-sans">
            <ResponsiveNavbar />
            <div className="max-w-7xl mx-auto px-4 py-8">
                <h1 className="text-3xl font-bold mb-8">Admin Command Center</h1>
                
                {loading ? (
                    <div className="text-center text-gray-400 py-20">Loading metrics...</div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
                            
                            <div className="bg-gray-800 rounded-lg p-6 flex items-center shadow-lg border border-gray-700">
                                <div className="p-4 bg-blue-900 bg-opacity-50 text-blue-400 rounded-full mr-4">
                                    <Users size={28} />
                                </div>
                                <div>
                                    <p className="text-gray-400 text-sm font-semibold">Total Customers</p>
                                    <p className="text-3xl font-bold">{stats.totalCustomers}</p>
                                </div>
                            </div>
                            
                            <div className="bg-gray-800 rounded-lg p-6 flex items-center shadow-lg border border-gray-700">
                                <div className="p-4 bg-purple-900 bg-opacity-50 text-purple-400 rounded-full mr-4">
                                    <CreditCard size={28} />
                                </div>
                                <div>
                                    <p className="text-gray-400 text-sm font-semibold">Total Wallet Liability</p>
                                    <p className="text-3xl font-bold">{formatMoney(stats.walletLiability)}</p>
                                </div>
                            </div>
                            
                            <div className="bg-gray-800 rounded-lg p-6 flex items-center shadow-lg border border-gray-700">
                                <div className="p-4 bg-green-900 bg-opacity-50 text-green-400 rounded-full mr-4">
                                    <ShoppingCart size={28} />
                                </div>
                                <div>
                                    <p className="text-gray-400 text-sm font-semibold">Today's Orders</p>
                                    <p className="text-3xl font-bold">{stats.todaysOrders}</p>
                                </div>
                            </div>
                            
                            <div className="bg-gray-800 rounded-lg p-6 flex items-center shadow-lg border border-gray-700">
                                <div className="p-4 bg-emerald-900 bg-opacity-50 text-emerald-400 rounded-full mr-4">
                                    <DollarSign size={28} />
                                </div>
                                <div>
                                    <p className="text-gray-400 text-sm font-semibold">Today's Revenue</p>
                                    <p className="text-3xl font-bold">{formatMoney(stats.todaysRevenue)}</p>
                                    <p className="text-xs text-green-500 font-medium">Margin: {formatMoney(stats.todaysMargin)}</p>
                                </div>
                            </div>
                            
                            <div className="bg-gray-800 rounded-lg p-6 flex items-center shadow-lg border border-gray-700">
                                <div className="p-4 bg-orange-900 bg-opacity-50 text-orange-400 rounded-full mr-4">
                                    <AlertTriangle size={28} />
                                </div>
                                <div>
                                    <p className="text-gray-400 text-sm font-semibold">Pending Payments</p>
                                    <p className="text-3xl font-bold">{stats.pendingPayments}</p>
                                </div>
                            </div>
                            
                            <div className="bg-gray-800 rounded-lg p-6 flex items-center shadow-lg border border-red-900">
                                <div className="p-4 bg-red-900 bg-opacity-50 text-red-400 rounded-full mr-4">
                                    <ShieldAlert size={28} />
                                </div>
                                <div>
                                    <p className="text-red-400 text-sm font-semibold">Reconciliation Required</p>
                                    <p className="text-3xl font-bold text-red-400">{stats.reconciliationRequired}</p>
                                    <p className="text-xs text-gray-500">Orders stuck in limbo</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-6">
                            <h2 className="text-xl font-bold mb-4 flex items-center"><ShieldAlert size={20} className="mr-2 text-indigo-400"/> Provider Health Status</h2>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="text-gray-400 border-b border-gray-700">
                                            <th className="pb-3 pr-4">Provider Name</th>
                                            <th className="pb-3 pr-4">Status</th>
                                            <th className="pb-3 pr-4">Last Sync</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {stats.providers.map(p => (
                                            <tr key={p._id} className="border-b border-gray-750 hover:bg-gray-750">
                                                <td className="py-4 pr-4 font-medium">{p.name}</td>
                                                <td className="py-4 pr-4">
                                                    <span className={`px-2 py-1 rounded text-xs font-bold ${p.enabled && p.healthStatus !== 'UNAVAILABLE' ? 'bg-green-600' : 'bg-red-600'}`}>
                                                        {p.enabled ? p.healthStatus : 'DISABLED'}
                                                    </span>
                                                </td>
                                                <td className="py-4 pr-4 text-sm text-gray-400">
                                                    {new Date(p.updatedAt).toLocaleString()}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

