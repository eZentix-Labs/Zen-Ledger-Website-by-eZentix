import {shiftDays, todayIso} from '../inventory/api';

export type PeriodKey = 'today' | 'week' | 'month' | 'year' | 'custom';
export const PERIODS: Array<[PeriodKey, string]> = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['custom', 'Custom']];

/** Period → inclusive YYYY-MM-DD range in the business timezone (to-date ranges, weeks start Monday). */
export function rangeOf(p: PeriodKey, custom: {from: string; to: string}) {
  const t = todayIso();
  if (p === 'today') return {from: t, to: t};
  if (p === 'week') { const dow = (new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7; return {from: shiftDays(t, -dow), to: t}; }
  if (p === 'month') return {from: t.slice(0, 8) + '01', to: t};
  if (p === 'year') return {from: t.slice(0, 5) + '01-01', to: t};
  return custom;
}
