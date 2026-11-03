import React, {memo} from 'react';
import {rupees} from '../inventory/api';
import {deltaPct} from './derive';
import type {PeriodKey} from './period';
import type {Insights} from './types';
import {useI} from './useI';

const OPENERS: Record<PeriodKey, string> = {
  today: 'Today you sold {sales} from {orders} orders.',
  week: 'This week you sold {sales} from {orders} orders.',
  month: 'This month you sold {sales} from {orders} orders.',
  year: 'This year you sold {sales} from {orders} orders.',
  custom: 'In this period you sold {sales} from {orders} orders.',
};
const shortDate = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', {day: 'numeric', month: 'short', timeZone: 'UTC'});

/** One auto-generated paragraph that says how the period is going. */
export const SummaryCard = memo(function SummaryCard({d, period}: {d: Insights; period: PeriodKey}) {
  const {f} = useI();
  const B = (v: React.ReactNode) => <b className="ins-hl">{v}</b>;
  const m = d.metrics, t = d.target, delta = deltaPct(m.salesPaise, d.previousMetrics.salesPaise);
  const parts: React.ReactNode[] = [f(OPENERS[period], {sales: B(rupees(m.salesPaise)), orders: B(m.countedOrders)})];
  if (t?.periodTargetPaise) parts.push(f('That is {pct} of your target.', {pct: B(`${Math.round(m.salesPaise / t.periodTargetPaise * 100)}%`)}));
  if (delta != null) parts.push(f(delta >= 0 ? 'Up {delta} on the previous period.' : 'Down {delta} on the previous period.', {delta: B(`${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}%`)}));
  if (d.bestDay && d.period.grain !== 'hour' && d.bestDay.salesPaise > 0) parts.push(f('Best day was {day} with {amount}.', {day: B(shortDate(d.bestDay.date)), amount: B(rupees(d.bestDay.salesPaise))}));
  if (t?.progress.state === 'COMPLETED') parts.push(f('{name} is already reached. Well done!', {name: B(t.name)}));
  else if (t && t.daysRemaining > 0 && t.progress.remaining > 0) parts.push(f('You need {perDay} a day for the remaining {days} days to hit target.', {perDay: B(rupees(t.requiredPerDayPaise)), days: B(t.daysRemaining)}));
  if (!t) parts.push(f('No sales target is set for this period.', {}));
  return <section className="ins-card ins-summary" aria-label="Summary">
    <p>{parts.map((p, i) => <React.Fragment key={i}>{i > 0 && ' '}{p}</React.Fragment>)}{d.dues.totalPaise > 0 && <> <span className="ins-warn">{f('{amount} of dues are still uncollected.', {amount: <b>{rupees(d.dues.totalPaise)}</b>})}</span></>}</p>
  </section>;
});
