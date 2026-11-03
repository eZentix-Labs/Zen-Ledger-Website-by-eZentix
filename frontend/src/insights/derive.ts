// Pure calculations on top of the insights payload. No new business definitions live here:
// sales, collections, dues and target progress all come from the backend (metricsFor / targetProgress).
import type {Insights} from './types';

/** % change vs previous period, or null when there is nothing to compare with. */
export const deltaPct = (cur: number, prev: number) => prev > 0 ? Math.round((cur - prev) / prev * 1000) / 10 : null;
export const pctOf = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 1000) / 10 : null;

export type LadderRow = {
  key: string; label: string; sub: string; subVars?: Record<string, string | number>;
  value: number; pct: number | null; bar: number; tone: 'violet' | 'green' | 'amber' | 'red' | 'blue' | 'neutral';
  highlight?: boolean; estimated?: boolean; perDay?: boolean;
};

export function ladderRows(d: Insights, fmtDate: (iso: string) => string, money: (p: number) => string): LadderRow[] {
  const sales = d.metrics.salesPaise, t = d.target;
  if (!t) return [];
  const goal = t.periodTargetPaise, scale = Math.max(goal, sales, 1);
  const rows: LadderRow[] = [
    {key: 'target', label: 'Target', sub: t.prorated ? 'Pro-rated share of {name} ({total})' : '{name} · {from} – {to}', subVars: {name: t.name, total: money(t.targetValue), from: fmtDate(t.startDate), to: fmtDate(t.endDate)}, value: goal, pct: 100, bar: goal / scale * 100, tone: 'neutral'},
    {key: 'sales', label: 'Sales counted', sub: d.policy === 'DISPATCHED' ? '{orders} orders · counted once dispatched' : '{orders} orders · counted once approved', subVars: {orders: d.metrics.countedOrders}, value: sales, pct: pctOf(sales, goal), bar: sales / scale * 100, tone: sales >= goal ? 'green' : 'violet', highlight: true},
    {key: 'gap', label: 'Gap to target', sub: sales >= goal ? 'Target met for this period' : 'Still to sell in this period', value: Math.max(0, goal - sales), pct: pctOf(Math.max(0, goal - sales), goal), bar: Math.max(0, goal - sales) / scale * 100, tone: sales >= goal ? 'green' : 'amber'},
  ];
  if (t.daysRemaining > 0 && t.progress.remaining > 0) {
    const elapsed = Math.max(1, daysBetween(t.startDate, d.period.today));
    const avg = t.progress.achieved / elapsed, cover = pctOf(avg, t.requiredPerDayPaise);
    rows.push({key: 'perday', label: 'Required per day', sub: 'For the remaining {days} days of {name}; you average {avg} a day', subVars: {days: t.daysRemaining, name: t.name, avg: money(Math.round(avg))}, value: t.requiredPerDayPaise, pct: cover, bar: Math.min(100, cover ?? 0), tone: (cover ?? 0) >= 100 ? 'green' : 'blue', perDay: true});
  }
  if (t.projectedPaise != null && t.progress.state === 'ACTIVE') {
    const p = pctOf(t.projectedPaise, t.targetValue);
    rows.push({key: 'projected', label: 'Projected at end', sub: 'At your current pace, by {date} ({total} target)', subVars: {date: fmtDate(t.endDate), total: money(t.targetValue)}, value: t.projectedPaise, pct: p, bar: Math.min(100, p ?? 0), tone: (p ?? 0) >= 100 ? 'green' : 'amber', estimated: true});
  }
  return rows;
}

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1;

export type Action = {key: string; title: string; titleVars: Record<string, string | number>; hint: string; hintVars: Record<string, string | number>; button?: {label: string; tab: 'catalog' | 'orders' | 'collect'}};

/** Up to three plain-language, data-driven to-dos, most valuable first. */
export function actionsFor(d: Insights, money: (p: number) => string): Action[] {
  const out: Action[] = [];
  const names = (xs: Array<{name: string}>) => xs.map(x => x.name).join(', ');
  if (d.dues.top.length) out.push({key: 'dues', title: 'Collect from {names}', titleVars: {names: names(d.dues.top)}, hint: '{amount} due between them; oldest bill is {days} days old', hintVars: {amount: money(d.dues.top.reduce((a, x) => a + x.amountPaise, 0)), days: Math.max(...d.dues.top.map(x => x.oldestDays))}, button: {label: 'Record collection', tab: 'collect'}});
  if (d.customerHealth.slipping.length) out.push({key: 'slipping', title: 'Visit {names}', titleVars: {names: names(d.customerHealth.slipping.slice(0, 3))}, hint: 'No order for {days}+ days; they used to buy {amount}', hintVars: {days: d.customerHealth.slippingDays, amount: money(d.customerHealth.slipping.slice(0, 3).reduce((a, x) => a + x.valuePaise, 0))}, button: {label: 'Take an order', tab: 'catalog'}});
  const t = d.target, top = d.products[0];
  if (t && t.progress.remaining > 0 && t.daysRemaining > 0 && top) out.push({key: 'push', title: 'Push {product} to close the gap', titleVars: {product: top.name}, hint: 'Your best seller; you need {perDay} a day to reach {name}', hintVars: {perDay: money(t.requiredPerDayPaise), name: t.name}, button: {label: 'Open catalogue', tab: 'catalog'}});
  if (d.completeness.pendingOrders) out.push({key: 'pending', title: 'Follow up {n} orders awaiting approval', titleVars: {n: d.completeness.pendingOrders}, hint: 'Pending orders do not count as sales yet', hintVars: {}, button: {label: 'Open my orders', tab: 'orders'}});
  if (d.completeness.unverifiedCollections) out.push({key: 'unverified', title: 'Get {n} collections verified', titleVars: {n: d.completeness.unverifiedCollections}, hint: 'Collections count after the accounts team verifies them', hintVars: {}, button: {label: 'Open collections', tab: 'collect'}});
  if (!t) out.push({key: 'target', title: 'Ask your admin to set a sales target', titleVars: {}, hint: 'With a target, this page shows your daily pace and gap', hintVars: {}});
  return out.slice(0, 3);
}

/** Collections by method grouped the way the business talks about them. */
export function cashSplit(byMethod: Record<string, number>) {
  const cash = byMethod.cash || 0;
  const digital = (byMethod.upi || 0) + (byMethod.bank_transfer || 0) + (byMethod.card || 0);
  const other = (byMethod.cheque || 0) + (byMethod.other || 0);
  return {cash, digital, other};
}
