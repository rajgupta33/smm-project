import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { serviceApi } from "../../service/api";
import ResponsiveNavbar from "../../components/NavBar";
import { ArrowLeft, Clock, MessageSquare, CreditCard, RefreshCcw } from "lucide-react";

export default function OrderDetailPage() {
    const { orderId } = useParams();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchTimeline = async () => {
            setLoading(true);
            const res = await serviceApi.getOrderTimeline(orderId);
            if (res.success) {
                setData(res.data);
            } else {
                setError(res.message);
            }
            setLoading(false);
        };
        fetchTimeline();
    }, [orderId]);

    const getEventIcon = (type) => {
        if (type.includes("TICKET") || type.includes("MESSAGE") || type.includes("NOTE")) return <MessageSquare size={16} />;
        if (type.includes("REFUND") || type.includes("FUNDS") || type.includes("PRICE")) return <CreditCard size={16} />;
        if (type.includes("REFILL")) return <RefreshCcw size={16} />;
        return <Clock size={16} />;
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white font-sans">
            <ResponsiveNavbar />
            <div className="max-w-4xl mx-auto px-4 py-8">
                <button onClick={() => navigate(-1)} className="flex items-center text-gray-400 hover:text-white mb-6">
                    <ArrowLeft size={16} className="mr-2" /> Back to Orders
                </button>

                {loading ? (
                    <div className="text-center py-10">Loading timeline...</div>
                ) : error ? (
                    <div className="text-red-400 text-center py-10">{error}</div>
                ) : (
                    <>
                        <div className="bg-gray-800 rounded-lg p-6 mb-8">
                            <h1 className="text-2xl font-bold mb-2">Order {data.order.localOrderId}</h1>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                                <div>
                                    <p className="text-gray-400 text-sm">Status</p>
                                    <p className="font-semibold">{data.order.lastStatus}</p>
                                </div>
                                <div>
                                    <p className="text-gray-400 text-sm">Quantity</p>
                                    <p className="font-semibold">{data.order.quantity}</p>
                                </div>
                                <div>
                                    <p className="text-gray-400 text-sm">Amount</p>
                                    <p className="font-semibold">₹{(data.order.pricingSnapshot?.sellingTotalMinor / 100).toFixed(2)}</p>
                                </div>
                            </div>
                        </div>

                        <h2 className="text-xl font-bold mb-6">Activity Timeline</h2>
                        <div className="relative pl-6 border-l border-gray-700">
                            {data.events.map((event, idx) => (
                                <div key={event._id || idx} className="mb-8 relative">
                                    <div className="absolute -left-10 bg-gray-700 p-2 rounded-full text-blue-400">
                                        {getEventIcon(event.eventType)}
                                    </div>
                                    <div className="bg-gray-800 p-4 rounded-lg ml-2">
                                        <div className="flex justify-between items-start mb-2">
                                            <h3 className="font-bold text-lg">{event.eventType.replace(/_/g, " ")}</h3>
                                            <span className="text-xs text-gray-400">
                                                {new Date(event.createdAt).toLocaleString()}
                                            </span>
                                        </div>
                                        {event.metadata && (
                                            <pre className="text-sm text-gray-300 bg-gray-900 p-2 rounded overflow-x-auto">
                                                {JSON.stringify(event.metadata, null, 2)}
                                            </pre>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {data.events.length === 0 && (
                                <p className="text-gray-400">No activity recorded yet.</p>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

