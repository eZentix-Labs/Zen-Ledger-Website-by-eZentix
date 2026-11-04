import React, {Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AlertTriangle, BarChart3, CalendarDays, Check, ChevronRight, Clock3, Download, IndianRupee, RefreshCw, Search, SlidersHorizontal, Truck, Wallet, X} from 'lucide-react';
import {useLanguage} from '../i18n';
import {DataTable, EmptyState, ErrorState, METHOD_LABEL, Modal, PageHeader, PayChip, PeriodSwitcher, StatCard, StatSkeletons, StatusChip, ToastHost, count, dateTime, day, inr, periodRange, useApi, useToast, type Column, type Period, type PeriodKey} from '../admin/ui';
import {previousWindow} from './period';
import {FLOW, ordersApi, type OrderFilters, type OrderRow, type OrderStatus} from './api';
import {OrderDrawer} from './OrderDrawer';
import '../admin/theme.css';
import '../bills/bills.css';
import './orders.css';

const OrderCharts = lazy(() => import('./OrderCharts'));
const KEY = 'orders.view';
const INSIGHTS_KEY = 'orders.showInsights';
const IN_PROGRESS = 'Approved,Processing,Dispatched';
/** Status filter values and their labels. */
const TABS: Array<[string, string]> = [['', 'All'], ['Pending', 'Pending'], [IN_PROGRESS, 'In progress'], ['Approved', 'Approved'], ['Processing', 'Processing'], ['Dispatched', 'Dispatched'], ['Delivered', 'Delivered'], ['Rejected,Cancelled', 'Rejected / cancelled']];
/** The stage strip: [filter value, label, dot tone, part of the order flow]. */
const STAGES: Array<[string, string, string, boolean]> = [['', 'All', 'total', false], ['Pending', 'Pending', 'amber', true], ['Approved', 'Approved', 'blue', true], ['Processing', 'Processing', 'violet', true], ['Dispatched', 'Dispatched', 'cyan', true], ['Delivered', 'Delivered', 'green', true], ['Rejected,Cancelled', 'Rejected / cancelled', 'red', false]];
const NEXT_ACTION: Partial<Record<OrderStatus, [OrderStatus, string]>> = {Pending: ['Approved', 'Approve'], Approved: ['Dispatched', 'Dispatch'], Processing: ['Dispatched', 'Dispatch'], Dispatched: ['Delivered', 'Mark delivered']};
const delta = (cur: number, prev: number | null | undefined) => prev ? Math.round((cur - prev) / Math.abs(prev) * 1000) / 10 : null;
const ago = (h: number) => h < 1 ? '<1h' : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;

type State = {period: string; from: string; to: string; q: string; status: string; pay: string; method: string; salesman: string; min: string; max: string; delayed: boolean; sort: string; dir: 'asc' | 'desc'; page: number; limit: number; order: string};
const DEFAULTS: State = {period: 'month', from: '', to: '', q: '', status: '', pay: '', method: '', salesman: '', min: '', max: '', delayed: false, sort: 'createdAt', dir: 'desc', page: 1, limit: 25, order: ''};

/** Page state mirrored to the URL (shareable, survives refresh) and remembered locally. */
function useOrdersState() {
  const [s, set] = useState<State>(() => {
    const p = new URLSearchParams(window.location.search);
    let saved: Partial<State> = {};
    if (![...p.keys()].length) { try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* ignore */ } }
    const g = (k: keyof State) => p.get(k) ?? (saved[k] !== undefined ? String(saved[k]) : String(DEFAULTS[k]));
    return {period: g('period'), from: g('from'), to: g('to'), q: g('q'), status: g('status'), pay: g('pay'), method: g('method'), salesman: g('salesman'), min: g('min'), max: g('max'), delayed: g('delayed') === 'true', sort: g('sort'), dir: g('dir') === 'asc' ? 'asc' : 'desc', page: Math.max(1, Number(p.get('page')) || 1), limit: [10, 25, 50, 100].includes(Number(g('limit'))) ? Number(g('limit')) : 25, order: p.get('order') || ''};
  });
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    for (const k of Object.keys(DEFAULTS) as (keyof State)[]) { const v = String(s[k]); if (v && v !== String(DEFAULTS[k])) p.set(k, v); else p.delete(k); }
    const qs = p.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    try { const {order: _o, page: _p, ...keep} = s; localStorage.setItem(KEY, JSON.stringify(keep)); } catch { /* ignore */ }
  }, [s]);
  const patch = useCallback((p: Partial<State>) => set(v => ({...v, ...p, page: 'page' in p ? p.page! : 'order' in p && Object.keys(p).length === 1 ? v.page : 1})), []);
  return [s, patch] as const;
}

export function OrdersPage() { return <ToastHost><OrdersInner /></ToastHost>; }

function OrdersInner() {
  const {t} = useLanguage();
  const toast = useToast();
  const [s, patch] = useOrdersState();
  const period: Period = useMemo(() => s.period === 'custom' ? periodRange('custom', {from: s.from, to: s.to}) : periodRange((s.period as PeriodKey) || 'month'), [s.period, s.from, s.to]);
  const f: OrderFilters = {from: period.from, to: period.to, q: s.q, status: s.status, pay: s.pay, method: s.method, salesman: s.salesman, min: s.min, max: s.max, delayed: s.delayed};
  const fKey = JSON.stringify(f);
  const list = useApi(() => ordersApi.list(f, s.page, s.limit, s.sort, s.dir), [fKey, s.page, s.limit, s.sort, s.dir]);
  const prevRange = useMemo(() => previousWindow(period.from, period.to), [period.from, period.to]);
  const prev = useApi(() => ordersApi.totals({...f, ...prevRange}), [fKey, prevRange.from]);
  const [search, setSearch] = useState(s.q);
  useEffect(() => { const id = setTimeout(() => { if (search !== s.q) patch({q: search}); }, 300); return () => clearTimeout(id); }, [search, s.q, patch]);
  const [showInsights, setShowInsights] = useState(() => { try { return localStorage.getItem(INSIGHTS_KEY) === '1'; } catch { return false; } });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Selection only means something for the rows on screen: bulk actions run on visible rows.
  useEffect(() => { setSelected(new Set()); }, [fKey, s.page, s.limit]);
  const pipeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { pipeRef.current?.querySelector('[aria-pressed=true]')?.scrollIntoView({block: 'nearest', inline: 'nearest'}); }, [s.status]);
  const [busyId, setBusyId] = useState('');
  const [bulk, setBulk] = useState<null | 'Approved' | 'Rejected'>(null);
  const [reason, setReason] = useState('');
  const reload = useCallback(() => { void list.reload(true); void prev.reload(true); }, [list, prev]);
  const refresh = () => { void list.reload(); void prev.reload(true); };

  const d = list.data, tot = d?.totals, p = prev.data;
  const advance = async (o: OrderRow, to: OrderStatus) => {
    setBusyId(o.id);
    try { await ordersApi.setStatus(o.id, to); toast('ok', `${t('Order')} ${o.number}: ${t(to)}`); reload(); }
    catch (e) { toast('err', e instanceof Error ? e.message : t('Could not update the order')); } finally { setBusyId(''); }
  };
  const runBulk = async () => {
    if (!bulk || !d) return;
    if (bulk === 'Rejected' && reason.trim().length < 3) return toast('err', t('Give a reason (at least 3 characters)'));
    const targets = d.items.filter(o => selected.has(o.id) && o.status === 'Pending');
    let okN = 0; const failed: string[] = [];
    for (const o of targets) { try { await ordersApi.setStatus(o.id, bulk, bulk === 'Rejected' ? reason.trim() : undefined); okN++; } catch (e) { failed.push(`${o.number}: ${e instanceof Error ? e.message : ''}`); } }
    toast(failed.length ? 'err' : 'ok', `${okN} ${t('orders updated')}${failed.length ? ` · ${failed.length} ${t('failed')}: ${failed[0]}` : ''}`);
    setBulk(null); setReason(''); setSelected(new Set()); reload();
  };

  const name = (id: string) => d?.salesmen.find(u => u.id === id)?.name || id;
  const tabLabel = (v: string) => t(TABS.find(x => x[0] === v)?.[1] || v);
  const chips = [
    s.q && {key: 'q', label: `${t('Search')}: ${s.q}`, clear: {q: ''}},
    s.status && {key: 'status', label: `${t('Status')}: ${tabLabel(s.status)}`, clear: {status: ''}},
    s.pay && {key: 'pay', label: `${t('Payment')}: ${s.pay.split(',').map(x => t(({PAID: 'Paid', PARTIAL: 'Part paid', UNPAID: 'Unpaid', NA: 'Not billable'} as Record<string, string>)[x] || x)).join(', ')}`, clear: {pay: ''}},
    s.method && {key: 'method', label: `${t('Mode')}: ${t(METHOD_LABEL[s.method] || s.method)}`, clear: {method: ''}},
    s.salesman && {key: 'salesman', label: `${t('Salesman')}: ${name(s.salesman)}`, clear: {salesman: ''}},
    s.min && {key: 'min', label: `${t('Min')} ₹${Number(s.min).toLocaleString('en-IN')}`, clear: {min: ''}},
    s.max && {key: 'max', label: `${t('Max')} ₹${Number(s.max).toLocaleString('en-IN')}`, clear: {max: ''}},
    s.delayed && {key: 'delayed', label: t('Delayed only'), clear: {delayed: false}},
  ].filter(Boolean) as Array<{key: string; label: string; clear: Partial<State>}>;
  const clearAll = () => { setSearch(''); patch({q: '', status: '', pay: '', method: '', salesman: '', min: '', max: '', delayed: false}); };
  const pendingSelected = d ? d.items.filter(o => selected.has(o.id) && o.status === 'Pending').length : 0;
  // statusCounts ignore the status filter, so these stay true whichever stage is open. `totals` follow the current view.
  const counts = d?.statusCounts || {};
  const allCount = Object.values(counts).reduce((a, n) => a + (n || 0), 0);
  const inProgress = (counts.Approved || 0) + (counts.Processing || 0) + (counts.Dispatched || 0);
  const toggleStatus = (v: string) => patch({status: s.status === v ? '' : v});
  const stageOn = (v: string) => v ? s.status.split(',').some(x => v.split(',').includes(x)) : !s.status;
  const moreFilters = [s.salesman, s.pay, s.method, s.min, s.max, s.delayed].filter(Boolean).length;
  const waitNote = (o: OrderRow) => { const open = ['Pending', 'Approved', 'Processing'].includes(o.status); return o.delayed ? (open ? `${t('Delayed')} · ${ago(o.ageHours)}` : t('Delayed')) : open ? `${t('waiting')} ${ago(o.ageHours)}` : ''; };
  const empty = <EmptyState action={chips.length > 0 ? <button type="button" className="zl-btn sm" onClick={clearAll}>{t('Clear filters')}</button> : undefined}>{t('No orders in this period')}</EmptyState>;

  const columns: Column<OrderRow>[] = [
    {key: 'created', label: t('Order'), sort: 'createdAt', render: o => <div className="bl-cell"><span className="mono">{o.number}</span><small className="num">{dateTime(o.createdAt)}</small></div>, foot: <b>{t('Total')}</b>},
    {key: 'customer', label: t('Customer'), sort: 'customer', render: o => <div className="bl-cell" title={o.customerName}><b>{o.customerName}</b><small>{o.customerPhone || '—'}</small></div>},
    {key: 'items', label: t('Items'), render: o => <div className="bl-cell" title={o.itemNames.join(', ')}><span>{o.firstItem}</span><small>{o.lines > 1 ? `+${o.lines - 1} ${t('more')} · ` : ''}{o.qty} {t('pcs')}</small></div>},
    {key: 'salesman', label: t('Salesman'), render: o => o.salesmanName ? <span className="or-name" title={o.salesmanName}>{o.salesmanName}</span> : <span className="bl-muted">—</span>},
    {key: 'total', label: t('Total'), sort: 'total', align: 'right', render: o => <b>{inr(o.totalPaise)}</b>, foot: tot && <b title={inr(tot.valuePaise)}>{inr(tot.valuePaise, true)}</b>},
    {key: 'due', label: t('Due'), sort: 'due', align: 'right', render: o => <span className="or-due">{o.counted ? <><span className={o.duePaise > 0 ? 'red' : 'bl-muted'}>{inr(o.duePaise)}</span><PayChip status={o.payStatus} /></> : <><span className="bl-muted">—</span><small>{t('Not billed yet')}</small></>}</span>, foot: tot && <b className={tot.duePaise ? 'red' : ''} title={inr(tot.duePaise)}>{inr(tot.duePaise, true)}</b>},
    {key: 'status', label: t('Status'), sort: 'status', render: o => <span className="or-state"><StatusChip status={o.status} />{waitNote(o) && <small className={o.delayed ? 'red' : ''}>{waitNote(o)}</small>}</span>, foot: tot && <span className="bl-muted">{count(tot.count)} {t('orders')}</span>},
    {key: 'next', label: <span className="zl-sr">{t('Next step')}</span>, render: o => { const n = NEXT_ACTION[o.status]; return n ? <button type="button" className={`zl-btn sm or-next${o.status === 'Pending' ? ' primary' : ''}`} disabled={busyId === o.id} onClick={e => { e.stopPropagation(); void advance(o, n[0]); }}>{busyId === o.id ? '…' : t(n[1])}</button> : null; }},
  ];

  return <div className="zl zl-shell zl-orders">
    <PageHeader eyebrow={t('SALES')} title={t('Orders')} subtitle={t('Every order from placed to delivered: approve, dispatch, collect')} actions={<PeriodSwitcher value={period} onChange={pp => patch(pp.key === 'custom' ? {period: 'custom', from: pp.from, to: pp.to} : {period: pp.key, from: '', to: ''})} />} />
    <div className="zl-metabar">
      <span className="zl-metabar-range"><CalendarDays size={14} aria-hidden="true" /> {t('Showing')} {day(period.from)} – {day(period.to)}</span>
      <span className="zl-metabar-right">
        <button type="button" className="zl-btn sm" aria-expanded={showInsights} onClick={() => setShowInsights(v => { try { localStorage.setItem(INSIGHTS_KEY, v ? '0' : '1'); } catch { /* ignore */ } return !v; })}><BarChart3 size={14} aria-hidden="true" />{showInsights ? t('Hide insights') : t('Show insights')}</button>
        <button type="button" className="zl-btn sm" disabled={!d?.total} onClick={() => ordersApi.exportCsv(f, s.sort, s.dir).then(() => toast('ok', t('Orders exported (CSV, opens in Excel)'))).catch(e => toast('err', e.message))}><Download size={14} aria-hidden="true" />{t('Export')}</button>
        <button type="button" className="zl-btn sm" aria-busy={list.loading} onClick={refresh}><RefreshCw size={14} className={list.loading ? 'zl-spin' : undefined} aria-hidden="true" />{t('Refresh')}</button>
      </span>
    </div>

    {list.loading && !tot ? <StatSkeletons /> : tot && <section className="zl-stats" aria-label={t('Key figures')}>
      <StatCard label={t('Order value')} value={inr(tot.valuePaise, true)} exact={inr(tot.valuePaise)} delta={p ? delta(tot.valuePaise, p.valuePaise) : undefined} icon={<IndianRupee size={16} />} hint={`${count(tot.count)} ${t('orders')} · ${t('billed')} ${inr(tot.countedValuePaise, true)}`} />
      <StatCard label={t('Waiting for approval')} value={count(counts.Pending || 0)} tone={counts.Pending ? 'amber' : 'violet'} icon={<Clock3 size={16} />} hint={t('needs your action')} onClick={() => toggleStatus('Pending')} pressed={s.status === 'Pending'} />
      <StatCard label={t('In progress')} value={count(inProgress)} icon={<Truck size={16} />} hint={t('approved, processing, dispatched')} onClick={() => toggleStatus(IN_PROGRESS)} pressed={s.status === IN_PROGRESS} />
      <StatCard label={t('Delayed')} value={count(tot.delayed)} tone={tot.delayed ? 'red' : 'violet'} icon={<AlertTriangle size={16} />} hint={d ? `${t('pending')} > ${d.delayRule.pendingHours}h, ${t('active')} > ${d.delayRule.activeHours}h` : undefined} onClick={() => patch({delayed: !s.delayed})} pressed={s.delayed} />
      <StatCard label={t('Due on billed orders')} value={inr(tot.duePaise, true)} exact={inr(tot.duePaise)} tone={tot.duePaise ? 'red' : 'violet'} icon={<Wallet size={16} />} hint={`${t('collected')} ${inr(tot.paidPaise, true)}`} onClick={() => patch({pay: s.pay === 'UNPAID,PARTIAL' ? '' : 'UNPAID,PARTIAL'})} pressed={s.pay === 'UNPAID,PARTIAL'} />
    </section>}

    {showInsights && <Suspense fallback={<div className="zl-skel bl-chart-skel" aria-hidden="true" />}><OrderCharts d={d} loading={list.loading && !d} error={list.error} retry={() => void list.reload()} onStatus={st => patch({status: st})} onMethod={m => patch({method: m})} /></Suspense>}

    <section className="zl-card bl-listcard or-list" aria-busy={list.loading || undefined}>
      <div className="or-pipe or-scroll" ref={pipeRef} role="group" aria-label={t('Order status')}>
        {STAGES.map(([v, label, tone, flow], i) => <React.Fragment key={v}>
          {flow && STAGES[i - 1]?.[3] && <ChevronRight className="or-arrow" size={16} aria-hidden="true" />}
          <button type="button" className={`or-stage ${tone}`} aria-pressed={stageOn(v)} onClick={() => patch({status: v})}>
            <span><i aria-hidden="true" />{t(label)}</span>
            <b>{d ? count(v ? v.split(',').reduce((a, k) => a + (counts[k as OrderStatus] || 0), 0) : allCount) : '–'}</b>
          </button>
        </React.Fragment>)}
      </div>
      <div className="or-tools">
        <label className="zl-search or-search"><Search size={16} aria-hidden="true" /><input type="search" className="zl-input" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Search order no., customer, phone or item')} aria-label={t('Search orders')} /></label>
        <button type="button" className="zl-btn" aria-expanded={filtersOpen} aria-controls="or-filters" onClick={() => setFiltersOpen(v => !v)}><SlidersHorizontal size={15} aria-hidden="true" />{t('Filters')}{moreFilters > 0 && <span className="zl-badge">{moreFilters}</span>}</button>
      </div>
      {filtersOpen && <div className="or-filters" id="or-filters">
        <select className="zl-select" value={s.salesman} onChange={e => patch({salesman: e.target.value})} aria-label={t('Salesman')}><option value="">{t('All salesmen')}</option>{d?.salesmen.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <select className="zl-select" value={s.pay} onChange={e => patch({pay: e.target.value})} aria-label={t('Payment')}><option value="">{t('Any payment')}</option><option value="UNPAID,PARTIAL">{t('Money due')}</option><option value="PAID">{t('Paid')}</option><option value="PARTIAL">{t('Part paid')}</option><option value="UNPAID">{t('Unpaid')}</option><option value="NA">{t('Not billed yet')}</option></select>
        <select className="zl-select" value={s.method} onChange={e => patch({method: e.target.value})} aria-label={t('Payment mode')}><option value="">{t('Any mode')}</option>{Object.entries(METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select>
        <input className="zl-input" type="number" min="0" inputMode="decimal" placeholder={t('Min ₹')} aria-label={t('Minimum order value')} value={s.min} onChange={e => patch({min: e.target.value})} />
        <input className="zl-input" type="number" min="0" inputMode="decimal" placeholder={t('Max ₹')} aria-label={t('Maximum order value')} value={s.max} onChange={e => patch({max: e.target.value})} />
        <label className="or-toggle"><input type="checkbox" className="zl-check" checked={s.delayed} onChange={e => patch({delayed: e.target.checked})} /> {t('Delayed only')}</label>
      </div>}
      {chips.length > 0 && <div className="bl-chips" aria-label={t('Active filters')}>{chips.map(c => <span key={c.key} className="bl-chip">{c.label}<button type="button" aria-label={`${t('Remove filter')} ${c.label}`} onClick={() => { if (c.key === 'q') setSearch(''); patch(c.clear); }}><X size={12} /></button></span>)}<button type="button" className="zl-btn ghost sm" onClick={clearAll}>{t('Clear all')}</button></div>}
      {selected.size > 0 && <div className="bl-bulk" role="region" aria-label={t('Selected orders')}>
        <b>{selected.size} {t('selected')}</b>
        <button type="button" className="zl-btn primary sm" disabled={!pendingSelected} onClick={() => setBulk('Approved')}><Check size={14} aria-hidden="true" />{t('Approve')} ({pendingSelected})</button>
        <button type="button" className="zl-btn danger sm" disabled={!pendingSelected} onClick={() => setBulk('Rejected')}>{t('Reject')} ({pendingSelected})</button>
        <button type="button" className="zl-btn ghost sm" onClick={() => setSelected(new Set())}>{t('Clear')}</button>
        {!pendingSelected && <small className="bl-muted">{t('Only pending orders can be approved or rejected.')}</small>}
      </div>}

      {list.error ? <div className="or-error"><ErrorState error={list.error} retry={() => void list.reload()} /></div> : <>
        <div className="or-table" onKeyDown={rowArrows}>
          {d && !d.items.length ? empty : <DataTable rows={d?.items || []} columns={columns} sort={s.sort} dir={s.dir} onSort={k => patch(s.sort === k ? {dir: s.dir === 'asc' ? 'desc' : 'asc'} : {sort: k, dir: k === 'customer' || k === 'number' ? 'asc' : 'desc'})} onRow={o => patch({order: o.id})} activeId={s.order || null} selected={selected} onSelect={setSelected} loading={list.loading && !d} caption={t('Orders')} />}
        </div>
        <div className="or-cards">
          {list.loading && !d ? <div className="zl-skel bl-chart-skel" aria-hidden="true" /> : d?.items.length ? <div className="zl-cards">{d.items.map(o => { const n = NEXT_ACTION[o.status]; return <article key={o.id} className="zl-ocard or-card">
            <button type="button" className="or-open" onClick={() => patch({order: o.id})}>
              <span className="top"><span className="mono">{o.number}</span><StatusChip status={o.status} /></span>
              <b className="or-card-name">{o.customerName}</b>
              <small className="or-card-item">{o.firstItem}{o.lines > 1 ? ` +${o.lines - 1} ${t('more')}` : ''} · {o.qty} {t('pcs')}</small>
              <span className="top or-card-money"><b className="num">{inr(o.totalPaise)}</b>{o.counted ? <span className={`num ${o.duePaise > 0 ? 'red' : 'bl-muted'}`}>{t('Due')} {inr(o.duePaise)}</span> : <small>{t('Not billed yet')}</small>}</span>
              <small>{dateTime(o.createdAt)}{o.salesmanName ? ` · ${o.salesmanName}` : ''}</small>
              {waitNote(o) && <small className={o.delayed ? 'red' : ''}>{waitNote(o)}</small>}
            </button>
            {n && <button type="button" className={`zl-btn sm${o.status === 'Pending' ? ' primary' : ''}`} disabled={busyId === o.id} onClick={() => void advance(o, n[0])}>{busyId === o.id ? '…' : t(n[1])}</button>}
          </article>; })}</div> : empty}
          {d && d.total > 0 && <p className="bl-mobile-tot num">{count(d.totals.count)} {t('orders')} · {t('Total')} {inr(d.totals.valuePaise)} · {t('Due')} <span className="red">{inr(d.totals.duePaise)}</span></p>}
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
    <small className="bl-foot">{t('Order flow')}: {FLOW.map(x => t(x)).join(' → ')}. {t('Dates are when the order was placed. Due and payment status apply once an order is billed (approved). Paid counts verified collections only.')}</small>

    {s.order && <OrderDrawer id={s.order} onClose={() => patch({order: ''})} onChanged={reload} />}
    {bulk && <Modal title={bulk === 'Approved' ? `${t('Approve')} ${pendingSelected} ${t('orders')}?` : `${t('Reject')} ${pendingSelected} ${t('orders')}?`} onClose={() => setBulk(null)} footer={<><button type="button" className="zl-btn" onClick={() => setBulk(null)}>{t('Cancel')}</button><button type="button" className={`zl-btn ${bulk === 'Approved' ? 'primary' : 'danger'}`} onClick={() => void runBulk()}>{bulk === 'Approved' ? t('Approve') : t('Reject')}</button></>}>
      <p>{bulk === 'Approved' ? t('Stock is reserved for each order as it is approved. Orders without enough stock will fail and stay pending.') : t('The salesman will see this reason on each order.')}</p>
      {bulk === 'Rejected' && <label className="zl-field"><span>{t('Reason')}</span><textarea className="zl-input" rows={3} value={reason} onChange={e => setReason(e.target.value)} autoFocus /></label>}
    </Modal>}
  </div>;
}

/** ↑ / ↓ move between table rows; Enter (handled by the table) opens the order. */
function rowArrows(e: React.KeyboardEvent) {
  const row = (e.target as HTMLElement).closest('tr');
  if (!row || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
  const next = (e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling) as HTMLElement | null;
  if (next?.tagName === 'TR') { e.preventDefault(); next.focus(); }
}
