import React, { useEffect, useState } from "react";
import ResponsiveNavbar from "../../components/NavBar";
import { toast } from "react-toastify";
import { CheckCircle, XCircle, Clock, UserCheck, AlertCircle } from "lucide-react";
import { manualTaskApi } from "../../service/api";

export default function ManualTasksPage() {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState("");
    const [selectedTask, setSelectedTask] = useState(null);
    const [notes, setNotes] = useState("");
    const [proof, setProof] = useState("");
    const [dueAt, setDueAt] = useState("");

    const fetchTasks = async () => {
        setLoading(true);
        try {
            const response = await manualTaskApi.list(statusFilter);
            setTasks(response.tasks);
        } catch (err) {
            console.error(err);
            toast.error("Failed to load tasks");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTasks();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter]);

    const handleAssign = async (taskId) => {
        try {
            await manualTaskApi.claim(taskId);
            toast.success("Task assigned to you");
            fetchTasks();
        } catch (err) {
            console.error(err);
            toast.error("Failed to assign task");
        }
    };

    const handleUpdate = async (status) => {
        if (!selectedTask) return;
        try {
            await manualTaskApi.update(selectedTask._id, {
                status,
                notes,
                proof,
                dueAt: dueAt ? new Date(dueAt).toISOString() : null,
            });
            toast.success(`Task marked as ${status}`);
            setSelectedTask(null);
            fetchTasks();
        } catch (error) {
            toast.error(error.response?.data?.error || "Failed to update task");
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white font-sans">
            <ResponsiveNavbar />
            <div className="max-w-6xl mx-auto px-4 py-8">
                <h1 className="text-3xl font-bold mb-6">Manual Fulfilment Tasks</h1>
                
                <div className="mb-6 flex items-center space-x-4">
                    <label htmlFor="manual-status-filter" className="text-gray-400">Filter by Status:</label>
                    <select 
                        id="manual-status-filter"
                        value={statusFilter} 
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="bg-gray-800 text-white border border-gray-700 rounded px-3 py-2"
                    >
                        <option value="">All</option>
                        <option value="PENDING">Pending</option>
                        <option value="ASSIGNED">Assigned</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="AWAITING_APPROVAL">Awaiting Approval</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="REJECTED">Rejected</option>
                        <option value="CANCELLED">Cancelled</option>
                    </select>
                </div>

                {loading ? (
                    <div className="text-center py-10">Loading tasks...</div>
                ) : (
                    <div className="overflow-x-auto bg-gray-800 rounded-lg shadow">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-gray-700">
                                    <th className="p-4 border-b border-gray-600">Order ID</th>
                                    <th className="p-4 border-b border-gray-600">Customer</th>
                                    <th className="p-4 border-b border-gray-600">Service</th>
                                    <th className="p-4 border-b border-gray-600">Quantity / Target</th>
                                    <th className="p-4 border-b border-gray-600">Assigned To</th>
                                    <th className="p-4 border-b border-gray-600">Status</th>
                                    <th className="p-4 border-b border-gray-600">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tasks.map(task => (
                                    <tr key={task._id} className="hover:bg-gray-750">
                                        <td className="p-4 border-b border-gray-700 font-mono text-sm">{task.orderId.orderId}</td>
                                        <td className="p-4 border-b border-gray-700">{task.orderId.user?.userId || 'Unknown'}</td>
                                        <td className="p-4 border-b border-gray-700">{task.orderId.service}</td>
                                        <td className="p-4 border-b border-gray-700">
                                            {task.orderId.quantity}<br/>
                                            <span className="text-xs text-gray-400">{task.orderId.target}</span>
                                        </td>
                                        <td className="p-4 border-b border-gray-700 text-sm">
                                            {task.assignedTo ? task.assignedTo.userId : <span className="text-gray-500">Unassigned</span>}
                                        </td>
                                        <td className="p-4 border-b border-gray-700">
                                            <span className={`px-2 py-1 rounded text-xs font-bold ${
                                                task.status === "COMPLETED" ? "bg-green-600" :
                                                task.status === "REJECTED" ? "bg-red-600" :
                                                task.status === "PENDING" ? "bg-yellow-600" : "bg-blue-600"
                                            }`}>
                                                {task.status}
                                            </span>
                                        </td>
                                        <td className="p-4 border-b border-gray-700">
                                            {!task.assignedTo && task.status === "PENDING" ? (
                                                <button onClick={() => handleAssign(task._id)} className="text-blue-400 hover:text-blue-300">
                                                    Claim
                                                </button>
                                            ) : (
                                                <button onClick={() => {
                                                    setSelectedTask(task);
                                                    setNotes(task.notes || "");
                                                    setProof(task.proof || "");
                                                    setDueAt(task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 16) : "");
                                                }} className="text-indigo-400 hover:text-indigo-300">
                                                    Manage
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {tasks.length === 0 && (
                                    <tr>
                                        <td colSpan="7" className="p-4 text-center text-gray-400">No tasks found.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {selectedTask && (
                <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
                    <div className="bg-gray-800 rounded-lg p-6 max-w-lg w-full">
                        <h2 className="text-2xl font-bold mb-4">Manage Task: {selectedTask.orderId.orderId}</h2>
                        
                        <div className="mb-4">
                            <label htmlFor="manual-target" className="block text-gray-400 text-sm mb-1">Target Link</label>
                            <input id="manual-target" type="text" readOnly value={selectedTask.orderId.target} className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-gray-300" />
                        </div>

                        <div className="mb-4">
                            <label htmlFor="manual-notes" className="block text-gray-400 text-sm mb-1">Admin Notes</label>
                            <textarea 
                                id="manual-notes"
                                value={notes} 
                                onChange={(e) => setNotes(e.target.value)}
                                maxLength={4000}
                                disabled={["COMPLETED", "REJECTED", "CANCELLED"].includes(selectedTask.status)}
                                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white h-24"
                                placeholder="Internal notes..."
                            />
                        </div>

                        <div className="mb-6">
                            <label htmlFor="manual-proof" className="block text-gray-400 text-sm mb-1">Proof of Delivery</label>
                            <input 
                                id="manual-proof"
                                type="url"
                                value={proof} 
                                onChange={(e) => setProof(e.target.value)}
                                maxLength={2000}
                                disabled={["COMPLETED", "REJECTED", "CANCELLED"].includes(selectedTask.status)}
                                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                                placeholder="URL to screenshot or delivery proof"
                            />
                        </div>

                        <div className="mb-6">
                            <label htmlFor="manual-due-at" className="block text-gray-400 text-sm mb-1">Due At</label>
                            <input
                                id="manual-due-at"
                                type="datetime-local"
                                value={dueAt}
                                onChange={(e) => setDueAt(e.target.value)}
                                disabled={["COMPLETED", "REJECTED", "CANCELLED"].includes(selectedTask.status)}
                                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                            />
                        </div>

                        <div className="flex flex-wrap gap-2 justify-end">
                            <button onClick={() => setSelectedTask(null)} className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded">Cancel</button>
                            {["ASSIGNED", "AWAITING_APPROVAL"].includes(selectedTask.status) && <button onClick={() => handleUpdate("IN_PROGRESS")} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white flex items-center">
                                <Clock size={16} className="mr-1"/> In Progress
                            </button>}
                            {selectedTask.status === "IN_PROGRESS" && <button onClick={() => handleUpdate("AWAITING_APPROVAL")} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded text-white flex items-center">
                                <AlertCircle size={16} className="mr-1"/> Await Approval
                            </button>}
                            {["IN_PROGRESS", "AWAITING_APPROVAL"].includes(selectedTask.status) && <button onClick={() => handleUpdate("COMPLETED")} className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded text-white flex items-center">
                                <CheckCircle size={16} className="mr-1"/> Complete
                            </button>}
                            {["ASSIGNED", "IN_PROGRESS", "AWAITING_APPROVAL"].includes(selectedTask.status) && <button onClick={() => handleUpdate("REJECTED")} className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded text-white flex items-center">
                                <XCircle size={16} className="mr-1"/> Reject (Refund)
                            </button>}
                            {["ASSIGNED", "IN_PROGRESS", "AWAITING_APPROVAL"].includes(selectedTask.status) && <button onClick={() => handleUpdate("CANCELLED")} className="px-4 py-2 bg-orange-700 hover:bg-orange-600 rounded text-white flex items-center">
                                <XCircle size={16} className="mr-1"/> Cancel (Refund)
                            </button>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

