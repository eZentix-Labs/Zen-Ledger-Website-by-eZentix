// Shared admin components (Overview, Orders, Insights). Styling lives in ./theme.css.
import React, {createContext, useCallback, useContext, useEffect, useId, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {AlertTriangle, ArrowDown, ArrowUp, ChevronDown, Inbox, X} from 'lucide-react';
import {useLanguage} from '../i18n';
import {shiftDays, todayIso} from '../inventory/api';
import {Sparkline} from './charts';

// ---------------- formatting (one formatter for every number on these pages) ----------------
export const inr = (paise: number | null | undefined, compact = false) => {
  if (paise == null) return '—';
  const r = paise / 100;
  if (compact && Math.abs(r) >= 1e7) return `₹${(r / 1e7).toLocaleString('en-IN', {maximumFractionDigits: 2})} Cr`;
  if (compact && Math.abs(r) >= 1e5) return `₹${(r / 1e5).toLocaleString('en-IN', {maximumFractionDigits: 2})} L`;
  return `₹${r.toLocaleString('en-IN', {maximumFractionDigits: Math.abs(r) < 1000 && r % 1 ? 2 : 0})}`;
};
export const count = (n: number | null | undefined) => n == null ? '—' : n.toLocaleString('en-IN');
export const pct = (n: number | null | undefined, digits = 1) => n == null ? '—' : `${n.toLocaleString('en-IN', {maximumFractionDigits: digits})}%`;
export const dateTime = (d?: string | null) => d ? new Date(d).toLocaleString('en-IN', {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'}) : '—';
export const day = (d?: string | null) => d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric'}) : '—';
export const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? ' AM' : ' PM'}`;
export const METHOD_LABEL: Record<string, string> = {cash: 'Cash', upi: 'UPI', card: 'Card', bank_transfer: 'Bank transfer', cheque: 'Cheque', other: 'Other'};

// ---------------- periods ----------------
export type PeriodKey = 'today' | 'week' | 'month' | 'year' | 'custom';
export type Period = {key: PeriodKey; from: string; to: string};
export function periodRange(key: PeriodKey, custom?: {from: string; to: string}): Period {
  const t = todayIso();
  if (key === 'today') return {key, from: t, to: t};
  if (key === 'week') { const dow = (new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7; return {key, from: shiftDays(t, -dow), to: t}; }
  if (key === 'month') return {key, from: t.slice(0, 8) + '01', to: t};
  if (key === 'year') return {key, from: t.slice(0, 5) + '01-01', to: t};
  return {key, from: custom?.from || shiftDays(t, -29), to: custom?.to || t};
}
export const PERIODS: Array<[PeriodKey, string]> = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['custom', 'Custom']];
/** Period remembered per page (a per-viewer convenience; storage may be unavailable). */
export function usePeriod(storeKey: string, initial: PeriodKey): [Period, (p: Period) => void] {
  const [p, setP] = useState<Period>(() => {
    try { const s = JSON.parse(localStorage.getItem(storeKey) || 'null'); if (s?.key) return s.key === 'custom' ? periodRange('custom', s) : periodRange(s.key); } catch { /* ignore */ }
    return periodRange(initial);
  });
  const set = useCallback((n: Period) => { setP(n); try { localStorage.setItem(storeKey, JSON.stringify(n)); } catch { /* ignore */ } }, [storeKey]);
  return [p, set];
}
export function PeriodSwitcher({value, onChange}: {value: Period; onChange: (p: Period) => void}) {
  const {t} = useLanguage();
  return <div className="zl-actions" role="group" aria-label={t('Period')}>
    <Segmented value={value.key} onChange={k => onChange(periodRange(k, value))} options={PERIODS.map(([k, l]) => [k, t(l)])} label={t('Period')} />
    {value.key === 'custom' && <>
      <input className="zl-input" type="date" aria-label={t('From')} value={value.from} max={value.to} onChange={e => e.target.value && onChange({...value, from: e.target.value})} />
      <input className="zl-input" type="date" aria-label={t('To')} value={value.to} min={value.from} max={todayIso()} onChange={e => e.target.value && onChange({...value, to: e.target.value})} />
    </>}
  </div>;
}

// ---------------- primitives ----------------
export function Segmented<T extends string>({value, onChange, options, label}: {value: T; onChange: (v: T) => void; options: Array<[T, React.ReactNode, number?]>; label?: string}) {
  return <div className="zl-seg" role="group" aria-label={label}>{options.map(([v, l, n]) => <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>{l}{n != null && <span className="count">{n.toLocaleString('en-IN')}</span>}</button>)}</div>;
}
export function PageHeader({eyebrow, title, subtitle, actions}: {eyebrow?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode}) {
  return <header className="zl-ph"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="zl-actions">{actions}</div>}</header>;
}
export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'cyan' | 'grey';
export function Chip({tone = 'grey', dot, children}: {tone?: Tone; dot?: boolean; children: React.ReactNode}) { return <span className={`zl-chip ${tone}`}>{dot && <i aria-hidden="true" />}{children}</span>; }
export const STATUS_TONE: Record<string, Tone> = {Pending: 'amber', Approved: 'blue', Processing: 'violet', Dispatched: 'cyan', Delivered: 'green', Rejected: 'red', Cancelled: 'grey'};
export const PAY_TONE: Record<string, Tone> = {PAID: 'green', PARTIAL: 'amber', UNPAID: 'red', NA: 'grey'};
export const PAY_LABEL: Record<string, string> = {PAID: 'Paid', PARTIAL: 'Partial', UNPAID: 'Unpaid', NA: 'Not billable'};
export function StatusChip({status}: {status: string}) { const {t} = useLanguage(); return <Chip tone={STATUS_TONE[status] || 'grey'} dot>{t(status)}</Chip>; }
export function PayChip({status}: {status: string}) { const {t} = useLanguage(); return <Chip tone={PAY_TONE[status] || 'grey'}>{t(PAY_LABEL[status] || status)}</Chip>; }

export function Delta({value, invert, suffix}: {value: number | null | undefined; invert?: boolean; suffix?: string}) {
  const {t} = useLanguage();
  if (value == null) return <span className="zl-delta flat">{t('no comparison')}</span>;
  const up = value > 0, flat = value === 0, good = invert ? !up : up;
  return <span className={`zl-delta ${flat ? 'flat' : good ? 'up' : 'down'}`}>{flat ? '■' : up ? <ArrowUp size={12} style={{verticalAlign: -1}} aria-hidden="true" /> : <ArrowDown size={12} style={{verticalAlign: -1}} aria-hidden="true" />} {flat ? t('no change') : `${up ? '+' : ''}${value.toLocaleString('en-IN', {maximumFractionDigits: 1})}%`} {suffix}<span className="zl-sr">{up ? t('up') : flat ? '' : t('down')}</span></span>;
}
export function KpiCard({label, value, delta, invert, deltaSuffix, spark, icon, hint, onClick, pressed, color}: {label: string; value: React.ReactNode; delta?: number | null; invert?: boolean; deltaSuffix?: string; spark?: number[]; icon?: React.ReactNode; hint?: React.ReactNode; onClick?: () => void; pressed?: boolean; color?: string}) {
  const body = <>
    <span className="lbl"><span>{label}</span>{icon}</span>
    <span className="val">{value}</span>
    <span className="sub">{delta !== undefined ? <Delta value={delta} invert={invert} suffix={deltaSuffix} /> : <small>{hint}</small>}{spark && spark.length > 1 && <Sparkline data={spark} color={color} label={label} />}</span>
    {delta !== undefined && hint && <small>{hint}</small>}
  </>;
  return onClick ? <button type="button" className="zl-kpi" aria-pressed={pressed} onClick={onClick}>{body}</button> : <div className="zl-kpi">{body}</div>;
}
export function Skeleton({h = 16, w = '100%', r}: {h?: number; w?: number | string; r?: number}) { return <span className="zl-skel" aria-hidden="true" style={{display: 'block', height: h, width: w, borderRadius: r}} />; }
export function KpiSkeletons({n = 6}: {n?: number}) { return <div className="zl-kpis" aria-busy="true">{Array.from({length: n}, (_, i) => <div className="zl-kpi" key={i}><Skeleton h={12} w="50%" /><Skeleton h={26} w="70%" /><Skeleton h={14} w="40%" /></div>)}</div>; }
export function EmptyState({icon, children, action}: {icon?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode}) { return <div className="zl-empty">{icon || <Inbox size={26} aria-hidden="true" />}<div>{children}</div>{action}</div>; }
export function ErrorState({error, retry}: {error: string; retry?: () => void}) { const {t} = useLanguage(); return <div className="zl-err" role="alert"><span><AlertTriangle size={15} style={{verticalAlign: -2}} /> {error}</span>{retry && <button type="button" className="zl-btn sm" onClick={retry}>{t('Retry')}</button>}</div>; }

/** Card wrapper for every chart: title, hint, legend, and the loading / empty / error states. */
export function ChartCard({title, hint, legend, loading, error, retry, empty, children, aside, className = '', height = 220}: {title: React.ReactNode; hint?: React.ReactNode; legend?: React.ReactNode; loading?: boolean; error?: string; retry?: () => void; empty?: React.ReactNode | false; children?: React.ReactNode; aside?: React.ReactNode; className?: string; height?: number}) {
  return <section className={`zl-card ${className}`} aria-busy={loading || undefined}>
    <div className="zl-card-h"><div><h3>{title}</h3>{hint && <p>{hint}</p>}</div>{aside}</div>
    {error ? <ErrorState error={error} retry={retry} /> : loading ? <Skeleton h={height} r={12} /> : empty ? <EmptyState>{empty}</EmptyState> : <>{children}{legend && <div className="zl-legend" style={{marginTop: 10}}>{legend}</div>}</>}
  </section>;
}

// ---------------- data loading ----------------
export function useApi<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(async (quiet = false) => {
    const n = ++seq.current; if (!quiet) setLoading(true); setError('');
    try { const d = await fn(); if (n === seq.current) setData(d); } catch (e) { if (n === seq.current) setError(e instanceof Error ? e.message : 'Something went wrong'); } finally { if (n === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void load(); }, [load]);
  return {data, error, loading, reload: load, setData};
}

// ---------------- toast ----------------
type T = {id: number; kind: 'ok' | 'err'; text: string; undo?: () => void};
const ToastCtx = createContext<(kind: 'ok' | 'err', text: string, undo?: () => void) => void>(() => undefined);
export function ToastHost({children}: {children: React.ReactNode}) {
  const [items, setItems] = useState<T[]>([]);
  const push = useCallback((kind: 'ok' | 'err', text: string, undo?: () => void) => { const id = Date.now() + Math.random(); setItems(v => [...v, {id, kind, text, undo}]); setTimeout(() => setItems(v => v.filter(x => x.id !== id)), undo ? 8000 : kind === 'err' ? 7000 : 3500); }, []);
  const {t} = useLanguage();
  return <ToastCtx.Provider value={push}>{children}{createPortal(<div className="zl-toasts" role="status" aria-live="polite">{items.map(x => <div key={x.id} className={`zl-toast ${x.kind}`}>{x.text}{x.undo && <button type="button" onClick={() => { x.undo!(); setItems(v => v.filter(y => y.id !== x.id)); }}>{t('Undo')}</button>}</div>)}</div>, document.body)}</ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

// ---------------- drawer / modal ----------------
function useTrap(onClose: () => void, busy?: boolean) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null, node = ref.current!, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (node.querySelector('[data-autofocus],input,select,textarea,button') as HTMLElement | null)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); }
      if (e.key !== 'Tab') return;
      const f = [...node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')];
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    node.addEventListener('keydown', key);
    return () => { document.body.style.overflow = overflow; node.removeEventListener('keydown', key); prev?.focus?.(); };
  }, [onClose, busy]);
  return ref;
}
export function Drawer({title, aside, onClose, footer, children, busy}: {title: React.ReactNode; aside?: React.ReactNode; onClose: () => void; footer?: React.ReactNode; children: React.ReactNode; busy?: boolean}) {
  const ref = useTrap(onClose, busy), id = useId(); const {t} = useLanguage();
  return createPortal(<div className="zl zl-layer" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section ref={ref} className="zl-drawer" role="dialog" aria-modal="true" aria-labelledby={id}>
      <header><h2 id={id}>{title}</h2>{aside}<button type="button" className="zl-iconbtn" aria-label={t('Close')} onClick={onClose} disabled={busy}><X size={18} /></button></header>
      <div className="body">{children}</div>
      {footer && <footer className="zl-no-print">{footer}</footer>}
    </section>
  </div>, document.body);
}
export function Modal({title, onClose, footer, children, busy}: {title: React.ReactNode; onClose: () => void; footer?: React.ReactNode; children: React.ReactNode; busy?: boolean}) {
  const ref = useTrap(onClose, busy), id = useId(); const {t} = useLanguage();
  return createPortal(<div className="zl zl-layer center" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section ref={ref} className="zl-modal" role="dialog" aria-modal="true" aria-labelledby={id}>
      <header><h2 id={id}>{title}</h2><button type="button" className="zl-iconbtn" aria-label={t('Close')} onClick={onClose} disabled={busy}><X size={18} /></button></header>
      <div className="body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </section>
  </div>, document.body);
}

// ---------------- data table ----------------
export type Column<R> = {key: string; label: React.ReactNode; render: (r: R) => React.ReactNode; sort?: string; align?: 'right'; hideable?: boolean; foot?: React.ReactNode; className?: string};
export function DataTable<R extends {id: string}>({rows, columns, sort, dir, onSort, onRow, selected, onSelect, activeId, empty, loading, caption, hidden}: {rows: R[]; columns: Column<R>[]; sort?: string; dir?: 'asc' | 'desc'; onSort?: (k: string) => void; onRow?: (r: R) => void; selected?: Set<string>; onSelect?: (ids: Set<string>) => void; activeId?: string | null; empty?: React.ReactNode; loading?: boolean; caption: string; hidden?: Set<string>}) {
  const {t} = useLanguage();
  const cols = columns.filter(c => !hidden?.has(c.key));
  const all = rows.length > 0 && rows.every(r => selected?.has(r.id));
  const hasFoot = cols.some(c => c.foot != null);
  return <div className="zl-table-wrap">
    <table className="zl-table" aria-busy={loading || undefined}>
      <caption className="zl-sr">{caption}</caption>
      <thead><tr>
        {onSelect && <th style={{width: 36}}><input type="checkbox" className="zl-check" aria-label={t('Select all rows on this page')} checked={all} onChange={e => onSelect(e.target.checked ? new Set([...(selected || []), ...rows.map(r => r.id)]) : new Set([...(selected || [])].filter(id => !rows.some(r => r.id === id))))} /></th>}
        {cols.map(c => <th key={c.key} className={c.align === 'right' ? 'r' : ''} aria-sort={c.sort && sort === c.sort ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
          {c.sort && onSort ? <button type="button" onClick={() => onSort(c.sort!)}>{c.label}{sort === c.sort ? (dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ChevronDown size={12} style={{opacity: .35}} />}</button> : c.label}
        </th>)}
      </tr></thead>
      <tbody>
        {loading ? Array.from({length: 8}, (_, i) => <tr key={i}>{onSelect && <td />}{cols.map(c => <td key={c.key}><Skeleton h={14} w={c.align === 'right' ? '60%' : '80%'} /></td>)}</tr>)
          : rows.length ? rows.map(r => <tr key={r.id} aria-selected={activeId === r.id} tabIndex={0} onClick={() => onRow?.(r)} onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onRow?.(r); } }}>
            {onSelect && <td onClick={e => e.stopPropagation()}><input type="checkbox" className="zl-check" aria-label={t('Select row')} checked={selected?.has(r.id) || false} onChange={e => { const n = new Set(selected); if (e.target.checked) n.add(r.id); else n.delete(r.id); onSelect(n); }} /></td>}
            {cols.map(c => <td key={c.key} className={`${c.align === 'right' ? 'r num' : ''} ${c.className || ''}`}>{c.render(r)}</td>)}
          </tr>)
          : <tr><td colSpan={cols.length + (onSelect ? 1 : 0)}>{empty}</td></tr>}
      </tbody>
      {hasFoot && !loading && rows.length > 0 && <tfoot><tr>{onSelect && <td />}{cols.map(c => <td key={c.key} className={c.align === 'right' ? 'r num' : ''}>{c.foot}</td>)}</tr></tfoot>}
    </table>
  </div>;
}
