import {useState} from 'react';
import {MessageCircle, Printer, Wallet} from 'lucide-react';
import {useLanguage} from '../i18n';
import {Chip, Drawer, ErrorState, METHOD_LABEL, Modal, PayChip, Skeleton, StatusChip, dateTime, day, inr, useApi, useToast} from '../admin/ui';
import {todayIso} from '../inventory/api';
import {billsApi} from './api';
import {printBill, whatsappLink} from './share';

/** Right-hand bill detail. Opened from ?bill=ID, so it is shareable and keeps the list position. */
export function BillDrawer({id, onClose, onChanged}: {id: string; onClose: () => void; onChanged: () => void}) {
  const {t} = useLanguage();
  const toast = useToast();
  const {data: b, error, loading, reload} = useApi(() => billsApi.detail(id), [id]);
  const [pay, setPay] = useState({amount: '', method: 'cash', date: todayIso(), reference: ''});
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

  const recordPayment = async () => {
    if (!b) return;
    const amount = Number(pay.amount);
    if (!(amount > 0)) return toast('err', t('Enter the amount received'));
    if (Math.round(amount * 100) > b.duePaise) return toast('err', `${t('More than the balance due')} (${inr(b.duePaise)})`);
    setBusy(true);
    try {
      await billsApi.recordPayment(b.id, amount, pay.method, pay.reference, pay.date);
      toast('ok', `${t('Payment recorded')}: ₹${amount.toLocaleString('en-IN')}`);
      setPay({amount: '', method: pay.method, date: todayIso(), reference: ''});
      await reload(true); onChanged();
    } catch (e) { toast('err', e instanceof Error ? e.message : t('Could not record the payment')); } finally { setBusy(false); }
  };
  const cancelBill = async () => {
    if (!b || reason.trim().length < 3) return toast('err', t('Give a reason (at least 3 characters)'));
    setBusy(true);
    try { await billsApi.cancel(b.id, reason.trim()); toast('ok', `${t('Bill cancelled')}: ${b.invoiceNumber || b.number}`); setCancelOpen(false); await reload(true); onChanged(); }
    catch (e) { toast('err', e instanceof Error ? e.message : t('Could not cancel the bill')); } finally { setBusy(false); }
  };

  const title = b ? <>{t('Bill')} <span className="mono">{b.invoiceNumber || b.number}</span></> : t('Bill');
  return <>
    <Drawer title={title} onClose={onClose} busy={busy} aside={b && <span className="zl-actions zl-no-print">
      <button type="button" className="zl-iconbtn" aria-label={t('Print or save as PDF')} title={t('Print / PDF')} onClick={() => printBill(b, t)}><Printer size={17} /></button>
      <a className="zl-iconbtn" aria-label={t('Share on WhatsApp')} title={t('Share on WhatsApp')} href={b.customerPhone ? whatsappLink(b) : undefined} aria-disabled={!b.customerPhone} target="_blank" rel="noopener noreferrer"><MessageCircle size={17} /></a>
    </span>} footer={b?.can.cancel ? <button type="button" className="zl-btn danger sm" onClick={() => setCancelOpen(true)} disabled={busy}>{t('Cancel bill')}</button> : undefined}>
      {error ? <ErrorState error={error} retry={() => void reload()} /> : loading && !b ? <><Skeleton h={18} w="60%" /><div style={{height: 12}} /><Skeleton h={120} r={12} /><div style={{height: 12}} /><Skeleton h={160} r={12} /></> : b && <>
        <div className="bl-dhead">
          <span className="num">{day(b.billDate)}</span>
          {b.cancelled ? <Chip tone="grey" dot>{t('Cancelled')}</Chip> : <PayChip status={b.payStatus} />}
          {b.overdue && <Chip tone="red">{t('Overdue')} · {b.ageDays} {t('days')}</Chip>}
          <StatusChip status={b.status} />
        </div>

        <section className="zl-sec"><h4>{t('Customer')}</h4>
          <div className="bl-block"><b>{b.customer?.name || b.customerName}</b>
            {b.customer?.phone && <span>{b.customer.phone}</span>}{b.customer?.address && <span>{b.customer.address}</span>}
            {b.customer && <span>{t('Outstanding balance')}: <b className={b.customer.balancePaise > 0 ? 'red' : ''}>{inr(b.customer.balancePaise)}</b></span>}
            {b.salesmanName && <span>{t('Salesman')}: {b.salesmanName}</span>}
          </div>
        </section>

        <section className="zl-sec"><h4>{t('Items')}</h4>
          <div className="zl-table-wrap"><table className="zl-table bl-lines"><caption className="zl-sr">{t('Bill items')}</caption>
            <thead><tr><th>{t('Design')}</th><th>{t('Item')}</th><th className="r">{t('Qty')}</th><th className="r">{t('Rate')}</th><th className="r">GST</th><th className="r">{t('Amount')}</th></tr></thead>
            <tbody>{b.lines.map(l => <tr key={l.lineNo}><td className="mono">{l.design || l.sku || '—'}</td><td>{l.name}{l.returnedQty > 0 && <small className="bl-muted">{t('Returned')}: {l.returnedQty} · {inr(l.returnValuePaise)}</small>}</td><td className="r num">{l.qty}</td><td className="r num">{inr(l.ratePaise)}</td><td className="r num">{l.gstRateBps / 100}%{!l.gstRateKnown && <span className="amber" title={t('No GST rate recorded for this design; 18% assumed')}> *</span>}</td><td className="r num">{inr(l.totalPaise)}</td></tr>)}</tbody>
          </table></div>
        </section>

        <section className="zl-sec"><h4>{t('Totals')}</h4>
          <div className="zl-totals">
            <span>{t('Taxable value')} <small>({t('estimated')})</small></span><b>{inr(b.tax.taxablePaise)}</b>
            <span>CGST</span><b>{inr(b.tax.cgstPaise)}</b><span>SGST</span><b>{inr(b.tax.sgstPaise)}</b>
            <span className="grand">{t('Grand total')}</span><b className="grand">{inr(b.totalPaise)}</b>
            <span>{t('Returns / credit')}</span><b>{inr(b.returnedPaise)}</b>
            <span>{t('Paid')}</span><b className="green">{inr(b.paidPaise)}</b>
            <span>{t('Balance due')}</span><b className={b.duePaise > 0 ? 'red' : ''}>{inr(b.duePaise)}</b>
          </div>
          <p className="zl-note">{t('Prices include GST. The split is estimated from each design\'s GST rate, assuming CGST + SGST.')}{b.tax.missingRates > 0 && <> <span className="amber">{b.tax.missingRates} {t('design(s) have no GST rate; 18% assumed (*).')}</span></>} {t('Discounts and round-off are not recorded on bills yet.')}</p>
        </section>

        <section className="zl-sec"><h4>{t('Returns')}</h4>
          {b.returns.length ? <ul className="bl-pays">{b.returns.map(r => <li key={r.id}><span><b>{r.productName}</b> · {r.qty} {t('returned')} · {inr(r.valuePaise)}</span><small>{dateTime(r.returnedAt)}{r.by && ` · ${r.by}`}{r.reason && ` · ${r.reason}`}</small></li>)}</ul> : <p className="bl-muted">{t('No returns recorded yet.')}</p>}
        </section>

        <section className="zl-sec"><h4>{t('Payments')}</h4>
          {b.payments.length ? <ul className="bl-pays">{b.payments.map(p => <li key={p.id}><span><b className="num">{inr(p.amountPaise)}</b> · {t(METHOD_LABEL[p.method] || p.method)}{p.reference && ` · ${p.reference}`}</span><small>{day(p.paymentDate)}{p.recordedBy && ` · ${p.recordedBy}`}</small>{p.status !== 'VERIFIED' && <Chip tone={p.status === 'UNVERIFIED' ? 'amber' : 'grey'}>{p.status === 'UNVERIFIED' ? t('Awaiting check') : t(p.status)}</Chip>}</li>)}</ul> : <p className="bl-muted">{t('No payments against this bill yet.')}</p>}
          {b.can.recordPayment && <form className="bl-payform zl-no-print" onSubmit={e => { e.preventDefault(); void recordPayment(); }}>
            <label className="zl-field"><span>{t('Amount (₹)')}</span><input className="zl-input" type="number" min="0" step="0.01" inputMode="decimal" value={pay.amount} onChange={e => setPay({...pay, amount: e.target.value})} placeholder={(b.duePaise / 100).toFixed(2)} /></label>
            <label className="zl-field"><span>{t('Mode')}</span><select className="zl-select" value={pay.method} onChange={e => setPay({...pay, method: e.target.value})}>{['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other'].map(m => <option key={m} value={m}>{t(METHOD_LABEL[m]!)}</option>)}</select></label>
            <label className="zl-field"><span>{t('Date')}</span><input className="zl-input" type="date" max={todayIso()} value={pay.date} onChange={e => setPay({...pay, date: e.target.value})} /></label>
            <label className="zl-field"><span>{t('Reference')}</span><input className="zl-input" value={pay.reference} maxLength={80} onChange={e => setPay({...pay, reference: e.target.value})} placeholder={t('UTR / cheque no.')} /></label>
            <span className="zl-actions"><button type="button" className="zl-btn sm" onClick={() => setPay({...pay, amount: (b.duePaise / 100).toFixed(2)})}>{t('Full due')}</button><button type="submit" className="zl-btn primary sm" disabled={busy}><Wallet size={15} aria-hidden="true" />{t('Record payment')}</button></span>
          </form>}
        </section>

        <section className="zl-sec"><h4>{t('Timeline')}</h4>
          <ol className="zl-tl">
            <li>{t('Order placed')}<small>{dateTime(b.stamps.createdAt)}{b.salesmanName && ` · ${b.salesmanName}`}</small></li>
            {b.stamps.approvedAt && <li>{t('Billed (approved)')}<small>{dateTime(b.stamps.approvedAt)}</small></li>}
            {b.timeline.map((a, i) => <li key={i}>{a.description || a.type}<small>{dateTime(a.at)}{a.by && ` · ${a.by}`}</small></li>)}
            {b.stamps.dispatchedAt && <li>{t('Dispatched')}<small>{dateTime(b.stamps.dispatchedAt)}</small></li>}
            {b.stamps.deliveredAt && <li>{t('Delivered')}<small>{dateTime(b.stamps.deliveredAt)}</small></li>}
            {b.cancelled && <li>{t('Cancelled')}{b.stamps.reason && `: ${b.stamps.reason}`}</li>}
          </ol>
        </section>
      </>}
    </Drawer>
    {cancelOpen && b && <Modal title={`${t('Cancel bill')} ${b.invoiceNumber || b.number}?`} onClose={() => setCancelOpen(false)} busy={busy} footer={<><button type="button" className="zl-btn" onClick={() => setCancelOpen(false)}>{t('Keep bill')}</button><button type="button" className="zl-btn danger" onClick={() => void cancelBill()} disabled={busy}>{t('Cancel bill')}</button></>}>
      <p>{t('Stock comes back and the bill stops counting as a sale. This cannot be undone.')}</p>
      <label className="zl-field"><span>{t('Reason')}</span><textarea className="zl-input" rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder={t('e.g. Wrong customer selected')} autoFocus /></label>
    </Modal>}
  </>;
}
