import { useCallback, useEffect, useRef, useState } from 'react';
import ResponsiveNavbar from '../../components/NavBar';
import { ticketApi } from '../../service/api';

const categories = [
  'DROP', 'PARTIAL', 'STUCK_ORDER', 'WRONG_SERVICE', 'CANCELLATION',
  'PAYMENT', 'REFUND', 'OTHER',
];
const newKey = () => globalThis.crypto?.randomUUID?.() || `ticket-${Date.now()}-${Math.random()}`;

export default function SupportPage() {
  const [tickets, setTickets] = useState([]);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({ category: 'OTHER', orderId: '', message: '' });
  const [reply, setReply] = useState('');
  const [notice, setNotice] = useState('');
  const createKey = useRef(newKey());
  const replyKey = useRef(newKey());

  const load = useCallback(async () => {
    try { setTickets(await ticketApi.listMine()); }
    catch { setNotice('Could not load support tickets.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function open(publicTicketId) {
    try { setDetail(await ticketApi.getMine(publicTicketId)); setNotice(''); }
    catch { setNotice('Could not load that ticket.'); }
  }

  async function createTicket(event) {
    event.preventDefault();
    try {
      const response = await ticketApi.create({
        category: form.category, orderId: form.orderId || undefined, message: form.message,
      }, createKey.current);
      createKey.current = newKey();
      setForm({ category: 'OTHER', orderId: '', message: '' });
      setNotice(`Ticket ${response.data.publicTicketId} created.`);
      await load();
      await open(response.data.publicTicketId);
    } catch (error) { setNotice(error.response?.data?.error || 'Could not create ticket.'); }
  }

  async function sendReply(event) {
    event.preventDefault();
    if (!detail) return;
    try {
      await ticketApi.reply(detail.ticket.publicTicketId, reply, replyKey.current);
      replyKey.current = newKey(); setReply('');
      await open(detail.ticket.publicTicketId); await load();
    } catch (error) { setNotice(error.response?.data?.error || 'Could not send reply.'); }
  }

  return <>
    <ResponsiveNavbar />
    <main className="min-h-screen bg-gradient-to-br from-black to-purple-950 p-4 text-white sm:p-8">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <form onSubmit={createTicket} className="space-y-4 rounded-2xl border border-purple-800 bg-black/70 p-5">
            <h1 className="text-2xl font-bold text-purple-300">Contact support</h1>
            <label className="block text-sm">Category
              <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}
                className="mt-1 w-full rounded border border-purple-700 bg-black p-3">
                {categories.map((category) => <option key={category}>{category}</option>)}
              </select>
            </label>
            <label className="block text-sm">Order ID (required for order issues)
              <input value={form.orderId} onChange={(event) => setForm({ ...form, orderId: event.target.value })}
                className="mt-1 w-full rounded border border-purple-700 bg-black p-3" />
            </label>
            <label className="block text-sm">Message
              <textarea required maxLength={4000} value={form.message}
                onChange={(event) => setForm({ ...form, message: event.target.value })}
                className="mt-1 min-h-32 w-full rounded border border-purple-700 bg-black p-3" />
            </label>
            <button className="w-full rounded bg-purple-600 p-3 font-semibold">Create ticket</button>
          </form>
          <section className="space-y-2">
            <h2 className="text-xl font-bold">Your tickets</h2>
            {tickets.map((ticket) => <button key={ticket.id} type="button" onClick={() => open(ticket.publicTicketId)}
              className="block w-full rounded-lg border border-purple-900 bg-black/60 p-3 text-left">
              <strong>{ticket.publicTicketId}</strong><span className="float-right text-xs">{ticket.status}</span>
              <div className="text-sm text-purple-200">{ticket.category}{ticket.orderId ? ` · ${ticket.orderId}` : ''}</div>
            </button>)}
          </section>
        </div>
        <section className="rounded-2xl border border-purple-800 bg-black/60 p-6">
          {notice && <p role="status" className="mb-4 text-purple-200">{notice}</p>}
          {!detail ? <p>Select a ticket to view the conversation.</p> : <>
            <div className="flex flex-wrap justify-between gap-3"><h2 className="text-2xl font-bold">{detail.ticket.publicTicketId}</h2>
              <span>{detail.ticket.status}</span></div>
            <div className="mt-6 space-y-3">{detail.messages.map((message) => <article key={message.id}
              className={`rounded-lg p-4 ${message.senderType === 'CUSTOMER' ? 'bg-purple-950' : 'bg-gray-800'}`}>
              <strong className="text-sm">{message.senderType}</strong><p className="mt-1 whitespace-pre-wrap">{message.message}</p>
              <time className="text-xs text-gray-400">{new Date(message.createdAt).toLocaleString()}</time>
            </article>)}</div>
            {detail.ticket.status !== 'CLOSED' && <form onSubmit={sendReply} className="mt-6 flex gap-2">
              <input aria-label="Reply message" required maxLength={4000} value={reply} onChange={(event) => setReply(event.target.value)}
                className="min-w-0 flex-1 rounded border border-purple-700 bg-black p-3" />
              <button className="rounded bg-purple-600 px-5 font-semibold">Reply</button>
            </form>}
          </>}
        </section>
      </div>
    </main>
  </>;
}
