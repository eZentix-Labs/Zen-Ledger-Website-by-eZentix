// Cards of the admin Insights page. Every number comes from GET /api/admin/insights; nothing is computed here
// except presentation (labels, shares of a total already returned, chart scaling).
import React, {useMemo, useState} from 'react';
import {AlertTriangle, ArrowRight, CheckCircle2, Circle, ClipboardCheck, IndianRupee, Lock, Receipt, TrendingUp, Wallet} from 'lucide-react';
import {BarChart, Donut, Gauge, OTHER, SERIES, StackBar, TrendChart} from '../../admin/charts';
import {Chip, Delta, METHOD_LABEL, Segmented, StatCard, count, hourLabel, inr, pct} from '../../admin/ui';
import {useI} from '../useI';
import {Columns, ComboChart, Quadrant, RankBars, Zone, zoneOf} from './charts';
import type {AdminInsights, Page} from './types';

type P = {d: AdminInsights; go: (p: Page) => void};
const money = (p: number | null | undefined) => inr(p);
const short = (p: number | null | undefined) => inr(p, true);

export function Open({go, page, label}: {go: (p: Page) => void; page: Page; label: string}) {
  return <button type="button" className="zl-btn sm ins-open" onClick={() => go(page)}>{label} <ArrowRight size={14} aria-hidden="true" /></button>;
}
export function NotRecorded() { const {t} = useI(); return <span className="ins-nr">{t('not recorded')}</span>; }
export function Compact({children, action}: {children: React.ReactNode; action?: React.ReactNode}) { return <div className="ins-compact"><span>{children}</span>{action}</div>; }
function Card({title, hint, aside, children, className = ''}: {title: React.ReactNode; hint?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string}) {
  return <section className={`zl-card ins-card ${className}`}><div className="zl-card-h"><div><h3>{title}</h3>{hint && <p>{hint}</p>}</div>{aside}</div>{children}</section>;
}
/** One question the page answers: a heading, then its graphs. */
export function Section({title, hint, action, children}: {title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode}) {
  return <section className="ins-sec" aria-label={title}><div className="ins-sec-h"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div>{action}</div>{children}</section>;
}
export const bucketLabel = (key: string, bucket: AdminInsights['bucket']) => bucket === 'hour' ? hourLabel(Number(key))
  : bucket === 'day' ? new Date(key + 'T00:00:00').toLocaleDateString('en-IN', {day: 'numeric', month: 'short'})
  : new Date(key + '-01T00:00:00').toLocaleDateString('en-IN', {month: 'short', year: '2-digit'});
function useUnit(d: AdminInsights) { const {t} = useI(); return d.bucket === 'hour' ? t('hour') : d.bucket === 'day' ? t('day') : t('month'); }

// ---------------- summary ----------------
export function Summary({d, periodName}: {d: AdminInsights; periodName: string}) {
  const {t, f} = useI(); const k = d.kpi, b = (x: React.ReactNode) => <b>{x}</b>;
  const dl = d.deltas.billedPaise;
  return <Card title={t('Summary')} className="ins-story"><p role="status">
    {!k.bills ? <>{f('{period} there are no bills yet.', {period: periodName})} {d.money.duePaise > 0 && f('{due} is still due from earlier bills.', {due: b(money(d.money.duePaise))})}</> : <>
      {f(k.bills === 1 ? '{period} you billed {billed} on 1 bill' : '{period} you billed {billed} across {n} bills', {period: periodName, billed: b(short(k.billedPaise)), n: b(count(k.bills))})}{dl != null && <> (<Delta value={dl} suffix={t('vs previous period')} />)</>}.{' '}
      {f('{collected} of that is collected and {due} is still due.', {collected: b(short(d.rupee.collectedOnBillsPaise)), due: b(short(d.rupee.stillDuePaise))})}{' '}
      {d.topDueDealer && <>{f('Biggest due overall: {name} ({amount}).', {name: b(d.topDueDealer.name), amount: short(d.topDueDealer.duePaise)})} </>}
      {d.team.best && <>{f('Best salesperson: {name}.', {name: b(d.team.best.name)})} </>}
    </>}
  </p>
  {d.canSeeCost && d.completeness.designsNoCost > 0 && <p className="ins-warn"><AlertTriangle size={15} aria-hidden="true" /> <span>{f(d.completeness.designsNoCost === 1 ? '1 design sold has no cost price, so profit is not complete.' : '{n} designs sold have no cost price, so profit is not complete.', {n: b(d.completeness.designsNoCost)})}</span></p>}
  </Card>;
}

// ---------------- headline figures ----------------
export function Kpis({d, go}: P) {
  const {t, s} = useI(); const k = d.kpi, dl = d.deltas, sr = d.series;
  return <section className="zl-stats" aria-label={t('Key figures')}>
    <StatCard label={t('Net sales (excl. GST)')} value={short(k.netSalesPaise)} exact={money(k.netSalesPaise)} delta={dl.netSalesPaise} spark={sr.net} icon={<IndianRupee size={16} />} hint={t('estimated')} onClick={() => go('Bills')} />
    {d.canSeeCost
      ? <StatCard label={t('Gross profit')} value={k.grossProfitPaise == null ? '—' : short(k.grossProfitPaise)} exact={k.grossProfitPaise == null ? undefined : money(k.grossProfitPaise)} delta={dl.grossProfitPaise} spark={k.grossProfitPaise == null ? undefined : sr.profit || undefined} tone={(k.grossProfitPaise ?? 0) < 0 ? 'red' : 'violet'} icon={<TrendingUp size={16} />} hint={k.grossProfitPaise == null ? t('not recorded') : s('cost known for {pct} of sales', {pct: pct(d.completeness.costPct, 0)})} onClick={() => go('Products')} />
      : <StatCard label={t('Average bill')} value={short(k.avgBillPaise)} exact={money(k.avgBillPaise)} delta={dl.avgBillPaise} icon={<Receipt size={16} />} onClick={() => go('Bills')} />}
    <StatCard label={t('Collected')} value={short(k.collectedPaise)} exact={money(k.collectedPaise)} delta={dl.collectedPaise} spark={sr.collected} icon={<ClipboardCheck size={16} />} onClick={() => go('Bills')} />
    <StatCard label={t('Due now')} value={short(k.duePaise)} exact={money(k.duePaise)} tone={k.duePaise ? 'amber' : 'violet'} icon={<Wallet size={16} />} hint={s('{n} unpaid bills, all periods', {n: k.dueBills})} onClick={() => go('Bills')} />
    <StatCard label={t('Bills')} value={count(k.bills)} delta={dl.bills} spark={sr.bills} icon={<Receipt size={16} />} hint={d.canSeeCost ? `${t('Average bill')} ${short(k.avgBillPaise)}` : undefined} onClick={() => go('Bills')} />
  </section>;
}
export function Footnote({d}: {d: AdminInsights}) {
  const {s} = useI(); const c = d.rupee.cancelled, p = d.rupee.pending;
  if (!c.count && !p.count) return null;
  return <p className="ins-foot">{[c.count ? s(c.count === 1 ? '1 cancelled/rejected bill ({amount}) not counted' : '{n} cancelled/rejected bills ({amount}) not counted', {n: c.count, amount: money(c.valuePaise)}) : '', p.count ? s(p.count === 1 ? '1 bill waiting for approval ({amount}) not counted yet' : '{n} bills waiting for approval ({amount}) not counted yet', {n: p.count, amount: money(p.valuePaise)}) : ''].filter(Boolean).join(' · ')}</p>;
}

// ---------------- billed vs collected ----------------
export function Trend({d}: {d: AdminInsights}) {
  const {t, s} = useI(); const tr = d.trend;
  const hasTrendData = [...tr.billed, ...tr.collected, ...tr.previousBilled, ...tr.previousCollected].some(v => v > 0);
  const labels = useMemo(() => tr.keys.map(k => bucketLabel(k, d.bucket)), [tr.keys, d.bucket]);
  const unit = useUnit(d);
  return <Card title={t('Billed vs collected')} hint={s('By {unit} · dashed line = previous period billed', {unit})} aside={tr.best && <Chip tone="violet">{s('Best {unit}: {key} ({amount})', {unit, key: bucketLabel(tr.best.key, d.bucket), amount: short(tr.best.valuePaise)})}</Chip>}>
    {!hasTrendData ? <Compact>{t('Nothing billed or collected in this period.')}</Compact> : <>
      <ComboChart labels={labels} bars={tr.billed} line={tr.collected} prev={tr.previousBilled} format={money} axisFormat={short} ariaLabel={t('Billed and collected over time')} names={{bars: t('Billed'), line: t('Collected'), prev: t('Previous period')}} height={440} />
      <div className="zl-legend ins-legend"><span><i style={{background: 'var(--accent2)'}} />{t('Billed')}</span><span><i style={{background: 'var(--cyan)', height: 3}} />{t('Collected')}</span><span><i className="dash" />{t('Previous period')}</span></div>
    </>}
  </Card>;
}

// ---------------- cash ----------------
export function Rupee({d}: {d: AdminInsights}) {
  const {t, s} = useI(); const r = d.rupee;
  return <Card title={t('Where every rupee went')} hint={t('Bills of this period: billed → collected → due')} aside={r.efficiencyPct != null && <Chip tone={r.efficiencyPct >= 70 ? 'green' : 'amber'}>{s('{pct} collected', {pct: pct(r.efficiencyPct, 0)})}</Chip>}>
    {!r.billedPaise ? <Compact>{t('No bills in this period.')}</Compact> : <>
      <Donut items={[{label: t('Collected on these bills'), value: r.collectedOnBillsPaise, color: 'var(--green)'}, {label: t('Still due'), value: r.stillDuePaise, color: 'var(--amber)'}]} format={short} centerLabel={t('billed')} ariaLabel={t('Where every rupee went')} size={150} />
      <h4 className="ins-sub">{t('Bills by payment status')}</h4>
      <StackBar ariaLabel={t('Bills by payment status')} format={short} items={[{label: s('Paid ({n})', {n: r.payStatus.PAID.count}), value: r.payStatus.PAID.paise, color: 'var(--green)'}, {label: s('Part paid ({n})', {n: r.payStatus.PARTIAL.count}), value: r.payStatus.PARTIAL.paise, color: 'var(--amber)'}, {label: s('Unpaid ({n})', {n: r.payStatus.UNPAID.count}), value: r.payStatus.UNPAID.paise, color: 'var(--red)'}]} />
      <div className="ins-nrs"><span>{t('Discounts given')} <NotRecorded /></span><span>{t('Returns / credit notes')} <NotRecorded /></span></div>
    </>}
  </Card>;
}
export function PayModes({d}: {d: AdminInsights}) {
  const {t} = useI();
  const items = d.rupee.methods.map((m, i) => ({label: t(METHOD_LABEL[m.method] || m.method), value: m.valuePaise, color: SERIES[i] || OTHER}));
  return <Card title={t('Collected by payment mode')} hint={t('Verified payments on these orders')}>
    {items.length ? <Donut items={items} format={short} centerLabel={t('Collected')} ariaLabel={t('Collected by payment mode')} size={150} /> : <Compact>{t('No verified collections in this period.')}</Compact>}
  </Card>;
}
export function BillsChart({d}: {d: AdminInsights}) {
  const {t, s} = useI(); const unit = useUnit(d);
  const labels = useMemo(() => d.trend.keys.map(k => bucketLabel(k, d.bucket)), [d.trend.keys, d.bucket]);
  return <Card title={s('Bills per {unit}', {unit})} hint={`${t('Average bill')} ${short(d.kpi.avgBillPaise)}`} aside={<Delta value={d.deltas.avgBillPaise} />}>
    {d.series.bills.some(v => v > 0) ? <BarChart labels={labels} values={d.series.bills} format={n => count(Math.round(n))} ariaLabel={s('Bills per {unit}', {unit})} height={220} labelGap={58} /> : <Compact>{t('No bills in this period.')}</Compact>}
  </Card>;
}

// ---------------- profit ----------------
/** Horizontal waterfall. Each bar starts where the one above ended, so what is on screen adds up. */
export function Ladder({d, go}: P) {
  const {t, s} = useI();
  if (!d.ladder) return <Card title={t('Operating profit')}><Compact><Lock size={14} aria-hidden="true" style={{verticalAlign: -2}} /> {t('Profit and cost figures are visible only to users with stock valuation access.')}</Compact></Card>;
  const l = d.ladder, net = l.netSalesPaise, gp = l.grossProfitPaise, cogs = l.cogsPaise;
  const costed = l.costedNetPaise, uncosted = cogs == null ? 0 : Math.max(0, net - costed);
  const lo = Math.min(0, gp ?? 0), hi = Math.max(net, cogs ?? 0, 1);
  const seg = (a: number, b: number, color: string) => ({left: `${(Math.min(a, b) - lo) / (hi - lo) * 100}%`, width: `${Math.max(.5, Math.abs(b - a) / (hi - lo) * 100)}%`, background: color});
  const ofNet = (v: number) => pct(net ? Math.round(v / net * 1000) / 10 : null);
  const margin = gp != null && costed ? `${pct(Math.round(gp / costed * 1000) / 10)} ${t('margin')}` : '';
  const profitColor = (gp ?? 0) >= 0 ? 'var(--green)' : 'var(--red)';
  const rows: Array<{label: string; sub: string; value: number | null; minus?: boolean; key?: boolean; bar?: React.CSSProperties; note?: string}> = [
    {label: t('Net sales'), sub: t('Bill value without GST (estimated)'), value: net, bar: seg(0, net, 'var(--accent2)'), note: net ? ofNet(net) : ''},
    ...(uncosted > 0 ? [{label: t('Sales with no cost price'), sub: t('Left out of profit until a cost price is added'), value: uncosted, minus: true, bar: seg(costed, net, 'var(--s-other)'), note: ofNet(uncosted)}] : []),
    {label: t('Cost of goods sold'), sub: s('Cost price × pieces · cost known for {pct} of sales', {pct: pct(l.costCoveragePct, 0)}), value: cogs, minus: true, bar: cogs == null ? undefined : seg(costed, costed - cogs, 'var(--amber)'), note: cogs == null ? '' : ofNet(cogs)},
    {label: t('Gross profit'), sub: t('On designs that have a cost price'), value: gp, key: true, bar: gp == null ? undefined : seg(0, gp, profitColor), note: margin},
    {label: t('Salaries & advances'), sub: t('Not tracked in the app yet'), value: null, minus: true},
    {label: t('Other expenses'), sub: t('Transport, rent, etc. — not tracked yet'), value: null, minus: true},
    {label: t('Operating profit'), sub: t('Before salaries & expenses (not recorded)'), value: l.operatingProfitPaise, key: true, bar: l.operatingProfitPaise == null ? undefined : seg(0, l.operatingProfitPaise, profitColor), note: margin},
  ];
  return <Card title={t('Operating profit ladder')} hint={t('What is left from every rupee of sales')} aside={<Delta value={l.delta} suffix={t('vs previous')} />}>
    {gp == null && net > 0 && <Compact action={<Open go={go} page="Products" label={t('Add cost prices')} />}>{t('No design billed in this period has a cost price, so profit cannot be worked out yet.')}</Compact>}
    <div className="ins-ladder" role="list">
      {rows.map(r => <div key={r.label} role="listitem" className={`ins-rung${r.key ? ' key' : ''}`}>
        <div className="nm"><b>{r.minus ? '− ' : ''}{r.label}</b><small>{r.sub}</small></div>
        <div className={`bar${r.bar ? '' : ' none'}`} aria-hidden="true">{r.bar && <i style={r.bar} />}</div>
        <div className="vv">{r.value == null ? <NotRecorded /> : <><b className="num" title={money(r.value)}>{r.minus && r.value ? '−' : ''}{short(r.value)}</b>{r.note && <small className="num">{r.note}</small>}</>}</div>
      </div>)}
    </div>
    <p className="zl-note">{s('GST collected ({amount}, estimated) belongs to the government, so it is left out.', {amount: short(l.gstPaise)})} {t('Cost uses each design’s current average manufacturing cost.')}</p>
  </Card>;
}
export function ProfitTrend({d}: {d: AdminInsights}) {
  const {t, s} = useI(); const unit = useUnit(d);
  const labels = useMemo(() => d.trend.keys.map(k => bucketLabel(k, d.bucket)), [d.trend.keys, d.bucket]);
  const series = d.series.profit;
  if (!series) return null;
  return <Card title={s('Gross profit by {unit}', {unit})} hint={t('On designs that have a cost price')}>
    {d.kpi.grossProfitPaise == null || !series.some(v => v !== 0) ? <Compact>{t('Add cost prices to see profit over time.')}</Compact>
      : <TrendChart labels={labels} current={series} format={short} ariaLabel={s('Gross profit by {unit}', {unit})} curName={t('Gross profit')} prevName="" height={280} />}
  </Card>;
}
export function MoneyOut({d, go}: P) {
  const {t, s} = useI(); const m = d.moneyOut;
  const rows = [{label: t('Purchases from suppliers'), sub: s('{n} purchase bills, before GST', {n: m.purchaseBills}), value: m.anyPurchaseRecorded ? m.purchasesPaise : null, color: 'var(--s1)'},
    {label: t('GST payable'), sub: t('Estimate: GST on sales − input GST'), value: m.gstPayablePaise, color: 'var(--amber)', est: true},
    {label: t('Salaries & advances'), sub: t('Not tracked yet'), value: null, color: ''}, {label: t('Transport & other expenses'), sub: t('Not tracked yet'), value: null, color: ''}];
  const max = Math.max(1, ...rows.map(r => r.value || 0));
  return <Card title={t('Where the money went out')} hint={t('Money paid or owed out of the business this period')}>
    {!m.anyPurchaseRecorded && <Compact action={<Open go={go} page="Inventory" label={t('Record purchases')} />}>{t('No purchases recorded yet.')}</Compact>}
    <div className="ins-ladder">{rows.map(r => <div className="ins-rung" key={r.label}>
      <div className="nm"><b>{r.label}</b><small>{r.sub}</small></div>
      <div className={`bar${r.value == null ? ' none' : ''}`} aria-hidden="true">{r.value != null && <i style={{left: 0, width: `${Math.max(.5, r.value / max * 100)}%`, background: r.color}} />}</div>
      <div className="vv">{r.value == null ? <NotRecorded /> : <><b className="num" title={money(r.value)}>{short(r.value)}</b>{r.est && <small>{t('estimated')}</small>}</>}</div>
    </div>)}</div>
    {m.anyPurchaseRecorded && <p className="zl-note">{s('Paid to suppliers this period: {amount}', {amount: short(m.paidToSuppliersPaise)})}</p>}
  </Card>;
}
export function Gst({d}: {d: AdminInsights}) {
  const {t, s} = useI(); const g = d.gst;
  const items = [{key: 'out', label: t('GST on sales'), value: g.outputPaise, show: short(g.outputPaise), title: money(g.outputPaise), color: 'var(--s2)'},
    ...(g.inputPaise != null ? [{key: 'in', label: t('Input GST'), value: g.inputPaise, show: short(g.inputPaise), title: money(g.inputPaise), color: 'var(--s3)'}] : []),
    {key: 'net', label: t('Net GST payable'), value: Math.max(0, g.netPaise), show: short(g.netPaise), title: money(g.netPaise), color: 'var(--amber)'}];
  return <Card title={t('GST snapshot')} hint={g.inputPaise == null ? t('input GST not recorded') : undefined} aside={<Chip tone="amber">{t('estimate')}</Chip>}>
    <RankBars items={items} ariaLabel={t('GST snapshot')} />
    {g.gstCoveragePct != null && g.gstCoveragePct < 100 && <p className="ins-warn"><AlertTriangle size={15} aria-hidden="true" /> <span>{s('GST rate set for {pct} of sales', {pct: pct(g.gstCoveragePct, 0)})}</span></p>}
  </Card>;
}

// ---------------- designs ----------------
export function DesignQuadrant({d, go}: P) {
  const {t, s} = useI();
  const pts = useMemo(() => d.designs.filter(x => x.profitPerPiecePaise != null && x.pieces > 0).map(x => ({id: x.id, label: `${x.sku} · ${x.name}`, x: x.pieces, y: x.profitPerPiecePaise!})), [d.designs]);
  const ax = pts.length ? pts.reduce((a, p) => a + p.x, 0) / pts.length : 0, ay = pts.length ? pts.reduce((a, p) => a + p.y, 0) / pts.length : 0;
  const zones: Record<Zone, string> = {win: t('Winners'), popular: t('Popular but low profit'), slow: t('Profitable but slow'), fix: t('Fix or clear')};
  const tips: Record<Zone, string> = {win: t('Keep stocked'), popular: t('Review rate / discount'), slow: t('Push to dealers'), fix: t('Stop buying or offer a discount')};
  const n: Record<Zone, number> = {win: 0, popular: 0, slow: 0, fix: 0}; for (const p of pts) n[zoneOf(p.x, p.y, ax, ay)]++;
  const missing = d.completeness.designsNoCost;
  return <Card title={t('Which designs really make money')} hint={t('Pieces sold vs profit per piece · dashed lines = average')}>
    {!d.canSeeCost ? <Compact><Lock size={14} aria-hidden="true" style={{verticalAlign: -2}} /> {t('Profit and cost figures are visible only to users with stock valuation access.')}</Compact>
      : pts.length < 2 ? <Compact action={missing > 0 ? <Open go={go} page="Products" label={t('Add cost prices')} /> : undefined}>{missing > 0 ? s(missing === 1 ? 'Needs at least 2 sold designs with a cost price — 1 sold design has none.' : 'Needs at least 2 sold designs with a cost price — {n} sold designs have none.', {n: missing}) : t('Needs at least 2 sold designs with a cost price.')}</Compact> : <>
      <Quadrant points={pts} ax={ax} ay={ay} formatY={short} ariaLabel={t('Designs by pieces sold and profit per piece')} zoneName={zones} axisNames={{x: t('Pieces sold'), y: t('Profit per piece')}} />
      <div className="ins-zones">{(['win', 'popular', 'slow', 'fix'] as Zone[]).map(z => <div key={z} className={`ins-zone-card ${z}`}><b>{zones[z]} <span className="num">({n[z]})</span></b><small>{tips[z]}</small></div>)}</div>
      {missing > 0 && <Compact action={<Open go={go} page="Products" label={t('Fix')} />}>{s(missing === 1 ? '1 sold design has no cost price and is not plotted.' : '{n} sold designs have no cost price and are not plotted.', {n: missing})}</Compact>}
    </>}
  </Card>;
}

type Tab = 'profit' | 'pieces' | 'category';
export function TopLists({d}: {d: AdminInsights}) {
  const {t} = useI();
  const cost = d.canSeeCost;
  const [tab, setTab] = useState<Tab>(cost ? 'profit' : 'pieces');
  const opts: Array<[Tab, string]> = [...(cost ? [['profit', t('By profit')] as [Tab, string]] : []), ['pieces', t('By pieces')], ['category', t('By category')]];
  const items = useMemo(() => {
    if (tab === 'category') return d.categories.slice(0, 7).map(x => ({key: x.name, label: x.name, value: x.salesPaise, show: short(x.salesPaise), title: money(x.salesPaise),
      sub: `${count(x.pieces)} ${t('pcs')}${cost ? ` · ${t('Profit')} ${x.profitPaise || x.complete ? `${short(x.profitPaise)}${x.complete ? '' : ' *'}` : t('no cost')}` : ''}`}));
    if (tab === 'profit') return d.designs.filter(x => x.profitPaise != null).sort((a, b) => b.profitPaise! - a.profitPaise!).slice(0, 7).map(x => ({key: x.id, label: x.name, value: x.profitPaise!, show: short(x.profitPaise), title: money(x.profitPaise), sub: `${x.sku} · ${count(x.pieces)} ${t('pcs')} · ${pct(x.marginPct, 0)} ${t('margin')}`}));
    return d.designs.slice().sort((a, b) => b.pieces - a.pieces).slice(0, 7).map(x => ({key: x.id, label: x.name, value: x.pieces, show: `${count(x.pieces)} ${t('pcs')}`, sub: `${x.sku} · ${short(x.salesPaise)}`}));
  }, [d.designs, d.categories, tab, cost, t]);
  return <Card title={t('Top designs')} aside={<Segmented value={tab} onChange={setTab} options={opts} label={t('Rank by')} />}>
    {!d.designs.length ? <Compact>{t('No bills in this period.')}</Compact> : tab === 'profit' && !items.length ? <Compact>{t('No design sold in this period has a cost price yet, so it cannot be ranked by profit.')}</Compact> : <RankBars items={items} ariaLabel={t('Top designs')} />}
    {tab === 'category' && cost && d.categories.some(c => !c.complete) && <p className="zl-note">{t('* some designs in this category have no cost price, so profit is understated.')}</p>}
  </Card>;
}

// ---------------- dealers ----------------
export function DealerShare({d}: {d: AdminInsights}) {
  const {t, s} = useI(); const ds = d.dealerStats;
  const items = d.dealerShare.map((x, i) => ({label: x.label === 'Others' ? t('Others') : x.label, value: x.valuePaise, color: x.label === 'Others' ? OTHER : SERIES[i]}));
  return <Card title={t('Dealer concentration & growth')} hint={t('Share of this period’s sales')} aside={<Delta value={d.deltas.activeDealers} />}>
    {items.length ? <Donut items={items} format={short} centerLabel={t('billed')} ariaLabel={t('Share of sales by dealer')} size={150} /> : <Compact>{t('No bills in this period.')}</Compact>}
    {ds.active > 0 && <><h4 className="ins-sub">{s('{n} active dealers', {n: count(d.kpi.activeDealers)})}</h4>
      <StackBar ariaLabel={t('Dealers')} format={n => count(n)} items={[{label: t('New'), value: ds.new, color: 'var(--cyan)'}, {label: t('Returning'), value: ds.returning, color: 'var(--accent2)'}]} /></>}
  </Card>;
}
export function TopDealers({d}: {d: AdminInsights}) {
  const {t, s} = useI();
  return <Card title={t('Top dealers')} hint={t('Billed in this period')}>
    {d.dealers.length ? <RankBars ariaLabel={t('Top dealers')} items={d.dealers.slice(0, 6).map(x => ({key: x.id, label: x.name, value: x.billedPaise, show: short(x.billedPaise), title: money(x.billedPaise), sub: `${s('{n} bills', {n: x.bills})}${x.duePaise ? ` · ${t('Due now')} ${short(x.duePaise)}` : ''}`}))} /> : <Compact>{t('No bills in this period.')}</Compact>}
  </Card>;
}
export function IdleDealers({d, idleDays, setIdleDays}: {d: AdminInsights; idleDays: number; setIdleDays: (n: number) => void}) {
  const {t, s} = useI();
  return <Card title={t('Dealers who stopped ordering')} hint={d.dealerStats.idle ? s('{n} slipping away (no bill in {d} days)', {n: d.dealerStats.idle, d: d.idleDays}) : t('No dealer is slipping away')} aside={<label className="ins-inline"><span className="zl-sr">{t('No bill for')}</span><select className="zl-select" value={idleDays} onChange={e => setIdleDays(Number(e.target.value))}>{[30, 45, 60, 90].map(n => <option key={n} value={n}>{s('{n} days', {n})}</option>)}</select></label>}>
    {d.idle.length ? <RankBars ariaLabel={t('Dealers who stopped ordering')} items={d.idle.slice(0, 6).map(x => ({key: x.id, label: x.name, value: x.days, show: s('{n} days', {n: x.days}), color: x.days > 90 ? 'var(--red)' : 'var(--amber)', sub: s('Lifetime {amount}', {amount: short(x.lifetimePaise)})}))} />
      : <Compact>{s('Every dealer has ordered in the last {n} days.', {n: idleDays})}</Compact>}
  </Card>;
}

// ---------------- team ----------------
export function Leaderboard({d, go}: P) {
  const {t, s} = useI();
  // Salespeople with nothing this period are counted in one line, not drawn as empty bars.
  const busy = d.salespeople.filter(p => p.billedPaise > 0 || p.collectedPaise > 0 || p.targetPaise != null), idle = d.salespeople.length - busy.length;
  const list = busy.slice(0, 8);
  const max = Math.max(1, ...list.map(p => Math.max(p.billedPaise, p.collectedPaise)));
  return <Card title={t('Salesperson leaderboard')} hint={t('Billed vs collected this period')}>
    {!list.length ? <Compact action={<Open go={go} page="Salesmen" label={t('Add salesmen')} />}>{t('No salesperson has billed in this period.')}</Compact> :
      <div className="ins-people">{list.map(p => <button type="button" key={p.id} className="ins-person" onClick={() => go('Performance')} aria-label={s('{name}: billed {billed}, collected {collected}', {name: p.name, billed: money(p.billedPaise), collected: money(p.collectedPaise)})}>
        <span className="top"><b>{p.name}{p.role !== 'salesman' && <small> · {t(p.role === 'owner' ? 'Owner' : 'Accounts')}</small>}</b><span className="ins-chips">{p.targetPct != null && <Chip tone={p.targetPct >= 100 ? 'green' : p.targetPct >= 50 ? 'blue' : 'amber'}>{s('{pct} of target', {pct: pct(p.targetPct, 0)})}</Chip>}<Delta value={p.delta} /></span></span>
        <span className="bars"><span className="ins-bar"><i style={{width: `${p.billedPaise / max * 100}%`, background: 'var(--accent2)'}} /></span><b className="num">{short(p.billedPaise)}</b>
          <span className="ins-bar"><i style={{width: `${p.collectedPaise / max * 100}%`, background: 'var(--cyan)'}} /></span><b className="num">{short(p.collectedPaise)}</b></span>
      </button>)}
      <div className="zl-legend ins-legend"><span><i style={{background: 'var(--accent2)'}} />{t('Billed')}</span><span><i style={{background: 'var(--cyan)'}} />{t('Collected')}</span></div>
      {idle > 0 && <p className="zl-note">{s(idle === 1 ? '1 more salesperson has no bills or collections this period.' : '{n} more salespeople have no bills or collections this period.', {n: idle})}</p>}</div>}
  </Card>;
}
export function TeamTarget({d, go}: P) {
  const {t, s} = useI(); const tm = d.team;
  return <Card title={t('Sales team')} hint={tm.targetPct != null ? t('of team target achieved') : t('No targets set for this period')}>
    {tm.targetPct != null ? <div className="zl-chart"><Gauge value={tm.targetPct / 100} label={pct(tm.targetPct, 0)} sub={t('Target')} ariaLabel={`${t('of team target achieved')}: ${pct(tm.targetPct, 0)}`} /></div> : <Compact action={<Open go={go} page="Targets" label={t('Open Targets')} />}>{t('No targets set for this period')}</Compact>}
    <ul className="ins-facts">
      <li><CheckCircle2 size={15} aria-hidden="true" /><span>{tm.best ? s('Best: {name}', {name: tm.best.name}) : t('No sales yet')}</span></li>
      {tm.needsHelp && <li className="warn"><AlertTriangle size={15} aria-hidden="true" /><span>{s('Needs help: {name} ({pct})', {name: tm.needsHelp.name, pct: pct(tm.needsHelp.targetPct, 0)})}</span></li>}
    </ul>
  </Card>;
}

// ---------------- dues ----------------
const AGE_COLOR = {'0-7': 'var(--blue)', '8-30': 'var(--amber)', '31-60': 'color-mix(in srgb,var(--amber) 45%,var(--red))', '60+': 'var(--red)'} as const;
export function Ageing({d}: {d: AdminInsights}) {
  const {t, s} = useI(); const m = d.money;
  return <Card title={t('Due ageing')} hint={t('All unpaid bills, by days since billing')} aside={m.over30.paise > 0 ? <Chip tone="red">{s('Over 30 days: {amount}', {amount: short(m.over30.paise)})}</Chip> : undefined}>
    {!m.bills ? <Compact>{t('No money is due. Every bill is paid.')}</Compact> : <>
      <Columns ariaLabel={t('Due by age')} items={d.ageing.map(a => ({key: a.key, label: s('{range} days', {range: a.key}), sub: s('{n} bills', {n: a.count}), value: a.paise, show: short(a.paise), title: money(a.paise), color: AGE_COLOR[a.key]}))} />
      <p className="zl-note">{s('Today {a} · older {b}', {a: short(m.dueTodayPaise), b: short(m.dueOlderPaise)})}{m.oldest ? ` · ${s('Oldest: {name}, {days} days', {name: m.oldest.customerName, days: m.oldest.days})}` : ''}</p>
    </>}
  </Card>;
}
export function OldestDues({d}: {d: AdminInsights}) {
  const {t, s} = useI();
  return <Card title={t('Oldest dues')} hint={t('Dealers to call first')}>
    {d.overdueDealers.length ? <RankBars ariaLabel={t('Oldest dues')} items={d.overdueDealers.map(x => ({key: x.id, label: x.name, value: x.duePaise, show: short(x.duePaise), title: money(x.duePaise), color: x.oldest > 60 ? 'var(--red)' : x.oldest > 30 ? 'var(--amber)' : 'var(--blue)', sub: s('{n} unpaid bills · oldest {days} days', {n: x.bills, days: x.oldest})}))} /> : <Compact>{t('No money is due. Every bill is paid.')}</Compact>}
  </Card>;
}

// ---------------- stock ----------------
export function LowStock({d}: {d: AdminInsights}) {
  const {t, s} = useI(); const st = d.stock;
  return <Card title={s('Low stock ({n})', {n: st.low.length})} hint={t('Bar = stock left against the reorder level')}>
    {st.low.length ? <RankBars ariaLabel={t('Low stock')} max={100} items={st.low.slice(0, 5).map(x => ({key: x.id, label: x.name, sub: x.sku, value: x.reorder ? Math.max(0, x.available) / x.reorder * 100 : 0, show: s('{a} left · reorder {r}', {a: x.available, r: x.reorder}), color: x.available <= 0 ? 'var(--red)' : 'var(--amber)'}))} /> : <Compact>{t('Nothing below reorder level.')}</Compact>}
  </Card>;
}
export function DeadStock({d}: {d: AdminInsights}) {
  const {t, s} = useI(); const st = d.stock, valued = st.dead.some(x => x.valuePaise != null);
  return <Card title={s('Dead stock ({n})', {n: st.dead.length})} hint={st.deadValuePaise != null && st.dead.length > 0 ? `${short(st.deadValuePaise)} ${t('locked in stock')}` : undefined}>
    {st.dead.length ? <RankBars ariaLabel={t('Dead stock')} items={st.dead.slice(0, 5).map(x => ({key: x.id, label: x.name, value: valued ? x.valuePaise || 0 : x.stock, show: valued ? (x.valuePaise == null ? t('no cost') : short(x.valuePaise)) : `${count(x.stock)} ${t('pcs')}`, color: 'var(--s-other)', sub: x.lastSale ? s('{n} pcs · last sold {date}', {n: x.stock, date: bucketLabel(x.lastSale, 'day')}) : s('{n} pcs · never sold', {n: x.stock})}))} /> : <Compact>{s('Everything in stock sold in the last {n} days.', {n: st.deadDays})}</Compact>}
    {st.deadUncosted > 0 && <p className="zl-note">{s('{n} of these have no cost price, so the locked value is understated.', {n: st.deadUncosted})}</p>}
  </Card>;
}
export function FastMovers({d}: {d: AdminInsights}) {
  const {t, s} = useI(); const st = d.stock;
  return <Card title={t('Fast movers')} hint={t('Pieces sold in this period')}>
    {st.fast.length ? <RankBars ariaLabel={t('Fast movers')} items={st.fast.slice(0, 5).map(x => ({key: x.id, label: x.name, value: x.pieces, show: `${count(x.pieces)} ${t('pcs')}`, color: 'var(--green)', sub: s('{n} sold · {a} left', {n: x.pieces, a: x.available ?? '—'})}))} /> : <Compact>{t('No sales in this period.')}</Compact>}
  </Card>;
}

// ---------------- things to do + checklist ----------------
const ONE: Partial<Record<string, string>> = {callOverdue: 'Call the dealer whose dues are over 30 days ({amount})', addCost: 'Add cost price to 1 design so profit is exact', verifyPayments: 'Verify 1 collection waiting for approval ({amount})', restock: '1 design is at or below reorder level — plan production or purchase', addGst: 'Set the GST rate on 1 design so GST is exact'};
const GO_LABEL: Record<string, string> = {Orders: 'Open Orders', Bills: 'Open Bills', Products: 'Open Products', Customers: 'Open Dealers', Inventory: 'Open Inventory', Performance: 'Open Performance', Targets: 'Open Targets'};
export function Todo({d, go}: P) {
  const {t, s} = useI();
  const text = (a: AdminInsights['actions'][number]) => {
    const v = {...a.vars, amount: typeof a.vars.amount === 'number' ? short(a.vars.amount) : ''};
    if (a.vars.n === 1 && ONE[a.kind]) return s(ONE[a.kind]!, v);
    return s({callOverdue: 'Call the {n} dealers whose dues are over 30 days ({amount})', addCost: 'Add cost price to {n} designs so profit is exact', followUp: '{name} hasn’t ordered in {days} days — send a follow-up', verifyPayments: 'Verify {n} collections waiting for approval ({amount})', restock: '{n} designs are at or below reorder level — plan production or purchase', addGst: 'Set the GST rate on {n} designs so GST is exact', coach: '{name} is at {pct}% of target — check in with them'}[a.kind], v);
  };
  return <Card title={t('Things to do this week')} className="ins-todo">
    {d.actions.length ? <ol className="ins-actions">{d.actions.map((a, i) => <li key={a.kind}><button type="button" onClick={() => go(a.go)}><span className="n" aria-hidden="true">{i + 1}</span><span className="tx">{text(a)}<small>{t(GO_LABEL[a.go] || 'Open')}</small></span><ArrowRight size={15} aria-hidden="true" /></button></li>)}</ol>
      : <Compact>{t('Nothing urgent — dues, stock and data all look fine for now.')}</Compact>}
  </Card>;
}
const CHECK_LABEL: Record<string, string> = {cost: 'Add cost price to designs', gst: 'Set GST rate on designs', purchases: 'Record purchases', targets: 'Set salesperson targets', expenses: 'Record expenses & salaries (not in the app yet)'};
export function Checklist({d, go, hidden}: P & {hidden: string[]}) {
  const {t, s} = useI(); const items = d.completeness.checklist, done = items.filter(x => x.done).length;
  return <Card title={t('Complete your data to unlock more insights')} hint={hidden.length ? s('Hidden until there is data: {cards}', {cards: hidden.join(', ')}) : undefined} aside={<Chip tone="amber">{s('{pct} complete', {pct: pct(Math.round(done / items.length * 100), 0)})}</Chip>}>
    <div className="ins-progress" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={items.length} aria-label={t('Data completeness')}><i style={{width: `${done / items.length * 100}%`}} /></div>
    <ul className="ins-check">{items.map(x => <li key={x.key} className={x.done ? 'done' : ''}>{x.done ? <CheckCircle2 size={18} aria-hidden="true" /> : <Circle size={18} aria-hidden="true" />}<span>{t(CHECK_LABEL[x.key])}<span className="zl-sr">{x.done ? t('done') : t('not done')}</span></span>{!x.done && x.go && <Open go={go} page={x.go} label={t('Open')} />}</li>)}</ul>
  </Card>;
}
