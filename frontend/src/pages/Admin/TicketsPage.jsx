import { useCallback, useEffect, useRef, useState } from 'react';
import ResponsiveNavbar from '../../components/NavBar';
import { ticketApi } from '../../service/api';

const statuses = ['', 'OPEN', 'WAITING_FOR_SUPPORT', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'];
const newKey = () => globalThis.crypto?.randomUUID?.() || `ticket-admin-${Date.now()}-${Math.random()}`;

export default function TicketsPage() {
  const [status, setStatus] = useState('');
  const [tickets, setTickets] = useState([]);
  const [detail, setDetail] = useState(null);
  const [reply, setReply] = useState('');
  const [internalOnly, setInternalOnly] = useState(false);
  const [notice, setNotice] = useState('');
  const actionKey = useRef(newKey());

  const load = useCallback(async () => {
    try { setTickets(await ticketApi.listAdmin(status)); }
    catch { setNotice('Could not load tickets.'); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  async function open(id) {
    try { setDetail(await ticketApi.getAdmin(id)); setNotice(''); }
    catch { setNotice('Could not load ticket.'); }
  }
  async function update(data) {
    if (!detail) return;
    try {
      await ticketApi.updateAdmin(detail.ticket.publicTicketId, data, actionKey.current);
      actionKey.current = newKey(); await open(detail.ticket.publicTicketId); await load();
    } catch (error) { setNotice(error.response?.data?.error || 'Ticket update failed.'); }
  }
  async function send(event) {
    event.preventDefault();
    try {
      await ticketApi.adminReply(detail.ticket.publicTicketId, { message: reply, internalOnly }, actionKey.current);
      actionKey.current = newKey(); setReply(''); await open(detail.ticket.publicTicketId); await load();
    } catch (error) { setNotice(error.response?.data?.error || 'Reply failed.'); }
  }

  return <><ResponsiveNavbar /><main className="min-h-screen bg-surface-sunken p-5">
    <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[400px_1fr]">
      <section><div className="flex items-center justify-between gap-3"><h1 className="text-3xl font-bold text-ink">Support tickets</h1>
        <select aria-label="Filter tickets" value={status} onChange={(event) => setStatus(event.target.value)}
          className="rounded border border-line bg-surface p-2">{statuses.map((value) => <option key={value} value={value}>{value || 'ALL'}</option>)}</select></div>
        <div className="mt-5 space-y-2">{tickets.map((ticket) => <button key={ticket.id} onClick={() => open(ticket.publicTicketId)}
          className="block w-full rounded-lg border border-line bg-surface p-3 text-left">
          <strong>{ticket.publicTicketId}</strong><span className="float-right text-xs">{ticket.priority}</span>
          <div className="text-sm">{ticket.customerId || ticket.userId} · {ticket.status}</div>
        </button>)}</div></section>
      <section className="rounded-2xl border border-line bg-surface p-6">
        {notice && <p role="status" className="mb-4 text-ink-soft">{notice}</p>}
        {!detail ? <p>Select a ticket.</p> : <><h2 className="text-2xl font-bold">{detail.ticket.publicTicketId}</h2>
          <p className="text-ink-soft">{detail.ticket.category} · {detail.ticket.status} · {detail.ticket.priority}</p>
          <div className="my-4 flex flex-wrap gap-2">
            <button onClick={() => update({ assignToSelf: true })} className="rounded bg-blue-700 px-3 py-2">Assign to me</button>
            {['WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'].map((value) => <button key={value} onClick={() => update({ status: value })}
              className="rounded bg-brand-gradient text-white px-3 py-2">{value}</button>)}
          </div>
          <div className="space-y-3">{detail.messages.map((message) => <article key={message.id}
            className={`rounded p-4 ${message.internalOnly ? 'border border-amber-700 bg-amber-950/50' : 'bg-surface'}`}>
            <strong>{message.senderType}{message.internalOnly ? ' · INTERNAL' : ''}</strong>
            <p className="whitespace-pre-wrap">{message.message}</p>
          </article>)}</div>
          {detail.ticket.status !== 'CLOSED' && <form onSubmit={send} className="mt-5 space-y-3">
            <textarea aria-label="Admin reply" required maxLength={4000} value={reply} onChange={(event) => setReply(event.target.value)}
              className="min-h-24 w-full rounded border border-line bg-surface p-3" />
            <label className="flex gap-2"><input type="checkbox" checked={internalOnly} onChange={(event) => setInternalOnly(event.target.checked)} />Internal note</label>
            <button className="rounded bg-brand-gradient text-white px-5 py-3 font-semibold">Send</button>
          </form>}
        </>}
      </section>
    </div>
  </main></>;
}
