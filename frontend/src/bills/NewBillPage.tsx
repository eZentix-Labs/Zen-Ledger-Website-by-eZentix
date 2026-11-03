import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ChevronRight, Minus, Package, Plus, Printer, Trash2, UserPlus, X} from 'lucide-react';
import {useLanguage} from '../i18n';
import {Chip, ErrorState, METHOD_LABEL, Modal, PayChip, Skeleton, ToastHost, day, inr, useApi, useToast} from '../admin/ui';
import {get, newKey, send} from '../inventory/api';
import {billsApi} from './api';
import {printBill, whatsappLink} from './share';

type CatalogueItem = {id: string; name: string; sku: string; category: string; unit: string; design: string; pricePaise: number; gstRateBps: number | null; available: number; image: string | null};
type CustomerRow = {id: string; name: string; phone: string; address: string; balancePaise: number; salesmanName: string | null; lastBillDate: string | null};
type Line = {productId: string; qty: number};
type Draft = {customerId: string; lines: Line[]; pay: {amount: string; method: string; reference: string}; key: string};
const DRAFT_KEY = 'bills.newDraft';
const GST_FALLBACK_BPS = 1800;
const emptyDraft = (): Draft => ({customerId: '', lines: [], pay: {amount: '', method: 'cash', reference: ''}, key: newKey()});
/** GST is included in the price: taxable = amount × 100 / (100 + rate). Same estimate as the bill detail. */
const taxableOf = (amountPaise: number, rateBps: number | null) => Math.round(amountPaise * 10000 / (10000 + (rateBps ?? GST_FALLBACK_BPS)));

export function NewBillPage(props: {onClose: () => void; onCreated: (id: string) => void}) {
  return <ToastHost><NewBill {...props} /></ToastHost>;
}

function NewBill({onClose, onCreated}: {onClose: () => void; onCreated: (id: string) => void}) {
  const {t} = useLanguage();
  const toast = useToast();
  const me = useApi(() => get<{user: {id: string; name: string; role: string}}>('/api/me'), []);
  const cat = useApi(() => billsApi.catalogue<CatalogueItem[]>(), []);
  const cust = useApi(() => billsApi.customers<CustomerRow[]>(), []);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [restore, setRestore] = useState<Draft | null>(() => { try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); return d?.lines?.length || d?.customerId ? d : null; } catch { return null; } });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{id: string; number: string} | null>(null);
  const [confirm, setConfirm] = useState<null | 'print' | 'new' | 'view'>(null);
  const [addCustomer, setAddCustomer] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const qtyRefs = useRef(new Map<string, HTMLInputElement>());
  const byId = useMemo(() => new Map((cat.data || []).map(p => [p.id, p])), [cat.data]);
  const customer = cust.data?.find(c => c.id === draft.customerId) || null;
  const dirty = !!(draft.customerId || draft.lines.length);

  // autosave locally; warn before leaving with unsaved work
  useEffect(() => { if (restore || done) return; try { if (dirty) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); else localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }, [draft, dirty, restore, done]);
  useEffect(() => { const h = (e: BeforeUnloadEvent) => { if (dirty && !done) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h); }, [dirty, done]);

  const rows = draft.lines.map(l => ({...l, p: byId.get(l.productId)})).filter((r): r is Line & {p: CatalogueItem} => !!r.p);
  const totals = useMemo(() => {
    const amount = rows.reduce((a, r) => a + r.p.pricePaise * r.qty, 0);
    const taxable = rows.reduce((a, r) => a + taxableOf(r.p.pricePaise * r.qty, r.p.gstRateBps), 0);
    const gst = amount - taxable;
    return {amount, taxable, cgst: Math.floor(gst / 2), sgst: gst - Math.floor(gst / 2), qty: rows.reduce((a, r) => a + r.qty, 0), short: rows.filter(r => r.qty > r.p.available), noRate: rows.filter(r => r.p.gstRateBps == null).length};
  }, [rows]);
  const payPaise = Math.round((Number(draft.pay.amount) || 0) * 100);
  const payError = payPaise < 0 ? t('Amount cannot be negative') : payPaise > totals.amount ? `${t('Cannot exceed the grand total')} (${inr(totals.amount)})` : '';
  const payStatus = !totals.amount ? 'NA' : payPaise >= totals.amount ? 'PAID' : payPaise > 0 ? 'PARTIAL' : 'UNPAID';
  const canCreate = me.data?.user.role === 'owner';
  const ready = !!customer && rows.length > 0 && !payError && totals.short.length === 0 && canCreate;

  const addItem = useCallback((p: CatalogueItem) => {
    setDraft(d => {
      const ex = d.lines.find(l => l.productId === p.id);
      if (ex) { toast('ok', `${p.design || p.name}: ${t('already on the bill, quantity increased')}`); return {...d, lines: d.lines.map(l => l.productId === p.id ? {...l, qty: l.qty + 1} : l)}; }
      return {...d, lines: [...d.lines, {productId: p.id, qty: 1}]};
    });
    setTimeout(() => { const el = qtyRefs.current.get(p.id); el?.focus(); el?.select(); }, 0);
  }, [toast, t]);
  const setQty = (id: string, qty: number) => setDraft(d => ({...d, lines: d.lines.map(l => l.productId === id ? {...l, qty: Math.max(1, Math.min(10000, Math.round(qty) || 1))} : l)}));
  const remove = (id: string) => { setDraft(d => ({...d, lines: d.lines.filter(l => l.productId !== id)})); searchRef.current?.focus(); };

  const save = useCallback(async (then: 'print' | 'new' | 'view') => {
    if (!ready || busy) return;
    setBusy(true);
    let orderId = '';
    try {
      // Same steps a salesman order goes through, so stock checks, reservations and audit stay identical.
      const order = await send<{id: string}>('POST', '/api/orders', {customerId: draft.customerId, items: draft.lines.map(l => ({productId: l.productId, qty: l.qty}))}, `${draft.key}-order`);
      orderId = order.id;
      await send('PATCH', `/api/orders/${orderId}/status`, {status: 'Approved'}, `${draft.key}-approve`);
      let number = orderId.slice(-10).toUpperCase();
      try { const inv = await send<{number: string}>('POST', `/api/invoices/from-order/${orderId}`, undefined, `${draft.key}-invoice`); if (inv?.number) number = inv.number; } catch { /* invoice number is optional; the bill exists */ }
      if (payPaise > 0) await send('POST', '/api/sales/payments', {orderId, amount: payPaise / 100, method: draft.pay.method, reference: draft.pay.reference}, `${draft.key}-payment`);
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      toast('ok', `${t('Bill saved')}: ${number}`);
      if (then === 'new') { setDraft(emptyDraft()); setTimeout(() => searchRef.current?.focus(), 0); return; }
      if (then === 'print') { try { printBill(await billsApi.detail(orderId), t); } catch { /* print is best effort */ } }
      setDone({id: orderId, number});
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('Could not save the bill');
      toast('err', orderId ? `${t('The order was created but not finished')}: ${msg}. ${t('Open Orders to approve it.')}` : msg);
    } finally { setBusy(false); setConfirm(null); }
  }, [ready, busy, draft, payPaise, toast, t]);
  // Only risky case we can detect (no credit limits are recorded): adding unpaid money for a customer who already owes.
  const trySave = (then: 'print' | 'new' | 'view') => { if (customer && customer.balancePaise > 0 && payPaise < totals.amount) setConfirm(then); else void save(then); };

  // F2 = item search · Ctrl+Enter = save · Ctrl+Shift+Enter = save & new
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); trySave(e.shiftKey ? 'new' : 'view'); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  if (done) return <div className="zl bl-page"><section className="zl-card bl-done" role="status">
    <h2>{t('Bill saved')} <span className="mono">{done.number}</span></h2>
    <p>{t('Stock has been updated and the bill now counts as a sale.')}</p>
    <div className="zl-actions">
      <button type="button" className="zl-btn primary" onClick={() => onCreated(done.id)}>{t('View bill')}</button>
      <button type="button" className="zl-btn" onClick={() => billsApi.detail(done.id).then(b => printBill(b, t)).catch(() => toast('err', t('Could not load the bill')))}><Printer size={16} aria-hidden="true" />{t('Print / PDF')}</button>
      {customer?.phone && <a className="zl-btn" href={whatsappLink({customerPhone: customer.phone, customerName: customer.name, invoiceNumber: done.number, number: done.number, billDate: new Date().toISOString().slice(0, 10), totalPaise: totals.amount, paidPaise: payPaise, duePaise: totals.amount - payPaise})} target="_blank" rel="noopener noreferrer">{t('Share on WhatsApp')}</a>}
      <button type="button" className="zl-btn" onClick={() => { setDone(null); setDraft(emptyDraft()); }}>{t('New bill')}</button>
      <button type="button" className="zl-btn ghost" onClick={onClose}>{t('Back to bills')}</button>
    </div>
  </section></div>;

  return <div className="zl bl-page bl-new">
    <nav className="bl-crumbs" aria-label={t('Breadcrumb')}><button type="button" className="bl-link" onClick={() => { if (!dirty || window.confirm(t('Leave this bill? Your draft is kept and can be restored.'))) onClose(); }}>{t('Bills')}</button><ChevronRight size={14} aria-hidden="true" /><span>{t('New bill')}</span></nav>
    <div className="bl-newhead"><h1>{t('New bill')}</h1>
      <span className="bl-hints" aria-label={t('Keyboard shortcuts')}><span><kbd className="bl-kbd">F2</kbd> {t('add item')}</span><span><kbd className="bl-kbd">Enter</kbd> {t('next item')}</span><span><kbd className="bl-kbd">Ctrl</kbd>+<kbd className="bl-kbd">Enter</kbd> {t('save')}</span></span>
    </div>
    {restore && <div className="zl-summary bl-restore" role="alert"><span>{t('You have an unsaved bill from earlier.')}</span><span className="zl-actions"><button type="button" className="zl-btn sm primary" onClick={() => { setDraft(restore); setRestore(null); }}>{t('Restore draft')}</button><button type="button" className="zl-btn sm" onClick={() => { setRestore(null); try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }}>{t('Discard')}</button></span></div>}
    {me.data && !canCreate && <div className="zl-err" role="alert">{t('Only the owner can create bills at the moment (bills are created as approved orders).')}</div>}

    <div className="bl-newgrid">
      <div className="bl-newmain">
        <section className="zl-card" aria-labelledby="bl-cust-h">
          <div className="zl-card-h"><h3 id="bl-cust-h">{t('Customer')} <span className="red" aria-hidden="true">*</span></h3><button type="button" className="zl-btn sm" onClick={() => setAddCustomer(true)}><UserPlus size={15} aria-hidden="true" />{t('Add new customer')}</button></div>
          {cust.error ? <ErrorState error={cust.error} retry={() => void cust.reload()} /> : <CustomerPicker rows={cust.data || []} loading={cust.loading} value={draft.customerId} onChange={id => setDraft(d => ({...d, customerId: id}))} />}
          {customer && <div className="bl-strip">
            {customer.phone && <span>{t('Phone')} <b>{customer.phone}</b></span>}
            <span>{t('Outstanding')} <b className={customer.balancePaise > 0 ? 'amber' : ''}>{inr(customer.balancePaise)}</b></span>
            <span>{t('Last bill')} <b>{customer.lastBillDate ? day(customer.lastBillDate) : '—'}</b></span>
            {customer.salesmanName && <span>{t('Assigned salesman')} <b>{customer.salesmanName}</b></span>}
            <Chip tone="blue">{t('CGST + SGST (assumed)')}</Chip>
          </div>}
          <div className="bl-meta">
            <span>{t('Bill date')}: <b>{day(new Date().toISOString())}</b></span>
            <span>{t('Billed by')}: <b>{me.data?.user.name || '—'}</b></span>
          </div>
          <p className="zl-note">{t('GSTIN, place of supply, credit limit and due dates are not recorded for customers yet, so they are not shown or checked here.')}</p>
        </section>

        <section className="zl-card" aria-labelledby="bl-items-h">
          <div className="zl-card-h"><h3 id="bl-items-h">{t('Items')} <span className="red" aria-hidden="true">*</span></h3><small>{rows.length} {t('items')} · {totals.qty} {t('pcs')}</small></div>
          {cat.error ? <ErrorState error={cat.error} retry={() => void cat.reload()} /> : <ItemSearch inputRef={searchRef} items={cat.data || []} loading={cat.loading} onPick={addItem} />}
          {rows.length ? <div className="zl-table-wrap"><table className="zl-table bl-lines" onKeyDown={e => { if (e.key === 'Delete' && (e.target as HTMLElement).dataset.pid) { e.preventDefault(); remove((e.target as HTMLElement).dataset.pid!); } }}>
            <caption className="zl-sr">{t('Bill items')}</caption>
            <thead><tr><th>#</th><th>{t('Item')}</th><th className="r">{t('Qty')}</th><th className="r">{t('Rate (incl. GST)')}</th><th className="r">GST</th><th className="r">{t('Total')}</th><th><span className="zl-sr">{t('Remove')}</span></th></tr></thead>
            <tbody>{rows.map((r, i) => <tr key={r.productId}>
              <td className="num">{i + 1}</td>
              <td><div className="bl-item">{r.p.image ? <img src={r.p.image} alt="" width={32} height={32} loading="lazy" /> : <span className="bl-thumb" aria-hidden="true"><Package size={14} /></span>}<div><b className="mono">{r.p.design || r.p.sku}</b><small>{r.p.name}</small>{r.qty > r.p.available && <small className="red">{t('Only')} {r.p.available} {t('available')}</small>}</div></div></td>
              <td className="r"><span className="bl-stepper"><button type="button" aria-label={`${t('Decrease')} ${r.p.name}`} onClick={() => setQty(r.productId, r.qty - 1)}><Minus size={13} /></button><input ref={el => { if (el) qtyRefs.current.set(r.productId, el); else qtyRefs.current.delete(r.productId); }} data-pid={r.productId} className="zl-input num" type="number" min={1} inputMode="numeric" aria-label={`${t('Quantity of')} ${r.p.name}`} value={r.qty} onChange={e => setQty(r.productId, Number(e.target.value))} onKeyDown={e => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); searchRef.current?.focus(); } }} /><button type="button" aria-label={`${t('Increase')} ${r.p.name}`} onClick={() => setQty(r.productId, r.qty + 1)}><Plus size={13} /></button></span></td>
              <td className="r num">{inr(r.p.pricePaise)}</td>
              <td className="r num">{(r.p.gstRateBps ?? GST_FALLBACK_BPS) / 100}%{r.p.gstRateBps == null && <span className="amber" title={t('No GST rate recorded for this design; 18% assumed')}> *</span>}</td>
              <td className="r num"><b>{inr(r.p.pricePaise * r.qty)}</b></td>
              <td><button type="button" className="zl-iconbtn" aria-label={`${t('Remove')} ${r.p.name}`} onClick={() => remove(r.productId)}><Trash2 size={15} /></button></td>
            </tr>)}</tbody>
          </table></div> : <div className="zl-empty"><Package size={24} aria-hidden="true" /><div>{t('No items yet. Press F2 and type a design number.')}</div></div>}
          <p className="zl-note">{t('Rates are the design\'s price including GST and cannot be changed on a bill yet. Item and bill discounts, notes, transport charges and round-off are not recorded on bills yet.')}</p>
        </section>
      </div>

      <aside className="bl-newside" aria-label={t('Bill summary')}>
        <section className="zl-card">
          <div className="zl-card-h"><h3>{t('Bill summary')}</h3></div>
          <div className="zl-totals">
            <span>{t('Customer')}</span><b>{customer?.name || '—'}</b>
            <span>{t('Items')}</span><b>{rows.length} · {totals.qty} {t('pcs')}</b>
            <span>{t('Taxable value')} <small>({t('est.')})</small></span><b>{inr(totals.taxable)}</b>
            <span>CGST <small>({t('est.')})</small></span><b>{inr(totals.cgst)}</b>
            <span>SGST <small>({t('est.')})</small></span><b>{inr(totals.sgst)}</b>
            <span className="grand">{t('Grand total')}</span><b className="grand">{inr(totals.amount)}</b>
            {customer && <><span>{t('Previous outstanding')}</span><b>{inr(customer.balancePaise)}</b><span>{t('New outstanding after this bill')}</span><b className="amber">{inr(customer.balancePaise + totals.amount - Math.min(payPaise, totals.amount))}</b></>}
          </div>
          {totals.noRate > 0 && <p className="zl-note amber">{totals.noRate} {t('design(s) have no GST rate; 18% assumed for the estimate.')}</p>}
        </section>

        <section className="zl-card">
          <div className="zl-card-h"><h3>{t('Payment received now')}</h3>{totals.amount > 0 && <PayChip status={payStatus} />}</div>
          <div className="zl-actions bl-quick">
            <button type="button" className="zl-btn sm" disabled={!totals.amount} onClick={() => setDraft(d => ({...d, pay: {...d.pay, amount: (totals.amount / 100).toFixed(2)}}))}>{t('Full')}</button>
            <button type="button" className="zl-btn sm" disabled={!totals.amount} onClick={() => setDraft(d => ({...d, pay: {...d.pay, amount: (Math.round(totals.amount / 2) / 100).toFixed(2)}}))}>50%</button>
            <button type="button" className="zl-btn sm" onClick={() => setDraft(d => ({...d, pay: {...d.pay, amount: ''}}))}>{t('None (credit)')}</button>
          </div>
          <label className="zl-field"><span>{t('Amount (₹)')}</span><input className="zl-input num" type="number" min="0" step="0.01" inputMode="decimal" value={draft.pay.amount} aria-invalid={!!payError} aria-describedby="bl-pay-err" onChange={e => setDraft(d => ({...d, pay: {...d.pay, amount: e.target.value}}))} placeholder="0.00" /></label>
          {payError && <small id="bl-pay-err" className="red" role="alert">{payError}</small>}
          <label className="zl-field"><span>{t('Mode')}</span><select className="zl-select" value={draft.pay.method} onChange={e => setDraft(d => ({...d, pay: {...d.pay, method: e.target.value}}))}>{['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other'].map(m => <option key={m} value={m}>{t(METHOD_LABEL[m]!)}</option>)}</select></label>
          <label className="zl-field"><span>{t('Reference')} <small>({t('optional')})</small></span><input className="zl-input" value={draft.pay.reference} maxLength={80} placeholder={t('UTR / cheque no.')} onChange={e => setDraft(d => ({...d, pay: {...d.pay, reference: e.target.value}}))} /></label>
          {totals.amount > 0 && <p className="bl-balance">{t('Balance due on this bill')}: <b className={totals.amount - payPaise > 0 ? 'red' : 'green'}>{inr(Math.max(0, totals.amount - payPaise))}</b></p>}
        </section>

        <div className="bl-savebar">
          {totals.short.length > 0 && <small className="red" role="alert">{t('Not enough stock for')}: {totals.short.map(r => r.p.design || r.p.name).join(', ')}</small>}
          {!customer && rows.length > 0 && <small className="amber">{t('Choose a customer to save.')}</small>}
          <button type="button" className="zl-btn primary bl-save" disabled={!ready || busy} onClick={() => trySave('view')}>{busy ? t('Saving…') : <>{t('Save bill')} <kbd className="bl-kbd">Ctrl+Enter</kbd></>}</button>
          <span className="zl-actions"><button type="button" className="zl-btn sm" disabled={!ready || busy} onClick={() => trySave('print')}><Printer size={14} aria-hidden="true" />{t('Save & print')}</button><button type="button" className="zl-btn sm" disabled={!ready || busy} onClick={() => trySave('new')} title="Ctrl+Shift+Enter">{t('Save & new')}</button></span>
        </div>
      </aside>
    </div>

    {confirm && customer && <Modal title={t('Customer already owes money')} onClose={() => setConfirm(null)} busy={busy} footer={<><button type="button" className="zl-btn" onClick={() => setConfirm(null)}>{t('Go back')}</button><button type="button" className="zl-btn primary" disabled={busy} onClick={() => void save(confirm)}>{t('Save anyway')}</button></>}>
      <p>{customer.name} {t('already owes')} <b>{inr(customer.balancePaise)}</b>. {t('After this bill they will owe')} <b className="amber">{inr(customer.balancePaise + totals.amount - payPaise)}</b>.</p>
    </Modal>}
    {addCustomer && <AddCustomer onClose={() => setAddCustomer(false)} onAdded={id => { setAddCustomer(false); void cust.reload(true).then(() => setDraft(d => ({...d, customerId: id}))); }} />}
  </div>;
}

/** Type-to-search customer picker (name or phone), keyboard friendly. */
function CustomerPicker({rows, loading, value, onChange}: {rows: CustomerRow[]; loading: boolean; value: string; onChange: (id: string) => void}) {
  const {t} = useLanguage();
  const sel = rows.find(r => r.id === value);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const hits = useMemo(() => { const s = q.trim().toLowerCase(); return (s ? rows.filter(r => r.name.toLowerCase().includes(s) || r.phone.includes(s)) : rows).slice(0, 8); }, [rows, q]);
  if (loading) return <Skeleton h={40} r={10} />;
  return <div className="bl-combo">
    <input className="zl-input" role="combobox" aria-expanded={open} aria-controls="bl-cust-list" aria-label={t('Customer')} placeholder={sel ? sel.name : t('Type a customer name or phone')} value={open ? q : sel ? `${sel.name}${sel.phone ? ` · ${sel.phone}` : ''}` : q}
      onFocus={() => { setOpen(true); setQ(''); setI(0); }} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={e => { setQ(e.target.value); setI(0); setOpen(true); }}
      onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setI(v => Math.min(hits.length - 1, v + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setI(v => Math.max(0, v - 1)); } if (e.key === 'Enter' && hits[i]) { e.preventDefault(); onChange(hits[i]!.id); setOpen(false); (e.target as HTMLInputElement).blur(); } if (e.key === 'Escape') setOpen(false); }} />
    {sel && !open && <button type="button" className="zl-iconbtn bl-clear" aria-label={t('Clear customer')} onClick={() => onChange('')}><X size={14} /></button>}
    {open && <ul id="bl-cust-list" role="listbox" className="bl-menu-pop bl-list">{hits.length ? hits.map((r, k) => <li key={r.id} role="option" aria-selected={k === i} onMouseDown={e => { e.preventDefault(); onChange(r.id); setOpen(false); }}><b>{r.name}</b><small>{r.phone}{r.balancePaise > 0 ? ` · ${t('owes')} ${inr(r.balancePaise)}` : ''}</small></li>) : <li className="bl-muted">{t('No customer matches. Use “Add new customer”.')}</li>}</ul>}
  </div>;
}

/** Item search: type a design no. or name, Enter adds the highlighted result (↑/↓ to move). */
function ItemSearch({inputRef, items, loading, onPick}: {inputRef: React.RefObject<HTMLInputElement | null>; items: CatalogueItem[]; loading: boolean; onPick: (p: CatalogueItem) => void}) {
  const {t} = useLanguage();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const hits = useMemo(() => { const s = q.trim().toLowerCase(); if (!s) return []; return items.filter(p => `${p.design} ${p.sku} ${p.name} ${p.category}`.toLowerCase().includes(s)).sort((a, b) => Number(b.design.toLowerCase().startsWith(s)) - Number(a.design.toLowerCase().startsWith(s))).slice(0, 8); }, [items, q]);
  const pick = (p: CatalogueItem) => { onPick(p); setQ(''); setI(0); };
  const tone = (n: number) => n <= 0 ? 'red' : n <= 3 ? 'amber' : 'green';
  return <div className="bl-combo bl-itemsearch">
    <input ref={inputRef} className="zl-input" role="combobox" aria-expanded={hits.length > 0} aria-controls="bl-item-list" aria-label={t('Add item')} disabled={loading} placeholder={loading ? t('Loading designs…') : t('Type a design no. or name, then press Enter (F2)')} value={q}
      onChange={e => { setQ(e.target.value); setI(0); }}
      onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setI(v => Math.min(hits.length - 1, v + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setI(v => Math.max(0, v - 1)); } if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && hits[i]) { e.preventDefault(); pick(hits[i]!); } if (e.key === 'Escape') setQ(''); }} />
    {hits.length > 0 && <ul id="bl-item-list" role="listbox" className="bl-menu-pop bl-list">{hits.map((p, k) => <li key={p.id} role="option" aria-selected={k === i} onMouseDown={e => { e.preventDefault(); pick(p); }}>
      {p.image ? <img src={p.image} alt="" width={36} height={36} loading="lazy" /> : <span className="bl-thumb" aria-hidden="true"><Package size={14} /></span>}
      <span className="grow"><b className="mono">{p.design || p.sku}</b> {p.name}<small>{inr(p.pricePaise)} · GST {p.gstRateBps == null ? '—' : `${p.gstRateBps / 100}%`}</small></span>
      <Chip tone={tone(p.available)}>{p.available <= 0 ? t('Out of stock') : `${p.available} ${t('in stock')}`}</Chip>
    </li>)}</ul>}
    {q.trim() && !hits.length && <small className="bl-muted">{t('No design matches')} “{q}”.</small>}
  </div>;
}

function AddCustomer({onClose, onAdded}: {onClose: () => void; onAdded: (id: string) => void}) {
  const {t} = useLanguage();
  const toast = useToast();
  const [f, setF] = useState({name: '', phone: ''});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (f.name.trim().length < 2 || f.phone.replace(/\D/g, '').length < 5) return toast('err', t('Enter a name and a phone number'));
    setBusy(true);
    try { const c = await send<{id: string}>('POST', '/api/customers', {name: f.name.trim(), phone: f.phone.trim()}); toast('ok', `${t('Customer added')}: ${f.name.trim()}`); onAdded(c.id); }
    catch (e) { toast('err', e instanceof Error ? e.message : t('Could not add the customer')); } finally { setBusy(false); }
  };
  return <Modal title={t('Add new customer')} onClose={onClose} busy={busy} footer={<><button type="button" className="zl-btn" onClick={onClose}>{t('Cancel')}</button><button type="button" className="zl-btn primary" disabled={busy} onClick={() => void save()}>{t('Add customer')}</button></>}>
    <label className="zl-field"><span>{t('Name')} <span className="red" aria-hidden="true">*</span></span><input className="zl-input" value={f.name} onChange={e => setF({...f, name: e.target.value})} autoFocus /></label>
    <label className="zl-field"><span>{t('Phone')} <span className="red" aria-hidden="true">*</span></span><input className="zl-input" inputMode="tel" value={f.phone} onChange={e => setF({...f, phone: e.target.value})} /></label>
  </Modal>;
}
