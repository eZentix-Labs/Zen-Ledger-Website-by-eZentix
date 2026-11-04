import React from 'react';
import {AlertTriangle, ArrowRight, Boxes, ClipboardCheck, Factory, IndianRupee, Package, RefreshCw, ShoppingCart, Users} from 'lucide-react';
import {get} from '../inventory/api';
import {TrendChart} from './charts';
import {ChartCard, Chip, EmptyState, ErrorState, inr, KpiCard, KpiSkeletons, PageHeader, PeriodSwitcher, Skeleton, useApi, usePeriod} from './ui';
import './theme.css';

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
const emit=(name:string)=>window.dispatchEvent(new Event(`bms:${name}`));
const money=(n:number|null|undefined)=>inr(n,true);
const day=(d:string)=>new Date(`${d}T00:00:00`).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'});
const labelKey=(key:string,bucket:Overview['bucket'])=>bucket==='hour'?`${key}:00`:bucket==='month'?new Date(`${key}-01T00:00:00`).toLocaleDateString('en-IN',{month:'short',year:'2-digit'}):new Date(`${key}T00:00:00`).toLocaleDateString('en-IN',{day:'2-digit',month:'short'});

export default function OverviewPage({go}:{go:(page:string)=>void}) {
  const [period,setPeriod]=usePeriod('admin-overview-period','month');
  const api=useApi(()=>get<Overview>('/api/admin/overview',{from:period.from,to:period.to}),[period.from,period.to]);
  const d=api.data;
  const openOrders=()=>{const q=new URLSearchParams({period:'custom',from:period.from,to:period.to});window.history.replaceState(window.history.state,'',`${window.location.pathname}?${q.toString()}`);go('Orders');};
  const retry=()=>void api.reload();
  const attention=d?[
    ...(d.alerts.delayed||[]).map(x=>({key:`delay-${x.id}`,title:`Order ${x.number} is delayed`,detail:`${x.customerName} · ${x.status} · ${Math.floor(x.ageHours/24)} days`,go:'Orders',icon:<AlertTriangle size={17}/>,tone:'red'})),
    ...(d.alerts.oldDues||[]).map(x=>({key:`due-${x.id}`,title:`${x.customerName} has an overdue balance`,detail:`Order ${x.number} · ${money(x.duePaise)} · ${x.days} days`,go:'Orders',icon:<IndianRupee size={17}/>,tone:'amber'})),
    ...(d.stock.alerts||[]).slice(0,4).map(x=>({key:`stock-${x.id}`,title:`Reorder ${x.name}`,detail:`${x.available.toLocaleString('en-IN')} ${x.unit} available · reorder at ${x.reorder.toLocaleString('en-IN')}`,go:'Inventory',icon:<Boxes size={17}/>,tone:'amber'})),
    ...(d.production.lateOrders||[]).map(x=>({key:`production-${x.id}`,title:`Production ${x.number} is overdue`,detail:`${x.productName} · due ${day(x.expectedDate.slice(0,10))}`,go:'Inventory',icon:<Factory size={17}/>,tone:'red'})),
    ...(d.alerts.unverifiedPayments?[{key:'unverified',title:`${d.alerts.unverifiedPayments} payment${d.alerts.unverifiedPayments===1?'':'s'} need verification`,detail:'Verify received payments before they count in collections.',go:'Orders',icon:<ClipboardCheck size={17}/>,tone:'blue'}]:[]),
  ].slice(0,8):[];

  return <div className="zl zl-page zl-overview">
    <PageHeader eyebrow="BUSINESS AT A GLANCE" title="Overview" subtitle="Sales, cash collection, stock and actions for your business." actions={<><PeriodSwitcher value={period} onChange={setPeriod}/><button className="zl-btn" type="button" onClick={retry} aria-label="Refresh overview" aria-busy={api.loading}><RefreshCw size={15}/> {api.loading?'Updating…':'Refresh'}</button></>}/>
    <div className="zl-overview-meta"><span>Showing {day(period.from)} – {day(period.to)}</span>{d&&<span>Updated {new Date(d.generatedAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</span>}</div>
    {api.error&&<ErrorState error={`${d?'Showing the last successful data. ':'Overview could not be loaded. '}${api.error}`} retry={retry}/>}
    {!d&&api.loading&&<>
      <KpiSkeletons n={5}/>
      <section className="zl-card zl-attention" aria-label="Loading items needing attention" aria-busy="true"><div className="zl-card-h"><div><Skeleton h={16} w={170}/><Skeleton h={12} w={240}/></div></div>{[0,1,2].map(i=><div className="zl-attention-loading-row" key={i}><Skeleton h={34} w={34} r={10}/><div style={{flex:1,display:'grid',gap:7}}><Skeleton h={12} w="48%"/><Skeleton h={10} w="68%"/></div></div>)}</section>
      <div className="zl-grid zl-g2"><ChartCard title="Sales trend" loading/><ChartCard title="Collections trend" loading/></div>
      <OverviewCardSkeleton rows={3}/>
      <div className="zl-grid zl-g2"><OverviewCardSkeleton rows={4}/><OverviewCardSkeleton rows={3}/></div>
      <div className="zl-grid zl-g3"><OverviewCardSkeleton rows={4}/><OverviewCardSkeleton rows={4}/><OverviewCardSkeleton rows={3}/></div>
      <div className="zl-grid zl-g2"><OverviewCardSkeleton rows={4}/><OverviewCardSkeleton rows={3}/></div>
    </>}
    {!d&&!api.loading&&!api.error&&<EmptyState icon={<ShoppingCart/>}>No overview data is available for this period.</EmptyState>}
    {d&&<>
      <section aria-label="Key business figures" className="zl-kpis zl-overview-kpis">
        <KpiCard label="Sales" value={money(d.kpi.salesPaise)} delta={d.deltas.salesPaise} deltaSuffix="vs previous period" icon={<IndianRupee size={16}/>} hint={`${d.kpi.countedOrders.toLocaleString('en-IN')} confirmed orders`} onClick={openOrders} />
        <KpiCard label="Collections received" value={money(d.kpi.collectedPaise)} delta={d.deltas.collectedPaise} deltaSuffix="vs previous period" icon={<ClipboardCheck size={16}/>} hint="Verified payments in this period" onClick={openOrders} />
        <KpiCard label="Receivables outstanding" value={money(d.finance.duePaise)} icon={<IndianRupee size={16}/>} hint={`${d.finance.dueOrders.toLocaleString('en-IN')} confirmed orders · see ageing below`} onClick={openOrders} />
        <KpiCard label="Orders needing action" value={(d.operations.pending+d.operations.readyToDispatch+d.operations.dispatched).toLocaleString('en-IN')} icon={<ShoppingCart size={16}/>} hint={`${d.operations.pending} pending · ${d.operations.readyToDispatch} ready · ${d.operations.dispatched} awaiting delivery`} onClick={openOrders} />
        <KpiCard label="Stock alerts" value={d.operations.lowStock.toLocaleString('en-IN')} icon={<Package size={16}/>} hint={`${d.operations.outOfStock} out of stock · included in reorder alerts`} onClick={()=>go('Inventory')} />
      </section>
      <section className="zl-card zl-attention" aria-labelledby="attention-title">
        <div className="zl-card-h"><div><h2 id="attention-title">Needs attention</h2><p>Prioritised items that may need action today.</p></div><Chip tone={attention.length?'amber':'green'} dot>{attention.length?`${attention.length} items`:'All clear'}</Chip></div>
        {attention.length?<ul className="zl-attention-list">{attention.map(a=><li key={a.key}><span className={`zl-attention-icon ${a.tone}`} aria-hidden="true">{a.icon}</span><span className="zl-attention-copy"><b>{a.title}</b><small>{a.detail}</small></span><button className="zl-iconbtn" type="button" aria-label={`Open ${a.go} for ${a.title}`} onClick={()=>a.go==='Orders'?openOrders():go(a.go)}><ArrowRight size={17}/></button></li>)}</ul>:<div className="zl-overview-empty">No urgent actions found for the selected period.</div>}
        {(d.operations.delayed>5||d.operations.lowStock>8)&&<button className="zl-btn sm" type="button" onClick={()=>d.operations.delayed>5?openOrders():go('Inventory')}>View all actions <ArrowRight size={14}/></button>}
      </section>
      <div className="zl-grid zl-g2 zl-overview-trends">
        <ChartCard title="Sales trend" hint="Confirmed sales compared with the previous period." loading={api.loading} empty={d.series.sales.every(v=>v===0)&&d.previousSeries.sales.every(v=>v===0)?'No sales recorded in this or the previous period.':false}>
          <TrendChart labels={d.keys.map(k=>labelKey(k,d.bucket))} current={d.series.sales} previous={d.previousSeries.sales} format={money} ariaLabel="Sales trend, current period and previous period" curName="Selected period" prevName="Previous period"/>
        </ChartCard>
        <ChartCard title="Collections trend" hint="Verified payments by date, compared with the previous period." loading={api.loading} empty={d.series.collected.every(v=>v===0)&&d.previousSeries.collected.every(v=>v===0)?'No verified collections recorded in either period.':false}>
          <TrendChart labels={d.keys.map(k=>labelKey(k,d.bucket))} current={d.series.collected} previous={d.previousSeries.collected} format={money} ariaLabel="Collections trend, current period and previous period" curName="Selected period" prevName="Previous period"/>
        </ChartCard>
      </div>
      <section className="zl-card"><div className="zl-card-h"><div><h2>Receivable age</h2><p>Days since each order was confirmed, not days overdue by payment terms; balances without a confirmation date are excluded.</p></div></div>
        <div className="zl-ageing-grid">{d.finance.ageing.map(x=><button className="zl-ageing" type="button" key={x.bucket} onClick={openOrders}><span>{x.bucket} days</span><b>{money(x.duePaise)}</b><small>{x.bills.toLocaleString('en-IN')} orders</small></button>)}</div>
      </section>
      <div className="zl-grid zl-g2">
        <section className="zl-card"><div className="zl-card-h"><div><h2>Stock & production</h2><p>Available inventory and active manufacturing work.</p></div></div>
          <dl className="zl-overview-stats"><div><dt>Known-cost stock subtotal</dt><dd>{!d.access.valuation?'Not available for your role':d.stock.stockValuePaise==null?'Not recorded':money(d.stock.stockValuePaise)}</dd></div><div><dt>Uncosted stock records</dt><dd>{!d.access.valuation?'Not available for your role':d.stock.uncostedStockItems==null?'Not recorded':d.stock.uncostedStockItems.toLocaleString('en-IN')}</dd></div><div><dt>Orders in production</dt><dd>{d.production.active.toLocaleString('en-IN')}</dd></div><div><dt>Delayed production orders</dt><dd>{d.production.late.toLocaleString('en-IN')}</dd></div></dl>
          <p className="zl-note">Known weighted-average cost subtotal; uncosted stock is excluded.</p><button className="zl-btn sm" type="button" onClick={()=>go('Inventory')}>Open inventory <ArrowRight size={14}/></button>
        </section>
        <section className="zl-card"><div className="zl-card-h"><div><h2>Estimated gross profit</h2><p>Net of configured GST on costed product lines. Excludes business expenses.</p></div><Chip tone="amber">Estimated</Chip></div>
          <div className="zl-profit-value">{!d.access.valuation?'Not available for your role':d.profit?.grossProfitPaise==null?'Not recorded':money(d.profit.grossProfitPaise)}</div><p className="zl-note">Cost coverage: {!d.access.valuation?'Not available for your role':d.profit?.costCoveragePct==null?'Not recorded':`${d.profit.costCoveragePct.toLocaleString('en-IN')}%`} of selected-period sales. Expenses and salaries: Not recorded.</p>
          {(d.quality.productsMissingCost||d.quality.productsMissingGst)&&<p className="zl-warn"><AlertTriangle size={15}/> {d.quality.productsMissingCost??'Not recorded'} products missing cost · {d.quality.productsMissingGst??'Not recorded'} missing GST rate</p>}
        </section>
      </div>
      <div className="zl-grid zl-g3">
        <RankTable title="Top products" empty="No product sales recorded." rows={d.topProducts.map(x=>[x.name,`${money(x.valuePaise)} · ${x.qty.toLocaleString('en-IN')} units`])}/>
        <RankTable title="Top distributors" empty="No distributor sales recorded." rows={d.topDistributors.map(x=>[x.name,`${money(x.salesPaise)} · ${x.orders.toLocaleString('en-IN')} orders`])}/>
        <section className="zl-card"><div className="zl-card-h"><div><h2>Supplier payables</h2><p>Posted supplier bills, less recorded payments.</p></div></div><div className="zl-profit-value">{!d.access.valuation?'Not available for your role':d.supplierPayables.duePaise==null?'Not recorded':money(d.supplierPayables.duePaise)}</div><p className="zl-note">Overdue: {!d.access.valuation?'Not available for your role':d.supplierPayables.overduePaise==null?'Not recorded':money(d.supplierPayables.overduePaise)} · Missing due dates: {!d.access.valuation?'Not available for your role':d.supplierPayables.missingDueDate==null?'Not recorded':d.supplierPayables.missingDueDate.toLocaleString('en-IN')}</p><button className="zl-btn sm" type="button" onClick={()=>go('Bills')}>Open bills <ArrowRight size={14}/></button></section>
      </div>
      <div className="zl-grid zl-g2">
        <RankTable title="Sales by salesman" empty="No salesman sales recorded." rows={d.salesmenPerformance.map(x=>[x.name,`${money(x.salesPaise)} · target ${x.targetPaise==null?'Not set':money(x.targetPaise)}${x.targetPct==null?'':` · ${x.targetPct.toLocaleString('en-IN')}% achieved`}`])}/>
        <section className="zl-card"><div className="zl-card-h"><div><h2>Data quality</h2><p>Records that can make reports or fulfilment less reliable.</p></div></div><ul className="zl-quality-list"><li><span>Active products missing a BOM</span><b>{d.quality.productsMissingBom.toLocaleString('en-IN')}</b></li><li><span>Negative finished stock</span><b>{d.quality.negativeFinishedGoods.toLocaleString('en-IN')}</b></li><li><span>Negative material stock</span><b>{d.quality.negativeMaterials.toLocaleString('en-IN')}</b></li></ul></section>
      </div>
      <div className="zl-overview-quick"><button type="button" onClick={()=>emit('open-invoice')}><IndianRupee size={16}/> Create invoice</button><button type="button" onClick={()=>emit('open-product')}><Package size={16}/> Add product</button><button type="button" onClick={()=>emit('open-customer')}><Users size={16}/> Add distributor</button></div>
      <p className="zl-note">Sales include confirmed orders. Collections include verified payments only. Percent comparison uses the immediately preceding range of equal length; a zero previous period has no percentage comparison.</p>
    </>}
  </div>;
}

function RankTable({title,empty,rows}:{title:string;empty:string;rows:Array<[string,string]>}){return <section className="zl-card"><div className="zl-card-h"><div><h2>{title}</h2></div></div>{rows.length?<div className="zl-table-scroll"><table className="zl-data-table"><caption className="zl-sr">{title}</caption><thead><tr><th scope="col">Name</th><th scope="col">Sales</th></tr></thead><tbody>{rows.map(([name,value],i)=><tr key={`${name}-${i}`}><th scope="row">{name}</th><td>{value}</td></tr>)}</tbody></table></div>:<EmptyState>{empty}</EmptyState>}</section>}
function OverviewCardSkeleton({rows}:{rows:number}){return <section className="zl-card" aria-busy="true" aria-label="Loading overview section"><div className="zl-card-h"><Skeleton h={16} w="42%"/></div>{Array.from({length:rows},(_,i)=><div className="zl-overview-skeleton-row" key={i}><Skeleton h={12} w="38%"/><Skeleton h={12} w="26%"/></div>)}</section>}
