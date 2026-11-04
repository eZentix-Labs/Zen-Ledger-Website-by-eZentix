import React, {useState} from 'react';
import {AlertTriangle, ArrowRight, Boxes, CalendarDays, CheckCircle2, ClipboardCheck, Factory, IndianRupee, Lock, Package, RefreshCw, ShoppingCart, Users} from 'lucide-react';
import {get} from '../inventory/api';
import {TrendChart} from './charts';
import {Chip, Delta, EmptyState, ErrorState, inr, PageHeader, PeriodSwitcher, Segmented, Skeleton, StatCard, StatSkeletons, useApi, usePeriod} from './ui';
import './theme.css';
import './overview.css';

type Overview = {
  from: string; to: string; generatedAt: string; keys: string[]; bucket: 'hour'|'day'|'month'; access:{valuation:boolean};
  kpi: {salesPaise:number; collectedPaise:number; ordersCreated:number; countedOrders:number};
  previousKpi: {salesPaise:number; collectedPaise:number};
  deltas: {salesPaise:number|null; collectedPaise:number|null};
  series: {sales:number[]; collected:number[]}; previousSeries: {sales:number[]; collected:number[]};
  finance: {duePaise:number; dueOrders:number; ageing:Array<{bucket:string;duePaise:number;bills:number}>; unverifiedCount:number};
  operations: {pending:number;readyToDispatch:number;dispatched:number;delayed:number;lowStock:number;outOfStock:number};
  stock: {finishedGoods:{low:number;out:number};materials:{low:number;out:number};stockValuePaise:number|null;uncostedStockItems:number|null;alerts:Array<{id:string;name:string;available:number;reorder:number;unit:string;kind:string}>};
  production: {active:number;late:number;lateOrders:Array<{id:string;number:string;productName:string;expectedDate:string}>};
  supplierPayables: {duePaise:number|null;bills:number|null;overduePaise:number|null;missingDueDate:number|null};
  profit: {grossProfitPaise:number|null;costCoveragePct:number|null;estimated:boolean}|null;
  quality: {productsMissingBom:number;negativeFinishedGoods:number;negativeMaterials:number;productsMissingCost:number|null;productsMissingGst:number|null};
  topProducts:Array<{id:string;name:string;valuePaise:number;qty:number}>;
  topDistributors:Array<{id:string;name:string;salesPaise:number;orders:number}>;
  salesmenPerformance:Array<{id:string;name:string;salesPaise:number;targetPaise:number|null;targetPct:number|null}>;
  alerts:{delayed:Array<{id:string;number:string;customerName:string;status:string;ageHours:number}>;oldDues:Array<{id:string;number:string;customerName:string;duePaise:number;days:number}>;unverifiedPayments:number};
};
type RankRow = {id:string; name:string; value:string; exact?:string; sub:string; bar:number|null; done?:boolean};

const emit = (name:string) => window.dispatchEvent(new Event(`bms:${name}`));
const money = (n:number|null|undefined) => inr(n, true);
const num = (n:number) => n.toLocaleString('en-IN');
const day = (d:string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', {day:'2-digit', month:'2-digit', year:'numeric'});
const labelKey = (key:string, bucket:Overview['bucket']) => bucket === 'hour' ? `${key}:00` : bucket === 'month' ? new Date(`${key}-01T00:00:00`).toLocaleDateString('en-IN', {month:'short', year:'2-digit'}) : new Date(`${key}T00:00:00`).toLocaleDateString('en-IN', {day:'2-digit', month:'short'});
const NO_ACCESS = 'Not available for your role';
/** A gated figure as plain text, for inline notes. Never shows a missing value as zero. */
const gatedText = (locked:boolean, value:number|null|undefined, format:(n:number)=>string) => locked ? NO_ACCESS : value == null ? 'Not recorded' : format(value);

export default function OverviewPage({go}:{go:(page:string)=>void}) {
  const [period, setPeriod] = usePeriod('admin-overview-period', 'month');
  const api = useApi(() => get<Overview>('/api/admin/overview', {from:period.from, to:period.to}), [period.from, period.to]);
  const d = api.data;
  const openOrders = () => { const q = new URLSearchParams({period:'custom', from:period.from, to:period.to}); window.history.replaceState(window.history.state, '', `${window.location.pathname}?${q.toString()}`); go('Orders'); };
  const retry = () => void api.reload();

  return <div className="zl zl-shell zl-overview">
    <PageHeader eyebrow="BUSINESS AT A GLANCE" title="Overview" subtitle="Sales, cash collection, stock and actions for your business." actions={<PeriodSwitcher value={period} onChange={setPeriod}/>}/>
    <div className="zl-metabar">
      <span className="zl-metabar-range"><CalendarDays size={14} aria-hidden="true"/> Showing {day(period.from)} – {day(period.to)}</span>
      <span className="zl-metabar-right">
        {d && <span aria-live="polite">Updated {new Date(d.generatedAt).toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'})}</span>}
        <button className="zl-btn sm" type="button" onClick={retry} aria-label="Refresh overview" aria-busy={api.loading}><RefreshCw size={14} className={api.loading ? 'zl-spin' : undefined} aria-hidden="true"/> {api.loading ? 'Updating…' : 'Refresh'}</button>
      </span>
    </div>
    {api.error && <ErrorState error={`${d ? 'Showing the last successful data. ' : 'Overview could not be loaded. '}${api.error}`} retry={retry}/>}
    {!d && api.loading && <OverviewSkeleton/>}
    {!d && !api.loading && !api.error && <EmptyState icon={<ShoppingCart/>}>No overview data is available for this period.</EmptyState>}
    {d && <div className="ov-body" aria-busy={api.loading || undefined}>
      <section aria-label="Key business figures" className="zl-stats">
        <StatCard label="Sales" value={money(d.kpi.salesPaise)} exact={inr(d.kpi.salesPaise)} delta={d.deltas.salesPaise} spark={d.series.sales} icon={<IndianRupee size={16}/>} hint={`${num(d.kpi.countedOrders)} confirmed orders`} onClick={openOrders}/>
        <StatCard label="Collections received" value={money(d.kpi.collectedPaise)} exact={inr(d.kpi.collectedPaise)} delta={d.deltas.collectedPaise} spark={d.series.collected} icon={<ClipboardCheck size={16}/>} hint="Verified payments in this period" onClick={openOrders}/>
        <StatCard label="Receivables outstanding" value={money(d.finance.duePaise)} exact={inr(d.finance.duePaise)} icon={<IndianRupee size={16}/>} hint={`${num(d.finance.dueOrders)} confirmed orders · see receivable age`} onClick={openOrders}/>
        <StatCard label="Orders needing action" value={num(d.operations.pending + d.operations.readyToDispatch + d.operations.dispatched)} tone={d.operations.delayed ? 'amber' : 'violet'} icon={<ShoppingCart size={16}/>} hint={`${d.operations.pending} pending · ${d.operations.readyToDispatch} ready · ${d.operations.dispatched} awaiting delivery`} onClick={openOrders}/>
        <StatCard label="Stock alerts" value={num(d.operations.lowStock)} tone={d.operations.outOfStock ? 'red' : d.operations.lowStock ? 'amber' : 'violet'} icon={<Package size={16}/>} hint={`${d.operations.outOfStock} out of stock · included in reorder alerts`} onClick={() => go('Inventory')}/>
      </section>

      <div className="ov-main">
        <Attention d={d} go={go} openOrders={openOrders}/>
        <div className="ov-stack">
          <TrendCard d={d}/>
          <AgeingCard d={d} openOrders={openOrders}/>
        </div>
      </div>

      <div className="ov-health">
        <StockCard d={d} go={go}/>
        <ProfitCard d={d}/>
        <PayablesCard d={d} go={go}/>
      </div>

      <div className="ov-ranks">
        <Ranked title="Top products" hint="Confirmed sales value in this period." empty="No product sales recorded." rows={relative(d.topProducts.map(x => ({id:x.id, name:x.name, paise:x.valuePaise, sub:`${num(x.qty)} units`})))}/>
        <Ranked title="Top distributors" hint="Confirmed sales value in this period." empty="No distributor sales recorded." rows={relative(d.topDistributors.map(x => ({id:x.id, name:x.name, paise:x.salesPaise, sub:`${num(x.orders)} orders`})))}/>
        <Ranked title="Sales by salesman" hint="Bars show progress against each target." empty="No salesman sales recorded." rows={d.salesmenPerformance.map(x => ({id:x.id, name:x.name, value:money(x.salesPaise), exact:inr(x.salesPaise), sub:`Target ${x.targetPaise == null ? 'Not set' : money(x.targetPaise)}${x.targetPct == null ? '' : ` · ${x.targetPct.toLocaleString('en-IN')}% achieved`}`, bar:x.targetPct, done:(x.targetPct ?? 0) >= 100}))}/>
      </div>

      <div className="ov-bottom">
        <section className="zl-card ov-card" aria-labelledby="ov-quality">
          <CardHead id="ov-quality" title="Data quality" hint="Records that can make reports or fulfilment less reliable."/>
          <ul className="ov-quality">
            <QualityRow label="Active products missing a BOM" value={d.quality.productsMissingBom}/>
            <QualityRow label="Negative finished stock" value={d.quality.negativeFinishedGoods}/>
            <QualityRow label="Negative material stock" value={d.quality.negativeMaterials}/>
          </ul>
        </section>
        <section className="zl-card ov-card" aria-labelledby="ov-quick">
          <CardHead id="ov-quick" title="Quick actions" hint="Start common work without leaving the overview."/>
          <div className="ov-quick">
            <button type="button" onClick={() => emit('open-invoice')}><span className="zl-tile violet" aria-hidden="true"><IndianRupee size={16}/></span>Create invoice<ArrowRight size={15} aria-hidden="true"/></button>
            <button type="button" onClick={() => emit('open-product')}><span className="zl-tile violet" aria-hidden="true"><Package size={16}/></span>Add product<ArrowRight size={15} aria-hidden="true"/></button>
            <button type="button" onClick={() => emit('open-customer')}><span className="zl-tile violet" aria-hidden="true"><Users size={16}/></span>Add distributor<ArrowRight size={15} aria-hidden="true"/></button>
          </div>
        </section>
      </div>
      <p className="ov-foot">Sales include confirmed orders. Collections include verified payments only. Percent comparison uses the immediately preceding range of equal length; a zero previous period has no percentage comparison.</p>
    </div>}
  </div>;
}

function CardHead({id, title, hint, aside}:{id:string; title:string; hint?:string; aside?:React.ReactNode}) {
  return <div className="zl-card-h"><div><h2 id={id}>{title}</h2>{hint && <p>{hint}</p>}</div>{aside}</div>;
}

function Attention({d, go, openOrders}:{d:Overview; go:(page:string)=>void; openOrders:()=>void}) {
  const items = [
    ...(d.alerts.delayed || []).map(x => ({key:`delay-${x.id}`, title:`Order ${x.number} is delayed`, detail:`${x.customerName} · ${x.status} · ${Math.floor(x.ageHours / 24)} days`, go:'Orders', icon:<AlertTriangle size={16}/>, tone:'red'})),
    ...(d.alerts.oldDues || []).map(x => ({key:`due-${x.id}`, title:`${x.customerName} has an overdue balance`, detail:`Order ${x.number} · ${money(x.duePaise)} · ${x.days} days`, go:'Orders', icon:<IndianRupee size={16}/>, tone:'amber'})),
    ...(d.stock.alerts || []).slice(0, 4).map(x => ({key:`stock-${x.id}`, title:`Reorder ${x.name}`, detail:`${num(x.available)} ${x.unit} available · reorder at ${num(x.reorder)}`, go:'Inventory', icon:<Boxes size={16}/>, tone:'amber'})),
    ...(d.production.lateOrders || []).map(x => ({key:`production-${x.id}`, title:`Production ${x.number} is overdue`, detail:`${x.productName} · due ${day(x.expectedDate.slice(0, 10))}`, go:'Inventory', icon:<Factory size={16}/>, tone:'red'})),
    ...(d.alerts.unverifiedPayments ? [{key:'unverified', title:`${d.alerts.unverifiedPayments} payment${d.alerts.unverifiedPayments === 1 ? '' : 's'} need verification`, detail:'Verify received payments before they count in collections.', go:'Orders', icon:<ClipboardCheck size={16}/>, tone:'blue'}] : []),
  ].slice(0, 8);
  return <section className="zl-card ov-card ov-attention" aria-labelledby="ov-attention">
    <CardHead id="ov-attention" title="Needs attention" hint="Prioritised items that may need action today." aside={<Chip tone={items.length ? 'amber' : 'green'} dot>{items.length ? `${items.length} items` : 'All clear'}</Chip>}/>
    {items.length
      ? <ul className="ov-alerts">{items.map(a => <li key={a.key}><button type="button" onClick={() => a.go === 'Orders' ? openOrders() : go(a.go)}>
          <span className={`zl-tile ${a.tone}`} aria-hidden="true">{a.icon}</span>
          <span className="ov-alert-copy"><b>{a.title}</b><small>{a.detail}</small></span>
          <ArrowRight size={16} aria-hidden="true"/>
        </button></li>)}</ul>
      : <div className="ov-clear"><CheckCircle2 size={26} aria-hidden="true"/>No urgent actions found for the selected period.</div>}
    {(d.operations.delayed > 5 || d.operations.lowStock > 8) && <div className="ov-card-foot"><button className="zl-btn sm" type="button" onClick={() => d.operations.delayed > 5 ? openOrders() : go('Inventory')}>View all actions <ArrowRight size={14} aria-hidden="true"/></button></div>}
  </section>;
}

function TrendCard({d}:{d:Overview}) {
  const [metric, setMetric] = useState<'sales'|'collected'>('sales');
  const sales = metric === 'sales';
  const current = d.series[metric], previous = d.previousSeries[metric];
  const total = sales ? d.kpi.salesPaise : d.kpi.collectedPaise;
  const delta = sales ? d.deltas.salesPaise : d.deltas.collectedPaise;
  const empty = current.every(v => v === 0) && previous.every(v => v === 0);
  return <section className="zl-card ov-card" aria-labelledby="ov-trend">
    <CardHead id="ov-trend" title={sales ? 'Sales trend' : 'Collections trend'} hint={sales ? 'Confirmed sales compared with the previous period.' : 'Verified payments by date, compared with the previous period.'} aside={<Segmented value={metric} onChange={setMetric} label="Trend measure" options={[['sales', 'Sales'], ['collected', 'Collections']]}/>}/>
    {empty
      ? <EmptyState>{sales ? 'No sales recorded in this or the previous period.' : 'No verified collections recorded in either period.'}</EmptyState>
      : <>
        <div className="ov-trend-sum"><b title={inr(total)}>{money(total)}</b><Delta value={delta} suffix="vs previous period"/></div>
        <TrendChart labels={d.keys.map(k => labelKey(k, d.bucket))} current={current} previous={previous} format={money} ariaLabel={`${sales ? 'Sales' : 'Collections'} trend, current period and previous period`} curName="Selected period" prevName="Previous period"/>
        <div className="zl-legend ov-legend"><span><i style={{background:'var(--accent2)'}}/>Selected period</span><span><i className="dash"/>Previous period</span></div>
      </>}
  </section>;
}

function AgeingCard({d, openOrders}:{d:Overview; openOrders:()=>void}) {
  const total = d.finance.ageing.reduce((sum, x) => sum + x.duePaise, 0);
  const tone = (i:number) => ['var(--accent2)', 'var(--amber)', 'var(--red)'][Math.min(i, 2)];
  return <section className="zl-card ov-card" aria-labelledby="ov-age">
    <CardHead id="ov-age" title="Receivable age" hint="Days since each order was confirmed, not days overdue by payment terms; balances without a confirmation date are excluded."/>
    {total > 0 && <div className="ov-agebar" aria-hidden="true">{d.finance.ageing.filter(x => x.duePaise > 0).map(x => <i key={x.bucket} style={{flexGrow:x.duePaise, background:tone(d.finance.ageing.indexOf(x))}}/>)}</div>}
    <div className="ov-age">{d.finance.ageing.map((x, i) => <button type="button" key={x.bucket} onClick={openOrders} title={inr(x.duePaise)}>
      <span><i style={{background:tone(i)}} aria-hidden="true"/>{x.bucket} days</span>
      <b>{money(x.duePaise)}</b>
      <small>{num(x.bills)} orders{total > 0 ? ` · ${Math.round(x.duePaise / total * 100)}%` : ''}</small>
    </button>)}</div>
  </section>;
}

/** The main number of a card. Restricted or missing figures read as words, never as a large zero. */
function Figure({locked, value}:{locked:boolean; value:number|null|undefined}) {
  if (locked) return <div className="ov-figure na"><Lock size={14} aria-hidden="true"/> {NO_ACCESS}</div>;
  if (value == null) return <div className="ov-figure na">Not recorded</div>;
  return <div className="ov-figure" title={inr(value)}>{money(value)}</div>;
}

function StockCard({d, go}:{d:Overview; go:(page:string)=>void}) {
  const locked = !d.access.valuation;
  return <section className="zl-card ov-card" aria-labelledby="ov-stock">
    <CardHead id="ov-stock" title="Stock & production" hint="Available inventory and active manufacturing work."/>
    <dl className="ov-stats">
      <div><dt>Known-cost stock subtotal</dt><dd className={locked || d.stock.stockValuePaise == null ? 'na' : undefined}>{gatedText(locked, d.stock.stockValuePaise, money)}</dd></div>
      <div><dt>Uncosted stock records</dt><dd className={locked || d.stock.uncostedStockItems == null ? 'na' : undefined}>{gatedText(locked, d.stock.uncostedStockItems, num)}</dd></div>
      <div><dt>Orders in production</dt><dd>{num(d.production.active)}</dd></div>
      <div><dt>Delayed production orders</dt><dd className={d.production.late ? 'bad' : undefined}>{num(d.production.late)}</dd></div>
    </dl>
    <p className="ov-note">Known weighted-average cost subtotal; uncosted stock is excluded.</p>
    <div className="ov-card-foot"><button className="zl-btn sm" type="button" onClick={() => go('Inventory')}>Open inventory <ArrowRight size={14} aria-hidden="true"/></button></div>
  </section>;
}

function ProfitCard({d}:{d:Overview}) {
  const locked = !d.access.valuation, coverage = d.profit?.costCoveragePct;
  const {productsMissingCost:cost, productsMissingGst:gst} = d.quality;
  return <section className="zl-card ov-card" aria-labelledby="ov-profit">
    <CardHead id="ov-profit" title="Estimated gross profit" hint="Net of configured GST on costed product lines. Excludes business expenses." aside={<Chip tone="amber">Estimated</Chip>}/>
    <Figure locked={locked} value={d.profit?.grossProfitPaise}/>
    {!locked && coverage != null && <div className="ov-meter" aria-hidden="true"><i style={{width:`${Math.min(100, Math.max(0, coverage))}%`}}/></div>}
    <p className="ov-note">Cost coverage: {gatedText(locked, coverage, n => `${n.toLocaleString('en-IN')}%`)}{locked || coverage == null ? '' : ' of selected-period sales'}. Expenses and salaries: Not recorded.</p>
    {(cost || gst) ? <p className="ov-warn"><AlertTriangle size={15} aria-hidden="true"/> {cost ?? 'Not recorded'} products missing cost · {gst ?? 'Not recorded'} missing GST rate</p> : null}
  </section>;
}

function PayablesCard({d, go}:{d:Overview; go:(page:string)=>void}) {
  const locked = !d.access.valuation, p = d.supplierPayables;
  return <section className="zl-card ov-card" aria-labelledby="ov-payables">
    <CardHead id="ov-payables" title="Supplier payables" hint="Posted supplier bills, less recorded payments."/>
    <Figure locked={locked} value={p.duePaise}/>
    <dl className="ov-rows">
      <div><dt>Overdue</dt><dd className={!locked && p.overduePaise ? 'bad' : undefined}>{gatedText(locked, p.overduePaise, money)}</dd></div>
      <div><dt>Missing due dates</dt><dd>{gatedText(locked, p.missingDueDate, num)}</dd></div>
    </dl>
    <div className="ov-card-foot"><button className="zl-btn sm" type="button" onClick={() => go('Bills')}>Open bills <ArrowRight size={14} aria-hidden="true"/></button></div>
  </section>;
}

/** Bars relative to the top row of the list. */
function relative(rows:Array<{id:string; name:string; paise:number; sub:string}>):RankRow[] {
  const top = Math.max(...rows.map(r => r.paise), 0) || 1;
  return rows.map(r => ({id:r.id, name:r.name, value:money(r.paise), exact:inr(r.paise), sub:r.sub, bar:r.paise / top * 100}));
}

function Ranked({title, hint, empty, rows}:{title:string; hint:string; empty:string; rows:RankRow[]}) {
  const id = `ov-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return <section className="zl-card ov-card" aria-labelledby={id}>
    <CardHead id={id} title={title} hint={hint}/>
    {rows.length
      ? <table className="ov-rank">
          <caption className="zl-sr">{title}</caption>
          <thead><tr><th scope="col" className="zl-sr">Rank</th><th scope="col" className="zl-sr">Name</th><th scope="col" className="zl-sr">Sales</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={r.id}>
            <td className="ov-rank-n">{i + 1}</td>
            <th scope="row"><span className="ov-rank-name">{r.name}</span><small>{r.sub}</small>{r.bar != null && <span className="ov-bar" aria-hidden="true"><i className={r.done ? 'done' : undefined} style={{width:`${Math.min(100, Math.max(2, r.bar))}%`}}/></span>}</th>
            <td className="ov-rank-v" title={r.exact}>{r.value}</td>
          </tr>)}</tbody>
        </table>
      : <EmptyState>{empty}</EmptyState>}
  </section>;
}

function QualityRow({label, value}:{label:string; value:number}) {
  return <li className={value ? 'warn' : 'ok'}>{value ? <AlertTriangle size={16} aria-hidden="true"/> : <CheckCircle2 size={16} aria-hidden="true"/>}<span>{label}</span><b>{num(value)}</b></li>;
}

function CardSkeleton({rows, tall}:{rows:number; tall?:boolean}) {
  return <section className="zl-card ov-card" aria-busy="true" aria-label="Loading overview section">
    <div className="zl-card-h"><div style={{flex:1, display:'grid', gap:8}}><Skeleton h={16} w="42%"/><Skeleton h={12} w="66%"/></div></div>
    {tall && <Skeleton h={240} r={12}/>}
    {Array.from({length:rows}, (_, i) => <div className="ov-skel-row" key={i}><Skeleton h={34} w={34} r={10}/><div style={{flex:1, display:'grid', gap:7}}><Skeleton h={12} w="52%"/><Skeleton h={10} w="72%"/></div></div>)}
  </section>;
}

function OverviewSkeleton() {
  return <div aria-busy="true">
    <StatSkeletons/>
    <div className="ov-main"><CardSkeleton rows={7}/><div className="ov-stack"><CardSkeleton rows={0} tall/><CardSkeleton rows={1}/></div></div>
    <div className="ov-health"><CardSkeleton rows={2}/><CardSkeleton rows={2}/><CardSkeleton rows={2}/></div>
  </div>;
}
