// Bills page state kept in the URL (shareable, survives refresh) with the last view remembered locally.
import {useCallback, useEffect, useState} from 'react';
import type {Filters, Tab} from './api';

export type ListState = Filters & {period: string; sort: string; dir: 'asc' | 'desc'; page: number; limit: number; bill: string; view: 'list' | 'new'};
const KEY = 'bills.view';
const TABS: Tab[] = ['all', 'PAID', 'PARTIAL', 'UNPAID', 'overdue', 'cancelled'];
export const DEFAULTS: ListState = {period: 'month', from: '', to: '', q: '', tab: 'all', salesman: '', customer: '', min: '', max: '', sort: 'billDate', dir: 'desc', page: 1, limit: 25, bill: '', view: 'list'};

function read(): ListState {
  const p = new URLSearchParams(window.location.search);
  let saved: Partial<ListState> = {};
  if (![...p.keys()].length) { try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* storage unavailable */ } }
  const s = (k: keyof ListState) => p.get(k) ?? (saved[k] as string | undefined) ?? String(DEFAULTS[k]);
  const tab = s('tab') as Tab;
  return {
    period: s('period'), from: s('from'), to: s('to'), q: s('q'), tab: TABS.includes(tab) ? tab : 'all',
    salesman: s('salesman'), customer: s('customer'), min: s('min'), max: s('max'),
    sort: s('sort'), dir: s('dir') === 'asc' ? 'asc' : 'desc',
    page: Math.max(1, Number(p.get('page')) || 1), limit: [10, 25, 50, 100].includes(Number(s('limit'))) ? Number(s('limit')) : 25,
    bill: p.get('bill') || '', view: p.get('view') === 'new' ? 'new' : 'list',
  };
}

/** Like useState, but mirrored to ?query (only non-default values) and localStorage (filters, sort, size). */
export function useListState() {
  const [state, setState] = useState<ListState>(read);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    for (const k of Object.keys(DEFAULTS) as (keyof ListState)[]) {
      const v = String(state[k]);
      if (v && v !== String(DEFAULTS[k])) p.set(k, v); else p.delete(k);
    }
    const qs = p.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    try { const {bill: _b, view: _v, page: _p, ...keep} = state; localStorage.setItem(KEY, JSON.stringify(keep)); } catch { /* ignore */ }
  }, [state]);
  /** Changing anything but the page or the open bill goes back to page 1. */
  const patch = useCallback((p: Partial<ListState>) => setState(s => ({...s, ...p, page: 'page' in p ? p.page! : ('bill' in p || 'view' in p) && Object.keys(p).length === 1 ? s.page : 1})), []);
  return [state, patch] as const;
}
