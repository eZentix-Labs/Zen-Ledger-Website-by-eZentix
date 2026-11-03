import {shiftDays} from '../inventory/api';

/** The comparison window: the same number of days immediately before `from` (inclusive dates). */
export function previousWindow(from: string, to: string) {
  const len = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  return {from: shiftDays(from, -len), to: shiftDays(from, -1)};
}
