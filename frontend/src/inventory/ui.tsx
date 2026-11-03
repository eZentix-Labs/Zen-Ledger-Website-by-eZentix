import React, {createContext, useCallback, useContext, useEffect, useId, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {ApiError, StoredFile, fileUrl, upload} from './api';

// ---------- toasts ----------
type Toast = {id: number; kind: 'ok' | 'err'; text: string};
const ToastCtx = createContext<(kind: 'ok' | 'err', text: string) => void>(() => undefined);
export function ToastHost({children}: {children: React.ReactNode}) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: 'ok' | 'err', text: string) => { const id = Date.now() + Math.random(); setItems(v => [...v, {id, kind, text}]); setTimeout(() => setItems(v => v.filter(t => t.id !== id)), kind === 'err' ? 7000 : 3500); }, []);
  return <ToastCtx.Provider value={push}>{children}{createPortal(<div className="inv-toasts" role="status" aria-live="polite">{items.map(t => <div key={t.id} className={`inv-toast ${t.kind}`}>{t.text}</div>)}</div>, document.body)}</ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);
export const errText = (e: unknown) => e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong';

// ---------- data loading ----------
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current; setLoading(true); setError('');
    try { const d = await fn(); if (n === seq.current) setData(d); } catch (e) { if (n === seq.current) setError(errText(e)); } finally { if (n === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void reload(); }, [reload]);
  return {data, error, loading, reload, setData};
}
/** Run a mutation with busy state + toasts. */
export function useAction() {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast('ok', ok); return r; } catch (e) { toast('err', errText(e)); return undefined; } finally { setBusy(false); }
  }, [toast]);
  return {busy, run};
}

// ---------- primitives ----------
export function Button({children, variant = 'primary', small, ...p}: React.ButtonHTMLAttributes<HTMLButtonElement> & {variant?: 'primary' | 'ghost' | 'danger' | 'success' | 'subtle'; small?: boolean}) {
  return <button type="button" {...p} className={`inv-btn ${variant}${small ? ' sm' : ''} ${p.className || ''}`}>{children}</button>;
}
export function Card({title, aside, children, className = ''}: {title?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string}) {
  return <section className={`inv-card ${className}`}>{(title || aside) && <header>{typeof title === 'string' ? <h3>{title}</h3> : title}{aside && <div className="inv-actions">{aside}</div>}</header>}{children}</section>;
}
export function Chip({tone = 'grey', children}: {tone?: 'grey' | 'green' | 'amber' | 'red' | 'blue' | 'violet'; children: React.ReactNode}) { return <span className={`inv-chip ${tone}`}>{children}</span>; }
export function Empty({children = 'Nothing here yet.', action}: {children?: React.ReactNode; action?: React.ReactNode}) { return <div className="inv-empty"><p>{children}</p>{action}</div>; }
export function ErrorBox({error, retry}: {error: string; retry?: () => void}) { return error ? <div className="inv-error" role="alert"><span>{error}</span>{retry && <Button variant="ghost" small onClick={retry}>Retry</Button>}</div> : null; }
export function Loading({text = 'Loading…'}: {text?: string}) { return <div className="inv-loading" role="status"><span className="inv-spinner" />{text}</div>; }
export function Table({headers, children, empty}: {headers: React.ReactNode[]; children: React.ReactNode; empty?: React.ReactNode}) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return <div className="inv-table-wrap"><table className="inv-table"><thead><tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{rows.length ? rows : <tr><td colSpan={headers.length}><Empty>{empty || 'No records match.'}</Empty></td></tr>}</tbody></table></div>;
}
export function Pager({page, total, limit, onPage}: {page: number; total: number; limit: number; onPage: (p: number) => void}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return <div className="inv-pager"><small>{total} record{total === 1 ? '' : 's'}</small></div>;
  return <div className="inv-pager"><small>{(page - 1) * limit + 1}–{Math.min(total, page * limit)} of {total}</small><div className="inv-actions"><Button small variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Prev</Button><span className="inv-pageno">{page} / {pages}</span><Button small variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next ›</Button></div></div>;
}
export function Field({label, hint, error, children, wide}: {label: string; hint?: string; error?: string; children: React.ReactNode; wide?: boolean}) {
  return <label className={`inv-field${wide ? ' wide' : ''}`}><span>{label}</span>{children}{hint && !error && <small>{hint}</small>}{error && <small className="inv-field-err">{error}</small>}</label>;
}
export function Input(p: React.InputHTMLAttributes<HTMLInputElement>) { return <input {...p} className={`inv-input ${p.className || ''}`} />; }
export function TextArea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea rows={3} {...p} className="inv-input" />; }
export function Select({options, placeholder, ...p}: React.SelectHTMLAttributes<HTMLSelectElement> & {options: Array<[string, string]>; placeholder?: string}) {
  return <select {...p} className="inv-input">{placeholder !== undefined && <option value="">{placeholder}</option>}{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
}
export function Segment<T extends string>({value, onChange, options}: {value: T; onChange: (v: T) => void; options: Array<[T, string]>}) {
  return <div className="inv-segment" role="group">{options.map(([v, l]) => <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
export function Search({value, onChange, placeholder}: {value: string; onChange: (v: string) => void; placeholder: string}) {
  return <div className="inv-search"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} /></div>;
}
export function Meter({pct, tone}: {pct: number | null; tone?: 'green' | 'amber' | 'red' | 'violet'}) {
  const p = Math.max(0, Math.min(100, pct ?? 0));
  const t = tone || (p >= 100 ? 'green' : p >= 60 ? 'violet' : p >= 30 ? 'amber' : 'red');
  return <div className="inv-meter" role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100}><i className={t} style={{width: `${p}%`}} /></div>;
}

// ---------- dialogs ----------
export function Dialog({title, onClose, children, footer, busy, wide}: {title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; busy?: boolean; wide?: boolean}) {
  const ref = useRef<HTMLElement>(null), titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null, node = ref.current!, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (node.querySelector('input:not([type=hidden]),select,textarea') as HTMLElement | null)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
      if (e.key !== 'Tab') return;
      const f = [...node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')];
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    node.addEventListener('keydown', key);
    return () => { document.body.style.overflow = overflow; node.removeEventListener('keydown', key); prev?.focus?.(); };
  }, [onClose, busy]);
  return createPortal(<div className="inv-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section ref={ref} className={`inv-dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header><h2 id={titleId}>{title}</h2><button type="button" className="inv-x" aria-label="Close" disabled={busy} onClick={onClose}>×</button></header>
      <div className="inv-dialog-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </section>
  </div>, document.body);
}
/** Confirmation with an optional required reason. */
export function Confirm({title, message, confirmLabel = 'Confirm', danger, needReason, onConfirm, onClose}: {title: string; message: React.ReactNode; confirmLabel?: string; danger?: boolean; needReason?: string; onConfirm: (reason: string) => Promise<unknown> | unknown; onClose: () => void}) {
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await onConfirm(reason.trim()); } finally { setBusy(false); } };
  return <Dialog title={title} onClose={onClose} busy={busy} footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} disabled={busy || (Boolean(needReason) && reason.trim().length < 3)} onClick={go}>{busy ? 'Working…' : confirmLabel}</Button></>}>
    <div className="inv-confirm">{message}</div>
    {needReason && <Field label={needReason}><TextArea value={reason} onChange={e => setReason(e.target.value)} maxLength={300} /></Field>}
  </Dialog>;
}

// ---------- images ----------
export function ImageUploader({files, onChange, purpose, max = 6, accept = 'image/jpeg,image/png,image/webp'}: {files: StoredFile[]; onChange: (f: StoredFile[]) => void; purpose: string; max?: number; accept?: string}) {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try { const added: StoredFile[] = []; for (const f of [...list].slice(0, max - files.length)) added.push(await upload(f, purpose)); onChange([...files, ...added]); }
    catch (e) { toast('err', errText(e)); } finally { setBusy(false); }
  };
  const move = (i: number) => { if (i === 0) return; const next = [...files]; const [f] = next.splice(i, 1); next.unshift(f); onChange(next); };
  return <div className="inv-uploader">
    {files.map((f, i) => <figure key={f.url} className={i === 0 ? 'primary' : ''}><img src={fileUrl(f.url)} alt={f.name || 'image'} loading="lazy" /><figcaption>{i === 0 ? <span className="inv-chip violet">Main</span> : <button type="button" onClick={() => move(i)}>Make main</button>}<button type="button" aria-label="Remove image" onClick={() => onChange(files.filter(x => x.url !== f.url))}>Remove</button></figcaption></figure>)}
    {files.length < max && <label className={`inv-dropzone${busy ? ' busy' : ''}`}><input type="file" accept={accept} multiple disabled={busy} onChange={e => { void add(e.target.files); e.target.value = ''; }} /><span>{busy ? 'Uploading…' : '+ Add image'}</span><small>JPG, PNG or WebP · max 10 MB</small></label>}
  </div>;
}
export function Thumb({url, alt, size = 40}: {url?: string | null; alt: string; size?: number}) {
  return url ? <img className="inv-thumb" src={fileUrl(url)} alt={alt} width={size} height={size} loading="lazy" /> : <span className="inv-thumb ph" style={{width: size, height: size}} aria-hidden="true"><svg viewBox="0 0 24 24" width={size * .5} height={size * .5} fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M12 3v18M10 12h.01M14 12h.01" /></svg></span>;
}
