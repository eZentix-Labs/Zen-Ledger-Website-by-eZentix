import React, {Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {BarChart3, Download, MoreHorizontal, Plus, Printer, ReceiptIndianRupee, Search, X} from 'lucide-react';
import {useLanguage} from '../i18n';
import {Chip, DataTable, EmptyState, ErrorState, KpiCard, KpiSkeletons, PageHeader, PayChip, PeriodSwitcher, Segmented, ToastHost, count, day, inr, periodRange, pct, useApi, useToast, type Column, type Period, type PeriodKey} from '../admin/ui';
import {billsApi, type Bill, type BillInsights, type Filters, type Tab} from './api';
import {BillDrawer} from './BillDrawer';
import {NewBillPage} from './NewBillPage';
import {useListState} from './url-state';
import {printBills, whatsappLink} from './share';
import '../admin/theme.css';
import './bills.css';

const BillCharts = lazy(() => import('./BillCharts'));
const COLS_KEY = 'bills.hiddenCols';
const INSIGHTS_KEY = 'bills.showInsights';
const delta = (cur: number, prev: number | null | undefined) => prev ? Math.round((cur - prev) / Math.abs(prev) * 1000) / 10 : null;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');

export function BillsPage() {
  return <ToastHost><BillsInner /></ToastHost>;
}

function BillsInner() {
  const {t} = useLanguage();
  const toast = useToast();
  const [s, patch] = useListState();
  const period: Period = useMemo(() => s.period === 'custom' ? periodRange('custom', {from: s.from, to: s.to}) : periodRange((s.period as PeriodKey) || 'month'), [s.period, s.from, s.to]);
  const filters: Filters = {from: period.from, to: period.to, q: s.q, tab: s.tab, salesman: s.salesman, customer: s.customer, min: s.min, max: s.max};
  const fKey = JSON.stringify(filters);
  const list = useApi(() => billsApi.list(filters, s.page, s.limit, s.sort, s.dir), [fKey, s.page, s.limit, s.sort, s.dir]);
  const ins = useApi(() => billsApi.insights(filters), [fKey]);
  const [search, setSearch] = useState(s.q);
  useEffect(() => { const id = setTimeout(() => { if (search !== s.q) patch({q: search}); }, 300); return () => clearTimeout(id); }, [search, s.q, patch]);
  const [showInsights, setShowInsights] = useState(() => { try { return localStorage.getItem(INSIGHTS_KEY) !== '0'; } catch { return true; } });
  const toggleInsights = () => setShowInsights(v => { try { localStorage.setItem(INSIGHTS_KEY, v ? '0' : '1'); } catch { /* ignore */ } return !v; });
  const [hidden, setHidden] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(COLS_KEY) || '[]')); } catch { return new Set(); } });
  useEffect(() => { try { localStorage.setItem(COLS_KEY, JSON.stringify([...hidden])); } catch { /* ignore */ } }, [hidden]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const reload = useCallback(() => { void list.reload(true); void ins.reload(true); }, [list, ins]);

  // N = new bill (when not typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !el.isContentEditable && s.view === 'list' && !s.bill) { e.preventDefault(); patch({view: 'new'}); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [patch, s.view, s.bill]);

  if (s.view === 'new') return <NewBillPage onClose={() => patch({view: 'list'})} onCreated={id => { patch({view: 'list', bill: id}); reload(); }} />;

  const d = list.data, x = ins.data, tot = x?.totals, prev = x?.previousTotals;
  const spark = (k: 'billed' | 'collected' | 'count') => x?.series?.[k];
  const sortBy = (k: string) => patch(s.sort === k ? {dir: s.dir === 'asc' ? 'desc' : 'asc'} : {sort: k, dir: k === 'customer' || k === 'number' ? 'asc' : 'desc'});
  const name = (id: string, xs?: Array<{id: string; name: string}>) => xs?.find(v => v.id === id)?.name || id;
  const chips: Array<{key: string; label: string; clear: Partial<typeof s>}> = [
    s.q && {key: 'q', label: `${t('Search')}: ${s.q}`, clear: {q: ''}},
    s.tab !== 'all' && {key: 'tab', label: tabLabel(s.tab, t), clear: {tab: 'all' as Tab}},
    s.salesman && {key: 'salesman', label: `${t('Salesman')}: ${name(s.salesman, d?.salesmen)}`, clear: {salesman: ''}},
    s.customer && {key: 'customer', label: `${t('Customer')}: ${name(s.customer, d?.customers)}`, clear: {customer: ''}},
    s.min && {key: 'min', label: `${t('Min')} ₹${Number(s.min).toLocaleString('en-IN')}`, clear: {min: ''}},
    s.max && {key: 'max', label: `${t('Max')} ₹${Number(s.max).toLocaleString('en-IN')}`, clear: {max: ''}},
  ].filter(Boolean) as Array<{key: string; label: string; clear: Partial<typeof s>}>;
  const clearAll = () => { setSearch(''); patch({q: '', tab: 'all', salesman: '', customer: '', min: '', max: ''}); };

  const columns: Column<Bill>[] = [
    {key: 'number', label: t('Bill no.'), sort: 'number', render: b => <span className="mono">{b.invoiceNumber || b.number}</span>},
    {key: 'date', label: t('Date'), sort: 'billDate', render: b => <span className="num">{day(b.billDate)}</span>},
    {key: 'customer', label: t('Customer'), sort: 'customer', render: b => <div className="bl-cell"><b>{b.customerName}</b>{b.customerPhone && <small>{b.customerPhone}</small>}</div>},
    {key: 'salesman', label: t('Salesman'), hideable: true, render: b => b.salesmanName ? <span className="bl-person"><span className="zl-avatar" aria-hidden="true">{initials(b.salesmanName)}</span>{b.salesmanName}</span> : <span className="bl-muted">—</span>},
    {key: 'items', label: t('Items'), sort: 'items', align: 'right', hideable: true, render: b => <span title={b.itemNames.join(', ')}>{b.lines}</span>},
    {key: 'total', label: t('Total'), sort: 'total', align: 'right', render: b => <b>{inr(b.totalPaise)}</b>, foot: d && <b>{inr(d.totals.billedPaise)}</b>},
    {key: 'paid', label: t('Paid'), sort: 'paid', align: 'right', hideable: true, render: b => inr(b.paidPaise), foot: d && inr(d.totals.collectedPaise)},
    {key: 'due', label: t('Due'), sort: 'due', align: 'right', render: b => <div className="bl-due"><span className={b.duePaise > 0 ? 'red' : 'bl-muted'}>{inr(b.duePaise)}</span>{b.billed && <PaidBar b={b} />}</div>, foot: d && <b className={d.totals.duePaise > 0 ? 'red' : ''}>{inr(d.totals.duePaise)}</b>},
    {key: 'status', label: t('Status'), render: b => <span className="bl-status">{b.cancelled ? <Chip tone="grey" dot>{t('Cancelled')}</Chip> : <PayChip status={b.payStatus} />}{b.overdue && <Chip tone="red">{t('Overdue')}</Chip>}</span>, foot: d && <span className="bl-muted">{count(d.totals.count)} {t('bills')}</span>},
    {key: 'actions', label: <span className="zl-sr">{t('Actions')}</span>, render: b => <RowMenu b={b} onOpen={() => patch({bill: b.id})} onPay={() => patch({bill: b.id})} />},
  ];
  const hideable = columns.filter(c => c.hideable);

  return <div className="zl bl-page">
    <PageHeader title={t('Bills')} subtitle={t('GST tax invoices with payment status')} actions={<>
      <PeriodSwitcher value={period} onChange={p => patch(p.key === 'custom' ? {period: 'custom', from: p.from, to: p.to} : {period: p.key, from: '', to: ''})} />
      <button type="button" className="zl-btn" onClick={() => billsApi.exportCsv(filters, s.sort, s.dir).then(() => toast('ok', t('Bills exported (CSV, opens in Excel)'))).catch(e => toast('err', e.message))} disabled={!d?.total}><Download size={16} aria-hidden="true" />{t('Export')}</button>
      <button type="button" className="zl-btn primary" onClick={() => patch({view: 'new'})} title={`${t('New bill')} (N)`}><Plus size={16} aria-hidden="true" />{t('New bill')} <kbd className="bl-kbd">N</kbd></button>
    </>} />

    {ins.error ? <ErrorState error={ins.error} retry={() => void ins.reload()} /> : !x ? <div className="zl-skel bl-sum-skel" aria-hidden="true" /> : <Summary x={x} period={period.key} onCustomer={id => patch({customer: id})} />}

    {ins.loading && !x ? <KpiSkeletons n={6} /> : tot && <div className="zl-kpis bl-kpis" role="group" aria-label={t('Key figures')}>
      <KpiCard label={t('Billed')} value={inr(tot.billedPaise)} delta={prev ? delta(tot.billedPaise, prev.billedPaise) : undefined} spark={spark('billed')} onClick={() => patch({tab: 'all'})} pressed={s.tab === 'all'} hint={t('this view')} />
      <KpiCard label={t('Collected')} value={inr(tot.collectedPaise)} delta={prev ? delta(tot.collectedPaise, prev.collectedPaise) : undefined} spark={spark('collected')} color="var(--green)" onClick={() => patch({tab: 'PAID'})} pressed={s.tab === 'PAID'} hint={tot.billedPaise ? `${pct(tot.collectedPaise / tot.billedPaise * 100, 0)} ${t('of billed')}` : undefined} />
      <KpiCard label={t('Due')} value={<span className={tot.duePaise ? 'red' : ''}>{inr(tot.duePaise)}</span>} delta={prev ? delta(tot.duePaise, prev.duePaise) : undefined} invert color="var(--red)" onClick={() => patch({tab: 'UNPAID'})} pressed={s.tab === 'UNPAID'} hint={t('unpaid + part paid')} />
      <KpiCard label={t('Number of bills')} value={count(tot.activeCount)} delta={prev ? delta(tot.activeCount, prev.activeCount) : undefined} spark={spark('count')} hint={tot.count > tot.activeCount ? `+${tot.count - tot.activeCount} ${t('cancelled')}` : undefined} />
      <KpiCard label={t('Average bill')} value={inr(tot.avgPaise)} delta={prev ? delta(tot.avgPaise, prev.avgPaise) : undefined} />
      <KpiCard label={`${t('Overdue')} (${x?.overdueDays}+ ${t('days')})`} value={<span className={tot.overduePaise ? 'amber' : ''}>{inr(tot.overduePaise)}</span>} invert color="var(--amber)" onClick={() => patch({tab: 'overdue'})} pressed={s.tab === 'overdue'} hint={`${count(tot.overdueCount)} ${t('bills')}`} />
    </div>}

    <div className="bl-toolbar">
      <button type="button" className="zl-btn ghost sm" aria-expanded={showInsights} onClick={toggleInsights}><BarChart3 size={15} aria-hidden="true" />{showInsights ? t('Hide insights') : t('Show insights')}</button>
    </div>
    {showInsights && <Suspense fallback={<div className="zl-skel bl-chart-skel" aria-hidden="true" />}>
      <BillCharts x={x} loading={ins.loading && !x} error={ins.error} retry={() => void ins.reload()} onCustomer={id => patch({customer: id})} onSalesman={id => patch({salesman: id})} onTab={tab => patch({tab})} />
    </Suspense>}

    <section className="zl-card bl-listcard">
      <div className="bl-tabs"><Segmented value={s.tab} onChange={v => patch({tab: v})} label={t('Payment status')} options={(['all', 'PAID', 'PARTIAL', 'UNPAID', 'overdue', 'cancelled'] as Tab[]).map(k => [k, tabLabel(k, t), d?.tabs[k]])} /></div>
      <div className="bl-filters">
        <label className="zl-search bl-search"><Search size={16} aria-hidden="true" /><input type="search" className="zl-input" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Search bill no., customer, phone or design')} aria-label={t('Search bills')} /></label>
        <select className="zl-select" value={s.salesman} onChange={e => patch({salesman: e.target.value})} aria-label={t('Salesman')}><option value="">{t('All salesmen')}</option>{d?.salesmen.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <select className="zl-select" value={s.customer} onChange={e => patch({customer: e.target.value})} aria-label={t('Customer')}><option value="">{t('All customers')}</option>{d?.customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <input className="zl-input bl-amt" type="number" min="0" inputMode="decimal" placeholder={t('Min ₹')} aria-label={t('Minimum bill amount')} value={s.min} onChange={e => patch({min: e.target.value})} />
        <input className="zl-input bl-amt" type="number" min="0" inputMode="decimal" placeholder={t('Max ₹')} aria-label={t('Maximum bill amount')} value={s.max} onChange={e => patch({max: e.target.value})} />
        <ColumnsMenu cols={hideable.map(c => [c.key, String(typeof c.label === 'string' ? c.label : c.key)])} hidden={hidden} onChange={setHidden} />
      </div>
      {chips.length > 0 && <div className="bl-chips" aria-label={t('Active filters')}>{chips.map(c => <span key={c.key} className="bl-chip">{c.label}<button type="button" aria-label={`${t('Remove filter')} ${c.label}`} onClick={() => { if (c.key === 'q') setSearch(''); patch(c.clear); }}><X size={12} /></button></span>)}<button type="button" className="zl-btn ghost sm" onClick={clearAll}>{t('Clear all')}</button></div>}
      {selected.size > 0 && d && <div className="bl-bulk" role="region" aria-label={t('Selected bills')}>
        <b>{selected.size} {t('selected')}</b>
        <button type="button" className="zl-btn sm" onClick={() => exportSelected(d.items.filter(b => selected.has(b.id)))}><Download size={14} aria-hidden="true" />{t('Export selected')}</button>
        <button type="button" className="zl-btn sm" onClick={() => printBills(d.items.filter(b => selected.has(b.id)), t)}><Printer size={14} aria-hidden="true" />{t('Print selected')}</button>
        <button type="button" className="zl-btn ghost sm" onClick={() => setSelected(new Set())}>{t('Clear')}</button>
      </div>}

      {list.error ? <ErrorState error={list.error} retry={() => void list.reload()} /> : <>
        <div className="zl-hide-sm" onKeyDown={rowArrows}>
          <DataTable rows={d?.items || []} columns={columns} hidden={hidden} sort={s.sort} dir={s.dir} onSort={sortBy} onRow={b => patch({bill: b.id})} activeId={s.bill || null} selected={selected} onSelect={setSelected} loading={list.loading && !d} caption={t('Bills')}
            empty={<EmptyState icon={<ReceiptIndianRupee size={26} aria-hidden="true" />} action={<span className="zl-actions"><button type="button" className="zl-btn primary sm" onClick={() => patch({view: 'new'})}>{t('Create bill')}</button>{chips.length > 0 && <button type="button" className="zl-btn sm" onClick={clearAll}>{t('Clear filters')}</button>}</span>}>{t('No bills in this period')}</EmptyState>} />
        </div>
        <div className="bl-mobile">
          {list.loading && !d ? <div className="zl-skel bl-chart-skel" aria-hidden="true" /> : d?.items.length ? <div className="zl-cards">{d.items.map(b => <button key={b.id} type="button" className="zl-ocard" onClick={() => patch({bill: b.id})}>
            <span className="top"><span className="mono">{b.invoiceNumber || b.number}</span>{b.cancelled ? <Chip tone="grey" dot>{t('Cancelled')}</Chip> : <PayChip status={b.payStatus} />}</span>
            <b>{b.customerName}</b>
            <span className="top"><span className="num">{inr(b.totalPaise)}</span>{b.duePaise > 0 && <span className="red num">{t('Due')} {inr(b.duePaise)}</span>}</span>
            <small>{day(b.billDate)}{b.salesmanName ? ` · ${b.salesmanName}` : ''}</small>
          </button>)}</div> : <EmptyState>{t('No bills in this period')}</EmptyState>}
          {d && d.total > 0 && <p className="bl-mobile-tot num">{count(d.totals.count)} {t('bills')} · {t('Total')} {inr(d.totals.billedPaise)} · {t('Due')} <span className="red">{inr(d.totals.duePaise)}</span></p>}
        </div>
        {d && d.total > 0 && <div className="zl-pager">
          <span>{t('Showing')} {(s.page - 1) * s.limit + 1}–{Math.min(d.total, s.page * s.limit)} {t('of')} {count(d.total)}</span>
          <span className="zl-actions">
            <label className="bl-size">{t('Rows per page')} <select className="zl-select" value={s.limit} onChange={e => patch({limit: Number(e.target.value)})}>{[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
            <button type="button" className="zl-btn sm" disabled={s.page <= 1} onClick={() => patch({page: s.page - 1})}>{t('Previous')}</button>
            <button type="button" className="zl-btn sm" disabled={s.page * s.limit >= d.total} onClick={() => patch({page: s.page + 1})}>{t('Next')}</button>
          </span>
        </div>}
      </>}
    </section>
    <small className="bl-foot">{t('A bill is an order once it is')} {d?.policy === 'DISPATCHED' ? t('dispatched') : t('approved')}. {t('Paid counts verified collections only.')} {t('Overdue = money still due')} {x?.overdueDays ?? 30}+ {t('days after the bill date (no due dates are recorded yet).')}</small>

    {s.bill && <BillDrawer id={s.bill} onClose={() => patch({bill: ''})} onChanged={reload} />}
  </div>;
}

function tabLabel(k: Tab, t: (s: string) => string) {
  return ({all: t('All'), PAID: t('Paid'), PARTIAL: t('Part paid'), UNPAID: t('Unpaid'), overdue: t('Overdue'), cancelled: t('Cancelled')})[k];
}

/** Paid share of a bill: bar + text (colour is never the only signal). */
function PaidBar({b}: {b: Bill}) {
  const p = b.totalPaise ? Math.min(100, Math.round(b.paidPaise / b.totalPaise * 100)) : 0;
  return <span className="bl-paidbar" title={`${p}% paid`}><i style={{width: `${p}%`}} /><span className="zl-sr">{p}% paid</span></span>;
}

function Summary({x, period, onCustomer}: {x: BillInsights; period: PeriodKey; onCustomer: (id: string) => void}) {
  const {t} = useLanguage();
  const tt = x.totals, top = x.topCustomersByDue[0];
  const when = ({today: t('Today'), week: t('This week'), month: t('This month'), year: t('This financial year'), custom: t('In this period')} as Record<PeriodKey, string>)[period];
  if (!tt.count) return <div className="zl-summary"><span className="k">{t('Summary')}</span>{when}, {t('no bills yet.')}</div>;
  return <div className="zl-summary" role="status">
    <span className="k">{t('Summary')}</span>
    {when} {t('you billed')} <b>{inr(tt.billedPaise)}</b> {t('across')} <b>{count(tt.activeCount)}</b> {t('bills')}
    {tt.collectedPaise > 0 && <>; <b>{inr(tt.collectedPaise)}</b> {t('is collected')}</>}
    {tt.duePaise > 0 ? <>; <span className="warn"><b>{inr(tt.duePaise)}</b> {t('is still due')}{top && <>, {t('mostly from')} <button type="button" className="bl-link" onClick={() => onCustomer(top.id)}>{top.name}</button> ({inr(top.duePaise)})</>}</span></> : <> {t('and nothing is due')}</>}.
    {tt.overdueCount > 0 && <> <span className="warn"><b>{count(tt.overdueCount)}</b> {tt.overdueCount === 1 ? t('bill is') : t('bills are')} {t('overdue')} ({x.overdueDays}+ {t('days')}).</span></>}
  </div>;
}

function RowMenu({b, onOpen, onPay}: {b: Bill; onOpen: () => void; onPay: () => void}) {
  const {t} = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', off); return () => document.removeEventListener('mousedown', off); }, [open]);
  const item = (label: string, fn: () => void, disabled = false) => <button type="button" role="menuitem" disabled={disabled} onClick={e => { e.stopPropagation(); setOpen(false); fn(); }}>{label}</button>;
  return <div className="bl-menu" ref={ref} onClick={e => e.stopPropagation()} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setOpen(false); }}>
    <button type="button" className="zl-iconbtn" aria-haspopup="menu" aria-expanded={open} aria-label={`${t('Actions for bill')} ${b.invoiceNumber || b.number}`} onClick={() => setOpen(v => !v)}><MoreHorizontal size={16} /></button>
    {open && <div role="menu" className="bl-menu-pop">
      {item(t('View'), onOpen)}
      {item(t('Record payment'), onPay, !b.billed || b.duePaise <= 0)}
      {item(t('Print'), () => printBills([b], t))}
      {item(t('Share on WhatsApp'), () => window.open(whatsappLink(b), '_blank', 'noopener'), !b.customerPhone)}
    </div>}
  </div>;
}

function ColumnsMenu({cols, hidden, onChange}: {cols: Array<[string, string]>; hidden: Set<string>; onChange: (s: Set<string>) => void}) {
  const {t} = useLanguage();
  return <details className="bl-cols">
    <summary className="zl-btn sm">{t('Columns')}</summary>
    <div className="bl-menu-pop" role="group" aria-label={t('Visible columns')}>
      {cols.map(([k, l]) => <label key={k}><input type="checkbox" className="zl-check" checked={!hidden.has(k)} onChange={e => { const n = new Set(hidden); if (e.target.checked) n.delete(k); else n.add(k); onChange(n); }} /> {l}</label>)}
    </div>
  </details>;
}

/** ↑ / ↓ move between table rows; Enter (handled by the table) opens the bill. */
function rowArrows(e: React.KeyboardEvent) {
  const row = (e.target as HTMLElement).closest('tr');
  if (!row || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
  const next = (e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling) as HTMLElement | null;
  if (next?.tagName === 'TR') { e.preventDefault(); next.focus(); }
}

function exportSelected(bills: Bill[]) {
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [['Bill no.', 'Bill date', 'Customer', 'Phone', 'Salesman', 'Items', 'Total (₹)', 'Paid (₹)', 'Due (₹)', 'Status'], ...bills.map(b => [b.invoiceNumber || b.number, b.billDate, b.customerName, b.customerPhone, b.salesmanName || '', b.lines, b.totalPaise / 100, b.paidPaise / 100, b.duePaise / 100, b.cancelled ? 'Cancelled' : b.payStatus])];
  const url = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n')], {type: 'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = `bills-selected-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
}
