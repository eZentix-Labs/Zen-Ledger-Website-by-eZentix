import {useState} from 'react';
import {FileText, MessageCircle, Printer, Wallet} from 'lucide-react';
import {useLanguage} from '../i18n';
import {Chip, Drawer, ErrorState, METHOD_LABEL, Modal, PayChip, Skeleton, StatusChip, dateTime, day, inr, useApi, useToast} from '../admin/ui';
import {todayIso} from '../inventory/api';
import {FLOW, ordersApi, type OrderDetail, type OrderStatus} from './api';

const ACTION_LABEL: Record<OrderStatus, string> = {Pending: 'Pending', Approved: 'Approve', Processing: 'Start processing', Dispatched: 'Mark dispatched', Delivered: 'Mark delivered', Rejected: 'Reject', Cancelled: 'Cancel order'};
const NEEDS_REASON: OrderStatus[] = ['Rejected', 'Cancelled'];

/** Order detail opened from ?order=ID (shareable, keeps the list position) with every action the order allows. */
export function OrderDrawer({id, onClose, onChanged}: {id: string; onClose: () => void; onChanged: () => void}) {
  const {t} = useLanguage();
  const toast = useToast();
  const {data: o, error, loading, reload} = useApi(() => ordersApi.detail(id), [id]);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<OrderStatus | null>(null);
  const [reason, setReason] = useState('');
  const [pay, setPay] = useState({amount: '', method: 'cash', date: todayIso(), reference: ''});

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast('ok', ok); await reload(true); onChanged(); return true; }
    catch (e) { toast('err', e instanceof Error ? e.message : t('Something went wrong')); return false; } finally { setBusy(false); }
  };
  const move = async (to: OrderStatus) => {
    if (!o) return;
    if (NEEDS_REASON.includes(to) && reason.trim().length < 3) return toast('err', t('Give a reason (at least 3 characters)'));
    if (await act(() => ordersApi.setStatus(o.id, to, NEEDS_REASON.includes(to) ? reason.trim() : undefined), `${t('Order')} ${o.number}: ${t(to)}`)) { setAsk(null); setReason(''); }
  };
  const recordPayment = async () => {
    if (!o) return;
    const amount = Number(pay.amount);
    if (!(amount > 0)) return toast('err', t('Enter the amount received'));
    if (o.counted && Math.round(amount * 100) > o.duePaise) return toast('err', `${t('More than the balance due')} (${inr(o.duePaise)})`);
    if (await act(() => ordersApi.recordPayment(o.id, amount, pay.method, pay.reference, pay.date), `${t('Payment recorded')}: ₹${amount.toLocaleString('en-IN')}`)) setPay({amount: '', method: pay.method, date: todayIso(), reference: ''});
  };

  return <>
    <Drawer title={o ? <>{t('Order')} <span className="mono">{o.number}</span></> : t('Order')} onClose={onClose} busy={busy}
      aside={o && <span className="zl-actions zl-no-print">
        <button type="button" className="zl-iconbtn" aria-label={t('Print')} title={t('Print')} onClick={() => window.print()}><Printer size={17} /></button>
        <a className="zl-iconbtn" aria-label={t('Message customer on WhatsApp')} title={t('Message customer on WhatsApp')} href={o.customerPhone ? waLink(o) : undefined} aria-disabled={!o.customerPhone} target="_blank" rel="noopener noreferrer"><MessageCircle size={17} /></a>
      </span>}
      footer={o && o.can.changeStatus && o.next.length > 0 ? <span className="zl-actions">{o.next.map(n => <button key={n} type="button" disabled={busy} className={`zl-btn sm ${NEEDS_REASON.includes(n) ? 'danger' : n === o.next[0] ? 'primary' : ''}`} onClick={() => NEEDS_REASON.includes(n) ? setAsk(n) : void move(n)}>{t(ACTION_LABEL[n])}</button>)}</span> : undefined}>
      {error ? <ErrorState error={error} retry={() => void reload()} /> : loading && !o ? <><Skeleton h={40} r={10} /><div style={{height: 12}} /><Skeleton h={140} r={12} /><div style={{height: 12}} /><Skeleton h={160} r={12} /></> : o && <>
        <div className="bl-dhead"><StatusChip status={o.status} />{o.counted && <PayChip status={o.payStatus} />}{o.delayed && <Chip tone="red">{t('Delayed')} · {Math.round(o.ageHours)}h</Chip>}<span className="bl-muted">{t('Placed')} {dateTime(o.createdAt)}</span></div>
        <Stepper o={o} />
        {o.stamps.reason && ['Rejected', 'Cancelled'].includes(o.status) && <p className="zl-err" role="note">{t(o.status)}: {o.stamps.reason}</p>}

        <section className="zl-sec"><h4>{t('Customer')}</h4>
          <div className="bl-block"><b>{o.customer?.name || o.customerName}</b>
            {o.customer?.phone && <span>{o.customer.phone}</span>}{o.customer?.address && <span>{o.customer.address}</span>}
            {o.customer && <span>{t('Outstanding balance')}: <b className={o.customer.balance > 0 ? 'red' : ''}>{inr(Math.round(o.customer.balance * 100))}</b></span>}
            <span>{t('Salesman')}: {o.salesmanName || '—'}</span>
          </div>
        </section>

        <section className="zl-sec"><h4>{t('Items')} ({o.lines.length} · {o.qty} {t('pcs')})</h4>
          <div className="zl-table-wrap"><table className="zl-table bl-lines"><caption className="zl-sr">{t('Order items')}</caption>
            <thead><tr><th>SKU</th><th>{t('Item')}</th><th className="r">{t('Qty')}</th><th className="r">{t('Rate')}</th><th className="r">{t('Amount')}</th></tr></thead>
            <tbody>{o.lines.map(l => <tr key={l.productId}><td className="mono">{l.sku || '—'}</td><td>{l.name}<small className="bl-muted"> {l.category}</small></td><td className="r num">{l.qty}</td><td className="r num">{inr(Math.round(l.price * 100))}</td><td className="r num">{inr(l.lineTotalPaise)}</td></tr>)}</tbody>
          </table></div>
          <div className="zl-totals" style={{marginTop: 10}}>
            <span className="grand">{t('Order total')}</span><b className="grand">{inr(o.totalPaise)}</b>
            {o.counted ? <><span>{t('Paid')}</span><b className="green">{inr(o.paidPaise)}</b><span>{t('Balance due')}</span><b className={o.duePaise > 0 ? 'red' : ''}>{inr(o.duePaise)}</b></> : <><span>{t('Payment')}</span><b className="bl-muted">{t('Not billed yet')}</b></>}
          </div>
        </section>

        <section className="zl-sec"><h4>{t('Invoice')}</h4>
          {o.invoice ? <p className="bl-block"><span><FileText size={14} aria-hidden="true" /> <b className="mono">{o.invoice.number}</b> · {day(o.invoice.createdAt)} · {t(o.invoice.status)}</span></p>
            : o.can.invoice ? <button type="button" className="zl-btn sm" disabled={busy} onClick={() => void act(() => ordersApi.createInvoice(o.id), t('Invoice created'))}><FileText size={14} aria-hidden="true" />{t('Create invoice')}</button>
            : <p className="bl-muted">{o.counted ? t('No invoice number yet.') : t('An invoice can be created once the order is approved.')}</p>}
        </section>

        <section className="zl-sec"><h4>{t('Payments')}</h4>
          {o.payments.length ? <ul className="bl-pays">{o.payments.map(p => <li key={p.id}><span><b className="num">{inr(p.amountPaise)}</b> · {t(METHOD_LABEL[p.method] || p.method)}{p.reference && ` · ${p.reference}`}</span><small>{day(p.paymentDate)}{p.recordedBy && ` · ${p.recordedBy}`}</small>{p.status !== 'VERIFIED' && <Chip tone={p.status === 'UNVERIFIED' ? 'amber' : 'grey'}>{p.status === 'UNVERIFIED' ? t('Awaiting check') : t(p.status)}</Chip>}</li>)}</ul> : <p className="bl-muted">{t('No payments against this order yet.')}</p>}
          {o.can.recordPayment && o.counted && o.duePaise > 0 && <form className="bl-payform zl-no-print" onSubmit={e => { e.preventDefault(); void recordPayment(); }}>
            <label className="zl-field"><span>{t('Amount (₹)')}</span><input className="zl-input" type="number" min="0" step="0.01" inputMode="decimal" value={pay.amount} onChange={e => setPay({...pay, amount: e.target.value})} placeholder={(o.duePaise / 100).toFixed(2)} /></label>
            <label className="zl-field"><span>{t('Mode')}</span><select className="zl-select" value={pay.method} onChange={e => setPay({...pay, method: e.target.value})}>{Object.entries(METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></label>
            <label className="zl-field"><span>{t('Date')}</span><input className="zl-input" type="date" max={todayIso()} value={pay.date} onChange={e => setPay({...pay, date: e.target.value})} /></label>
            <label className="zl-field"><span>{t('Reference')}</span><input className="zl-input" value={pay.reference} maxLength={80} onChange={e => setPay({...pay, reference: e.target.value})} placeholder={t('UTR / cheque no.')} /></label>
            <span className="zl-actions"><button type="button" className="zl-btn sm" onClick={() => setPay({...pay, amount: (o.duePaise / 100).toFixed(2)})}>{t('Full due')}</button><button type="submit" className="zl-btn primary sm" disabled={busy}><Wallet size={15} aria-hidden="true" />{t('Record payment')}</button></span>
          </form>}
        </section>

        <section className="zl-sec"><h4>{t('Activity')}</h4>
          {o.timeline.length ? <ol className="zl-tl">{o.timeline.map((a, i) => <li key={i}>{a.description || a.type}<small>{dateTime(a.at)}{a.by && ` · ${a.by}`}</small></li>)}</ol> : <p className="bl-muted">{t('No activity recorded yet.')}</p>}
        </section>
      </>}
    </Drawer>
    {ask && o && <Modal title={`${t(ACTION_LABEL[ask])}: ${o.number}?`} onClose={() => setAsk(null)} busy={busy} footer={<><button type="button" className="zl-btn" onClick={() => setAsk(null)}>{t('Go back')}</button><button type="button" className="zl-btn danger" disabled={busy} onClick={() => void move(ask)}>{t(ACTION_LABEL[ask])}</button></>}>
      <p>{ask === 'Rejected' ? t('The salesman will see this reason. Reserved stock is released.') : t('Reserved stock is released and the order stops counting as a sale. This cannot be undone.')}</p>
      <label className="zl-field"><span>{t('Reason')}</span><textarea className="zl-input" rows={3} value={reason} onChange={e => setReason(e.target.value)} autoFocus /></label>
    </Modal>}
  </>;
}

/** Placed → Approved → Processing → Dispatched → Delivered, with the time each step happened. */
function Stepper({o}: {o: OrderDetail}) {
  const {t} = useLanguage();
  const stopped = o.status === 'Rejected' || o.status === 'Cancelled';
  const at = (s: OrderStatus) => s === 'Pending' ? o.stamps.createdAt : s === 'Approved' ? o.stamps.approvedAt : s === 'Dispatched' ? o.stamps.dispatchedAt : s === 'Delivered' ? o.stamps.deliveredAt : null;
  const idx = FLOW.indexOf(o.status as OrderStatus);
  return <ol className="or-steps" aria-label={t('Order progress')}>
    {FLOW.map((s, i) => { const done = !stopped && i <= idx || (stopped && !!at(s)); const now = !stopped && i === idx; return <li key={s} className={`${done ? 'done' : ''} ${now ? 'now' : ''}`} aria-current={now ? 'step' : undefined}>
      <i aria-hidden="true" /><b>{t(s === 'Pending' ? 'Placed' : s)}</b><small>{at(s) ? dateTime(at(s)) : done ? '✓' : '—'}</small>
    </li>; })}
    {stopped && <li className="stop"><i aria-hidden="true" /><b>{t(o.status)}</b><small>{o.stamps.closedAt ? dateTime(o.stamps.closedAt) : ''}</small></li>}
  </ol>;
}

function waLink(o: OrderDetail) {
  const digits = o.customerPhone.replace(/\D/g, ''), phone = digits.length === 10 ? `91${digits}` : digits;
  const rs = (p: number) => `₹${(p / 100).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  const text = [`Dear ${o.customerName},`, `Your order ${o.number} (${o.lines.length} item(s), ${rs(o.totalPaise)}) is now: ${o.status}.`, o.counted && o.duePaise > 0 ? `Balance due: ${rs(o.duePaise)}` : ''].filter(Boolean).join('\n');
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
