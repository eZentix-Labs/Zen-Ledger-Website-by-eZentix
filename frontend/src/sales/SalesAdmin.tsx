// Sales team workspace: one page, one period, five questions. Who is on track (Team), how do they compare (Performance),
// what was asked of them (Targets), what money needs checking (Collections) and what happened (Activity).
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {AlertTriangle, ArrowRight, CalendarDays, Check, ClipboardCheck, Copy, IndianRupee, KeyRound, Plus, RefreshCw, Search, Target, TrendingUp, UserCheck, UserPlus, UserX, Users, Wallet} from 'lucide-react';
import {RankBars, StackBar, TrendChart} from '../admin/charts';
import {Chip, Delta, Drawer, EmptyState, ErrorState, METHOD_LABEL, Modal, PageHeader, PeriodSwitcher, Segmented, Skeleton, StatCard, StatSkeletons, ToastHost, count, dateTime, day, inr, useApi, usePeriod, useToast, type Period, type Tone} from '../admin/ui';
import {get, label, send, todayIso} from '../inventory/api';
import {previousWindow} from '../orders/period';
import '../admin/theme.css';
import './sales.css';

type Tab = 'team' | 'performance' | 'targets' | 'collections' | 'activity';
const can = (perms: string[] | null, p: string) => Boolean(perms?.includes(p));
const money = (p: number | null | undefined) => inr(p);
const short = (p: number | null | undefined) => inr(p, true);
const orderNo = (id: string) => id.slice(-10).toUpperCase(); // same number the Orders page shows
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');
const delta = (cur: number, prev: number | undefined) => prev ? Math.round((cur - prev) / Math.abs(prev) * 1000) / 10 : null;
const realEmail = (e?: string) => e && !e.endsWith('@phone.local') ? e : '';

export const TARGET_TYPES: Array<[string, string, boolean]> = [['SALES_AMOUNT', 'Sales amount', true], ['REVENUE', 'Revenue (invoiced)', true], ['ORDER_COUNT', 'Number of orders', false], ['COLLECTION_AMOUNT', 'Payment collection', true], ['NEW_CUSTOMERS', 'New customers', false], ['DELIVERIES', 'Completed deliveries', false]];
const typeLabel = (t: string) => TARGET_TYPES.find(x => x[0] === t)?.[1] || label(t);
const isMoney = (t: any) => Boolean(t.progress?.money) || ['SALES_AMOUNT', 'REVENUE', 'COLLECTION_AMOUNT'].includes(t.type);
export const targetValue = (t: any, v: number) => isMoney(t) ? short(v) : count(v);
const STATE_TONE: Record<string, Tone> = {COMPLETED: 'green', ACTIVE: 'violet', OVERDUE: 'red', UPCOMING: 'blue', CANCELLED: 'grey'};

/** Where a running target should be by today, if the work were spread evenly over its dates. */
function paceOf(t: any) {
  const p = t.progress, start = Date.parse(`${t.startDate}T00:00:00Z`), end = Date.parse(`${t.endDate}T00:00:00Z`), now = Date.parse(`${todayIso()}T00:00:00Z`);
  const total = Math.round((end - start) / 864e5) + 1, elapsed = Math.round((now - start) / 864e5) + 1;
  const expected = Math.max(0, Math.min(100, elapsed / total * 100));
  return {expected, behind: p.state === 'ACTIVE' && (p.pct ?? 0) < expected * .8};
}
function health(t: any): {tone: Tone; text: string} {
  if (t.progress.state === 'COMPLETED') return {tone: 'green', text: 'Target reached'};
  if (t.progress.state === 'OVERDUE') return {tone: 'red', text: 'Target missed'};
  if (t.progress.state === 'UPCOMING') return {tone: 'blue', text: 'Starts soon'};
  if (t.progress.state === 'CANCELLED') return {tone: 'grey', text: 'Cancelled'};
  return paceOf(t).behind ? {tone: 'amber', text: 'Behind pace'} : {tone: 'green', text: 'On track'};
}
/** The target bar. The tick marks where the salesman should be today. */
export function TargetBar({t, compact}: {t: any; compact?: boolean}) {
  const p = t.progress, h = health(t), pace = paceOf(t), running = p.state === 'ACTIVE';
  const color = h.tone === 'amber' ? 'var(--amber)' : h.tone === 'red' ? 'var(--red)' : h.tone === 'green' ? 'var(--green)' : 'var(--accent2)';
  return <div className="sl-target">
    {!compact && <div className="sl-target-h"><span>{t.name}</span><b className="num">{p.pct == null ? '—' : `${p.pct.toLocaleString('en-IN')}%`}</b></div>}
    <div className="sl-bar" role="img" aria-label={`${t.name}: ${p.pct ?? 0}% achieved${running ? `, ${Math.round(pace.expected)}% expected by today` : ''}`}>
      <i style={{width: `${Math.min(100, p.pct ?? 0)}%`, background: color}} />{running && <em style={{left: `${pace.expected}%`}} title={`Expected by today: ${Math.round(pace.expected)}%`} />}
    </div>
    <small className="num">{targetValue(t, p.achieved)} of {targetValue(t, t.targetValue)} · {p.remaining ? (running ? `${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'} left` : `${targetValue(t, p.remaining)} short`) : 'done'}</small>
  </div>;
}

function useRun() {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | null> => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast('ok', ok); return (r ?? true) as T; } catch (e) { toast('err', e instanceof Error ? e.message : 'Something went wrong'); return null; } finally { setBusy(false); }
  }, [toast]);
  return {busy, run};
}
function Field({label: l, wide, hint, children}: {label: string; wide?: boolean; hint?: string; children: React.ReactNode}) {
  return <label className={`zl-field${wide ? ' sl-wide' : ''}`}><span>{l}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function Card({title, hint, aside, children, className = ''}: {title: React.ReactNode; hint?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string}) {
  return <section className={`zl-card sl-panel ${className}`}><div className="zl-card-h"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div>{aside}</div>{children}</section>;
}
function Confirm({title, message, danger, reasonLabel, confirmLabel, onClose, onConfirm}: {title: string; message: string; danger?: boolean; reasonLabel?: string; confirmLabel: string; onClose: () => void; onConfirm: (reason: string) => Promise<void> | void}) {
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false); const toast = useToast();
  const go = async () => { if (reasonLabel && reason.trim().length < 3) return toast('err', 'Give a reason (at least 3 characters)'); setBusy(true); try { await onConfirm(reason.trim()); } finally { setBusy(false); } };
  return <Modal title={title} onClose={onClose} busy={busy} footer={<><button type="button" className="zl-btn" onClick={onClose} disabled={busy}>Go back</button><button type="button" className={`zl-btn ${danger ? 'danger' : 'primary'}`} onClick={() => void go()} disabled={busy}>{confirmLabel}</button></>}>
    <p className="sl-copy">{message}</p>
    {reasonLabel && <Field label={reasonLabel}><textarea className="zl-input" rows={3} value={reason} onChange={e => setReason(e.target.value)} autoFocus /></Field>}
  </Modal>;
}
function CredentialModal({title, intro, login, password, onClose}: {title: string; intro: string; login?: string; password: string; onClose: () => void}) {
  const toast = useToast();
  const copy = () => navigator.clipboard?.writeText(`${login ? `Login: ${login}\n` : ''}Password: ${password}`).then(() => toast('ok', 'Copied')).catch(() => toast('err', 'Could not copy. Select the text instead.'));
  return <Modal title={title} onClose={onClose} footer={<><button type="button" className="zl-btn" onClick={copy}><Copy size={14} aria-hidden="true" />Copy</button><button type="button" className="zl-btn primary" onClick={onClose}>Done</button></>}>
    <p className="sl-copy">{intro}</p>
    <dl className="sl-cred">{login && <div><dt>Login (phone)</dt><dd className="mono">{login}</dd></div>}<div><dt>Temporary password</dt><dd className="mono">{password}</dd></div></dl>
  </Modal>;
}

// ============================ Shell ============================
export function SalesmenPage({initial = 'team'}: {initial?: Tab}) { return <ToastHost><Workspace initial={initial} /></ToastHost>; }
export function TargetsPage() { return <SalesmenPage initial="targets" />; }
export function PerformancePage() { return <SalesmenPage initial="performance" />; }

function Workspace({initial}: {initial: Tab}) {
  const [tab, setTab] = useState<Tab>(initial);
  const [period, setPeriod] = usePeriod('sales.period', 'month');
  const meta = useApi(async () => (await get<any>('/api/inventory/meta')).permissions as string[], []);
  const perms = meta.data;
  const toVerify = useApi(() => can(perms, 'payment.verify') ? get<any>('/api/sales/payments', {status: 'UNVERIFIED', page: 1, limit: 1}) : Promise.resolve(null), [perms]);
  const [add, setAdd] = useState<'salesman' | 'target' | null>(null);
  const [created, setCreated] = useState<any>(null);
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => { setVersion(v => v + 1); void toVerify.reload(true); }, [toVerify]);
  const dated = tab === 'team' || tab === 'performance' || tab === 'activity';
  const pending = toVerify.data?.total || 0;
  const tabs: Array<[Tab, string, number?]> = [['team', 'Team'], ['performance', 'Performance'], ['targets', 'Targets'], ...(can(perms, 'payment.verify') ? [['collections', 'Collections', pending] as [Tab, string, number]] : []), ['activity', 'Activity']];

  return <div className="zl zl-shell sl-page">
    <PageHeader eyebrow="SALES TEAM" title="Sales team" subtitle="Who is on track, who needs help, and what needs your action." actions={dated ? <PeriodSwitcher value={period} onChange={setPeriod} /> : undefined} />
    <nav className="sl-tabs sl-scroll" aria-label="Sales team sections">{tabs.map(([k, l, n]) => <button key={k} type="button" aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{l}{n ? <span className="zl-badge warn">{n}</span> : null}</button>)}</nav>
    <div className="zl-metabar">
      <span className="zl-metabar-range">{dated ? <><CalendarDays size={14} aria-hidden="true" /> Showing {day(period.from)} – {day(period.to)}</> : tab === 'targets' ? 'Targets run on their own dates.' : 'Money salesmen say they collected, waiting for your check.'}</span>
      <span className="zl-metabar-right">
        <button type="button" className="zl-btn sm" onClick={bump}><RefreshCw size={14} aria-hidden="true" />Refresh</button>
        {can(perms, 'target.manage') && <button type="button" className={`zl-btn sm${tab === 'targets' ? ' primary' : ''}`} onClick={() => setAdd('target')}><Target size={14} aria-hidden="true" />Add target</button>}
        {can(perms, 'salesman.manage') && <button type="button" className={`zl-btn sm${tab === 'team' ? ' primary' : ''}`} onClick={() => setAdd('salesman')}><UserPlus size={14} aria-hidden="true" />Add salesman</button>}
      </span>
    </div>

    {tab === 'team' && <TeamTab key={version} period={period} perms={perms} onChanged={bump} goCollections={() => setTab('collections')} toVerify={pending} />}
    {tab === 'performance' && <PerformanceTab key={version} period={period} />}
    {tab === 'targets' && <TargetsTab key={version} perms={perms} />}
    {tab === 'collections' && <CollectionsTab key={version} onChanged={bump} />}
    {tab === 'activity' && <ActivityTab key={version} period={period} />}

    {add === 'salesman' && <SalesmanForm onClose={() => setAdd(null)} onSaved={r => { setAdd(null); bump(); if (r?.temporaryPassword) setCreated(r); }} />}
    {add === 'target' && <TargetFormLoader onClose={() => setAdd(null)} onSaved={() => { setAdd(null); bump(); }} />}
    {created && <CredentialModal title="Salesman account created" intro="Share these sign-in details privately. The temporary password is shown only once; the salesman must change it at first sign-in." login={created.loginWith} password={created.temporaryPassword} onClose={() => setCreated(null)} />}
  </div>;
}
function TargetFormLoader({onClose, onSaved}: {onClose: () => void; onSaved: () => void}) {
  const s = useApi(async () => (await get<any>('/api/salesmen', {status: 'ACTIVE'})).items.map((x: any) => ({id: x.id, name: x.name})) as Array<{id: string; name: string}>, []);
  return s.data ? <TargetForm salesmen={s.data} onClose={onClose} onSaved={onSaved} /> : null;
}

// ============================ Team ============================
type Flag = {tone: Tone; text: string};
function flagsOf(s: any): Flag[] {
  if (!s.active) return [];
  const m = s.metrics, out: Flag[] = [];
  if (s.mainTarget && paceOf(s.mainTarget).behind) out.push({tone: 'amber', text: 'Behind pace'});
  if (!s.mainTarget) out.push({tone: 'blue', text: 'No target set'});
  if (m.unverifiedCollectionsPaise > 0) out.push({tone: 'amber', text: `${short(m.unverifiedCollectionsPaise)} to verify`});
  if (!m.ordersCreated && !m.countedOrders) out.push({tone: 'grey', text: 'No orders in this period'});
  if (s.mustChangePassword) out.push({tone: 'grey', text: 'Temporary password not changed'});
  return out;
}
const SORTS: Record<string, [string, (a: any, b: any) => number]> = {
  sales: ['Highest sales', (a, b) => b.metrics.salesPaise - a.metrics.salesPaise],
  target: ['Lowest target %', (a, b) => (a.mainTarget?.progress.pct ?? 1e9) - (b.mainTarget?.progress.pct ?? 1e9)],
  due: ['Most to collect', (a, b) => b.metrics.outstandingPaise - a.metrics.outstandingPaise],
  name: ['Name', (a, b) => a.name.localeCompare(b.name)],
};
function TeamTab({period, perms, onChanged, goCollections, toVerify}: {period: Period; perms: string[] | null; onChanged: () => void; goCollections: () => void; toVerify: number}) {
  const list = useApi(() => get<any>('/api/salesmen', {from: period.from, to: period.to, status: 'all'}), [period.from, period.to]);
  const prevRange = useMemo(() => previousWindow(period.from, period.to), [period.from, period.to]);
  const prev = useApi(() => get<any>('/api/salesmen', {...prevRange, status: 'all'}), [prevRange.from, prevRange.to]);
  const [q, setQ] = useState(''), [show, setShow] = useState<'active' | 'attention' | 'inactive'>('active'), [sort, setSort] = useState('sales');
  const [open, setOpen] = useState<string | null>(null), [edit, setEdit] = useState<any>(null), [assign, setAssign] = useState<any>(null);
  const items: any[] = list.data?.items || [];
  const prevOf = useMemo(() => new Map<string, any>((prev.data?.items || []).map((s: any) => [s.id, s.metrics])), [prev.data]);
  const active = items.filter(s => s.active), attention = active.filter(s => flagsOf(s).length), inactive = items.filter(s => !s.active);
  const sum = (rows: any[], k: string) => rows.reduce((a, s) => a + (s.metrics?.[k] ?? 0), 0);
  const prevItems: any[] = prev.data?.items || [];
  const goals = active.map(s => s.mainTarget).filter((t: any) => t?.type === 'SALES_AMOUNT');
  const goal = goals.reduce((a: number, t: any) => a + t.targetValue, 0), reached = goals.reduce((a: number, t: any) => a + t.progress.achieved, 0);
  const shown = (show === 'active' ? active : show === 'attention' ? attention : inactive).filter(s => !q || `${s.name} ${s.phone} ${s.employeeId || ''} ${s.territory || ''}`.toLowerCase().includes(q.toLowerCase())).sort(SORTS[sort][1]);
  const reload = () => { void list.reload(true); onChanged(); };

  if (list.error) return <ErrorState error={list.error} retry={() => void list.reload()} />;
  if (!list.data) return <><StatSkeletons /><div className="sl-grid">{[0, 1, 2].map(i => <Skeleton key={i} h={250} r={16} />)}</div></>;
  return <>
    <section className="zl-stats" aria-label="Team figures">
      <StatCard label="Team sales" value={short(sum(items, 'salesPaise'))} exact={money(sum(items, 'salesPaise'))} delta={prev.data ? delta(sum(items, 'salesPaise'), sum(prevItems, 'salesPaise')) : undefined} icon={<IndianRupee size={16} />} hint={`${count(sum(items, 'countedOrders'))} orders · sales count when ${list.data.policy === 'DISPATCHED' ? 'dispatched' : 'approved'}`} />
      <StatCard label="Collected" value={short(sum(items, 'collectedPaise'))} exact={money(sum(items, 'collectedPaise'))} delta={prev.data ? delta(sum(items, 'collectedPaise'), sum(prevItems, 'collectedPaise')) : undefined} icon={<ClipboardCheck size={16} />} hint="Verified payments only" />
      <StatCard label="To collect now" value={short(sum(items, 'outstandingPaise'))} exact={money(sum(items, 'outstandingPaise'))} tone={sum(items, 'outstandingPaise') ? 'amber' : 'violet'} icon={<Wallet size={16} />} hint="Dispatched orders not yet paid, all time" />
      <StatCard label="Team target" value={goal ? `${Math.round(reached / goal * 100)}%` : '—'} icon={<Target size={16} />} tone={goal && reached / goal < .5 ? 'amber' : 'violet'} hint={goal ? `${short(reached)} of ${short(goal)}` : 'No sales targets in this period'} />
      <StatCard label="To verify" value={count(toVerify)} tone={toVerify ? 'amber' : 'violet'} icon={<Check size={16} />} hint={`${short(sum(items, 'unverifiedCollectionsPaise'))} not counted until checked`} onClick={can(perms, 'payment.verify') ? goCollections : undefined} />
    </section>

    <div className="sl-tools">
      <Segmented value={show} onChange={setShow} label="Show" options={[['active', 'Active', active.length], ['attention', 'Needs attention', attention.length], ['inactive', 'Inactive', inactive.length]]} />
      <label className="zl-search sl-search"><Search size={16} aria-hidden="true" /><input type="search" className="zl-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Name, phone, ID or territory" aria-label="Search salesmen" /></label>
      <select className="zl-select" value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort by">{Object.entries(SORTS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
    </div>

    {shown.length ? <div className="sl-grid">{shown.map(s => { const m = s.metrics, flags = flagsOf(s), before = prevOf.get(s.id); return <article key={s.id} className={`sl-card${s.active ? '' : ' off'}`}>
      <button type="button" className="sl-card-open" onClick={() => setOpen(s.id)} aria-label={`Open ${s.name}`}>
        <span className="sl-who"><span className="zl-avatar" aria-hidden="true">{initials(s.name)}</span><span className="sl-name"><b>{s.name}</b><small>{[s.territory || 'No territory', s.employeeId].filter(Boolean).join(' · ')}</small></span>{s.active ? s.mainTarget && <Chip tone={health(s.mainTarget).tone} dot>{health(s.mainTarget).text}</Chip> : <Chip tone="red">Inactive</Chip>}</span>
        {s.mainTarget ? <TargetBar t={s.mainTarget} /> : <span className="sl-notarget">No target for this period</span>}
        <span className="sl-nums">
          <span><small>Sales</small><b className="num" title={money(m.salesPaise)}>{short(m.salesPaise)}</b>{before && <Delta value={delta(m.salesPaise, before.salesPaise)} />}</span>
          <span><small>Collected</small><b className="num" title={money(m.collectedPaise)}>{short(m.collectedPaise)}</b></span>
          <span><small>To collect</small><b className={`num${m.outstandingPaise ? ' due' : ''}`} title={money(m.outstandingPaise)}>{short(m.outstandingPaise)}</b></span>
        </span>
        <small className="sl-line">{count(m.countedOrders)} orders · {count(m.pendingOrders)} pending · {count(m.assignedCustomers)} customers</small>
      </button>
      {(flags.length > 0 || can(perms, 'salesman.manage') || can(perms, 'target.manage')) && <div className="sl-card-foot">
        <span className="sl-flags">{flags.filter(f => f.text !== 'Behind pace').map(f => <Chip key={f.text} tone={f.tone}>{f.text}</Chip>)}</span>
        <span className="sl-card-actions">
          {!s.mainTarget && s.active && can(perms, 'target.manage') && <button type="button" className="zl-btn sm" onClick={() => setAssign(s)}>Set target</button>}
          {can(perms, 'salesman.manage') && <button type="button" className="zl-btn ghost sm" onClick={() => setEdit(s)}>Edit</button>}
        </span>
      </div>}
    </article>; })}</div>
      : <EmptyState icon={<Users size={26} aria-hidden="true" />}>{q ? 'No salesman matches your search.' : show === 'attention' ? 'Nobody needs attention right now.' : show === 'inactive' ? 'No inactive salesmen.' : 'No salesmen yet. Add the first one to get started.'}</EmptyState>}

    {shown.some(s => s.mainTarget?.progress.state === 'ACTIVE') && <p className="sl-key"><i aria-hidden="true" />The tick on a bar shows where a salesman should be by today, if the target is spread evenly over its dates.</p>}

    {open && <SalesmanProfile id={open} perms={perms} onClose={() => setOpen(null)} onChanged={reload} onEdit={s => { setOpen(null); setEdit(s); }} />}
    {edit && <SalesmanForm salesman={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    {assign && <TargetForm salesmen={[{id: assign.id, name: assign.name}]} onClose={() => setAssign(null)} onSaved={() => { setAssign(null); reload(); }} />}
  </>;
}

// ============================ Salesman form ============================
function SalesmanForm({salesman, onClose, onSaved}: {salesman?: any; onClose: () => void; onSaved: (r?: any) => void}) {
  const toast = useToast(); const {busy, run} = useRun();
  const customers = useApi(() => get<any[]>('/api/customers'), []);
  const categories = useApi(() => get<any[]>('/api/erp/categories'), []);
  const detail = useApi(() => salesman ? get<any>(`/api/salesmen/${salesman.id}`) : Promise.resolve(null), [salesman?.id]);
  const s = salesman || {};
  const [f, setF] = useState({name: s.name || '', phone: s.phone || '', email: realEmail(s.email), address: s.address || '', employeeId: s.employeeId || '', joiningDate: s.joiningDate || todayIso(), territory: s.territory || '', password: '', generate: true});
  const [custIds, setCustIds] = useState<string[] | null>(null), [catIds, setCatIds] = useState<string[] | null>(null), [cq, setCq] = useState('');
  const curCust: string[] = custIds ?? (detail.data?.customers || []).filter((c: any) => c.assigned).map((c: any) => c.id);
  const curCat: string[] = catIds ?? (detail.data?.assignment?.categoryIds || []);
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({...f, [k]: e.target.value});
  const save = async () => {
    if (f.name.trim().length < 2 || f.phone.replace(/\D/g, '').length < 10) return toast('err', 'Enter the name and a 10-digit phone number');
    if (!salesman && !f.generate && f.password.length < 8) return toast('err', 'Temporary password must be at least 8 characters');
    const body = {name: f.name, phone: f.phone, email: f.email, address: f.address, employeeId: f.employeeId, joiningDate: f.joiningDate, territory: f.territory, customerIds: curCust, categoryIds: curCat};
    const r = await run(() => salesman ? send('PATCH', `/api/salesmen/${salesman.id}`, body) : send('POST', '/api/salesmen', {...body, password: f.generate ? '' : f.password, generatePassword: f.generate}), salesman ? 'Salesman updated' : 'Salesman created');
    if (r) onSaved(r);
  };
  const shownCustomers = (customers.data || []).filter((c: any) => !cq || `${c.name} ${c.phone}`.toLowerCase().includes(cq.toLowerCase()));
  return <Modal title={salesman ? `Edit ${salesman.name}` : 'Add salesman'} onClose={onClose} busy={busy} footer={<><button type="button" className="zl-btn" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="zl-btn primary" onClick={() => void save()} disabled={busy}>{salesman ? 'Save changes' : 'Create account'}</button></>}>
    <div className="sl-form">
      <Field label="Full name *"><input className="zl-input" value={f.name} onChange={up('name')} autoFocus /></Field>
      <Field label="Phone (used to sign in) *"><input className="zl-input" value={f.phone} onChange={up('phone')} inputMode="tel" /></Field>
      <Field label="Territory"><input className="zl-input" value={f.territory} onChange={up('territory')} placeholder="e.g. Howrah North" /></Field>
      <Field label="Employee ID"><input className="zl-input" value={f.employeeId} onChange={up('employeeId')} placeholder="SM-0001" /></Field>
      <Field label="Email"><input className="zl-input" type="email" value={f.email} onChange={up('email')} /></Field>
      <Field label="Joining date"><input className="zl-input" type="date" value={f.joiningDate} onChange={up('joiningDate')} /></Field>
      <Field label="Address" wide><textarea className="zl-input" rows={2} value={f.address} onChange={up('address')} /></Field>
      {!salesman && <fieldset className="sl-set sl-wide"><legend>Sign-in</legend>
        <label className="sl-check"><input type="checkbox" className="zl-check" checked={f.generate} onChange={e => setF({...f, generate: e.target.checked})} /> Generate a secure temporary password</label>
        {!f.generate && <Field label="Temporary password (min 8)"><input className="zl-input" value={f.password} onChange={up('password')} autoComplete="new-password" /></Field>}
        <small>The salesman must set their own password at first sign-in.</small>
      </fieldset>}
      <fieldset className="sl-set sl-wide"><legend>Product categories</legend><small>Leave all unticked to show the full catalogue.</small>
        <div className="sl-checks">{(categories.data || []).map((c: any) => <label key={c._id} className="sl-check"><input type="checkbox" className="zl-check" checked={curCat.includes(c._id)} onChange={e => setCatIds(e.target.checked ? [...curCat, c._id] : curCat.filter(x => x !== c._id))} /> {c.name}</label>)}{categories.data && !categories.data.length && <small>No catalogue categories defined.</small>}</div>
      </fieldset>
      <fieldset className="sl-set sl-wide"><legend>Customers ({curCust.length})</legend>
        <input className="zl-input" placeholder="Filter customers…" aria-label="Filter customers" value={cq} onChange={e => setCq(e.target.value)} />
        <div className="sl-pick">{shownCustomers.map((c: any) => <label key={c.id} className="sl-check"><input type="checkbox" className="zl-check" checked={curCust.includes(c.id)} onChange={e => setCustIds(e.target.checked ? [...curCust, c.id] : curCust.filter(x => x !== c.id))} /> <span>{c.name} · {c.phone}{c.assignedSalesmanId && c.assignedSalesmanId !== salesman?.id ? <small> (assigned to someone else)</small> : null}</span></label>)}{customers.data && !shownCustomers.length && <small>No customers found.</small>}</div>
      </fieldset>
    </div>
  </Modal>;
}

// ============================ Profile ============================
function SalesmanProfile({id, perms, onClose, onChanged, onEdit}: {id: string; perms: string[] | null; onClose: () => void; onChanged: () => void; onEdit: (s: any) => void}) {
  const d = useApi(() => get<any>(`/api/salesmen/${id}`), [id]); const {run} = useRun();
  const [tab, setTab] = useState('targets'), [confirm, setConfirm] = useState<'deactivate' | 'activate' | 'reset' | null>(null), [temp, setTemp] = useState(''), [target, setTarget] = useState(false);
  const s = d.data, m = s?.thisMonth;
  const months = useMemo(() => (s?.history || []).map((h: any) => new Date(`${h.month}-01T00:00:00`).toLocaleDateString('en-IN', {month: 'short'})), [s?.history]);
  return <><Drawer title={s ? s.name : 'Salesman'} onClose={onClose} footer={s && <>
    {can(perms, 'salesman.resetPassword') && <button type="button" className="zl-btn sm" onClick={() => setConfirm('reset')}><KeyRound size={14} aria-hidden="true" />Reset password</button>}
    {can(perms, 'salesman.deactivate') && <button type="button" className={`zl-btn sm${s.active ? ' danger' : ''}`} onClick={() => setConfirm(s.active ? 'deactivate' : 'activate')}>{s.active ? <UserX size={14} aria-hidden="true" /> : <UserCheck size={14} aria-hidden="true" />}{s.active ? 'Deactivate' : 'Reactivate'}</button>}
    {can(perms, 'salesman.manage') && <button type="button" className="zl-btn sm" onClick={() => onEdit(s)}>Edit</button>}
    {can(perms, 'target.manage') && s.active && <button type="button" className="zl-btn primary sm" onClick={() => setTarget(true)}><Plus size={14} aria-hidden="true" />Assign target</button>}
  </>}>
    {d.error ? <ErrorState error={d.error} retry={() => void d.reload()} /> : !s ? <><Skeleton h={70} r={12} /><div style={{height: 12}} /><Skeleton h={220} r={12} /></> : <>
      <div className="sl-dhead"><Chip tone={s.active ? 'green' : 'red'} dot>{s.active ? 'Active' : 'Inactive'}</Chip><span className="sl-muted">{[s.phone, s.territory || 'No territory', s.employeeId, `joined ${day(s.joiningDate)}`].filter(Boolean).join(' · ')}</span></div>
      <h4 className="sl-h4">This month</h4>
      <dl className="sl-mini">
        <div><dt>Sales</dt><dd className="num">{short(m.salesPaise)}</dd><small>{count(m.countedOrders)} orders · avg {short(m.avgOrderValuePaise)}</small></div>
        <div><dt>Collected</dt><dd className="num">{short(m.collectedPaise)}</dd>{m.unverifiedCollectionsPaise ? <small>{short(m.unverifiedCollectionsPaise)} unverified</small> : <small>verified</small>}</div>
        <div><dt>To collect now</dt><dd className="num">{short(m.outstandingPaise)}</dd><small>all dispatched orders</small></div>
        <div><dt>Targets reached</dt><dd className="num">{count(s.completedTargets)} / {count(s.targets.length)}</dd><small>all time</small></div>
        <div><dt>New customers</dt><dd className="num">{count(m.newCustomers)}</dd><small>{count(m.assignedCustomers)} in total</small></div>
        <div><dt>Deliveries</dt><dd className="num">{count(m.deliveries)}</dd><small>this month</small></div>
      </dl>
      <h4 className="sl-h4">Last 6 months</h4>
      {s.history.some((h: any) => h.salesPaise || h.collectedPaise) ? <><TrendChart labels={months} current={s.history.map((h: any) => h.salesPaise)} previous={s.history.map((h: any) => h.collectedPaise)} format={short} ariaLabel={`${s.name}: sales and collections by month`} curName="Sales" prevName="Collected" height={190} />
        <div className="zl-legend sl-legend"><span><i style={{background: 'var(--accent2)'}} />Sales</span><span><i className="dash" />Collected</span></div></> : <p className="sl-muted">No sales in the last 6 months.</p>}
      <div className="sl-subtabs sl-scroll"><Segmented value={tab} onChange={setTab} label="Details" options={[['targets', 'Targets', s.targets.length], ['orders', 'Orders', s.orders.length], ['customers', 'Customers', s.customers.length], ['activity', 'Activity']]} /></div>
      {tab === 'targets' && (s.targets.length ? <ul className="sl-list">{s.targets.map((t: any) => <li key={t._id}><div className="sl-grow"><div className="sl-row"><b>{t.name}</b><Chip tone={STATE_TONE[t.progress.state]}>{label(t.progress.state)}</Chip></div><small>{typeLabel(t.type)} · {day(t.startDate)} – {day(t.endDate)}</small><TargetBar t={t} compact /></div></li>)}</ul> : <p className="sl-muted">No targets assigned.</p>)}
      {tab === 'orders' && (s.orders.length ? <ul className="sl-list">{s.orders.map((o: any) => <li key={o.id}><span className="sl-grow"><b>{o.customerName}</b><small><span className="mono">{orderNo(o.id)}</span> · {day(o.createdAt)}</small></span><span className="sl-end"><b className="num">{money(Math.round(o.total * 100))}</b><small>{o.status}</small></span></li>)}</ul> : <p className="sl-muted">No orders yet.</p>)}
      {tab === 'customers' && (s.customers.length ? <ul className="sl-list">{s.customers.map((c: any) => <li key={c.id}><span className="sl-grow"><b>{c.name}</b><small>{c.phone} · {c.assigned ? 'Assigned' : 'Created by salesman'}</small></span><b className={`num${c.balance > 0 ? ' due' : ''}`}>{money(Math.round(c.balance * 100))}</b></li>)}</ul> : <p className="sl-muted">No customers yet.</p>)}
      {tab === 'activity' && <Timeline items={s.activities} />}
    </>}
  </Drawer>
    {confirm && s && <Confirm title={confirm === 'reset' ? 'Reset password' : confirm === 'deactivate' ? 'Deactivate salesman' : 'Reactivate salesman'} danger={confirm !== 'activate'} reasonLabel={confirm === 'deactivate' ? 'Reason' : undefined} confirmLabel={confirm === 'reset' ? 'Reset password' : label(confirm)}
      message={confirm === 'reset' ? 'A new temporary password is generated and every existing session is signed out.' : confirm === 'deactivate' ? 'The salesman is signed out everywhere and can no longer sign in. Orders, customers and history are kept.' : 'The salesman can sign in again.'}
      onClose={() => setConfirm(null)} onConfirm={async reason => { const r: any = confirm === 'reset' ? await run(() => send('POST', `/api/salesmen/${id}/reset-password`), 'Password reset') : await run(() => send('POST', `/api/salesmen/${id}/status`, {active: confirm === 'activate', reason}), 'Status updated'); setConfirm(null); if (r?.temporaryPassword) setTemp(r.temporaryPassword); if (r) { void d.reload(true); onChanged(); } }} />}
    {temp && <CredentialModal title="New temporary password" intro={`Give this to ${s?.name} privately. It is shown only once.`} password={temp} onClose={() => setTemp('')} />}
    {target && s && <TargetForm salesmen={[{id: s.id, name: s.name}]} onClose={() => setTarget(false)} onSaved={() => { setTarget(false); void d.reload(true); onChanged(); }} />}
  </>;
}

export function Timeline({items}: {items: any[]}) {
  if (!items?.length) return <EmptyState>No activity recorded yet.</EmptyState>;
  return <ol className="zl-tl sl-tl">{items.map((a: any) => <li key={a._id}><div className="sl-row"><span><b>{label(a.type)}</b>{a.salesmanName && <span className="sl-muted"> · {a.salesmanName}</span>}</span>{a.amountPaise != null && <b className="num">{money(a.amountPaise)}</b>}</div>
    <small>{dateTime(a.at)}{a.description ? ` · ${a.description}` : ''}{a.customerName ? ` · ${a.customerName}` : ''}{a.orderId ? ` · ${orderNo(a.orderId)}` : ''}{a.status ? ` · ${label(a.status)}` : ''}</small></li>)}</ol>;
}

// ============================ Targets ============================
export function TargetForm({salesmen, target, onClose, onSaved}: {salesmen: Array<{id: string; name: string}>; target?: any; onClose: () => void; onSaved: () => void}) {
  const toast = useToast(); const {busy, run} = useRun();
  const moneyType = (t: string) => TARGET_TYPES.find(x => x[0] === t)?.[2];
  const [f, setF] = useState({name: target?.name || '', type: target?.type || 'SALES_AMOUNT', period: target?.period || 'MONTHLY', startDate: target?.startDate || todayIso().slice(0, 8) + '01', endDate: target?.endDate || '', value: target ? String(moneyType(target.type) ? target.targetValue / 100 : target.targetValue) : '', description: target?.description || '', instructions: target?.instructions || '', reason: ''});
  const [ids, setIds] = useState<string[]>(target ? [target.salesmanId] : salesmen.length === 1 ? [salesmen[0].id] : []);
  const save = async () => {
    if (!ids.length) return toast('err', 'Choose at least one salesman');
    if (f.name.trim().length < 2 || !(Number(f.value) > 0)) return toast('err', 'Enter a name and a target value above zero');
    if (target && f.reason.trim().length < 3) return toast('err', 'Give a reason for revising the target');
    const body = {name: f.name, salesmanId: ids[0], salesmanIds: ids, type: f.type, period: f.period, startDate: f.startDate, endDate: f.period === 'CUSTOM' ? f.endDate : undefined, targetValue: Number(f.value), description: f.description, instructions: f.instructions};
    if (await run(() => target ? send('PUT', `/api/targets/${target._id}`, {...body, version: target.version, reason: f.reason}) : send('POST', '/api/targets', body), target ? 'Target revised' : `Target assigned to ${ids.length} salesman${ids.length === 1 ? '' : 'men'}`)) onSaved();
  };
  return <Modal title={target ? `Revise target · ${target.name}` : 'Add target'} onClose={onClose} busy={busy} footer={<><button type="button" className="zl-btn" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="zl-btn primary" onClick={() => void save()} disabled={busy}>{target ? 'Save revision' : 'Assign target'}</button></>}>
    <div className="sl-form">
      <Field label="Target name *" wide><input className="zl-input" value={f.name} onChange={e => setF({...f, name: e.target.value})} placeholder="e.g. November sales" autoFocus /></Field>
      <Field label="Type *"><select className="zl-select" value={f.type} disabled={Boolean(target)} onChange={e => setF({...f, type: e.target.value})}>{TARGET_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label={`Target value * ${moneyType(f.type) ? '(₹)' : '(count)'}`}><input className="zl-input" type="number" min="1" step={moneyType(f.type) ? 'any' : '1'} value={f.value} onChange={e => setF({...f, value: e.target.value})} /></Field>
      <Field label="Period *"><select className="zl-select" value={f.period} onChange={e => setF({...f, period: e.target.value})}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly (7 days)</option><option value="MONTHLY">Monthly</option><option value="CUSTOM">Custom range</option></select></Field>
      <Field label="Start date *"><input className="zl-input" type="date" value={f.startDate} onChange={e => setF({...f, startDate: e.target.value})} /></Field>
      {f.period === 'CUSTOM' && <Field label="End date *"><input className="zl-input" type="date" min={f.startDate} value={f.endDate} onChange={e => setF({...f, endDate: e.target.value})} /></Field>}
      {!target && <fieldset className="sl-set sl-wide"><legend>Salesmen * ({ids.length} selected)</legend><small>The same target is created for each.</small><div className="sl-checks">{salesmen.map(s => <label key={s.id} className="sl-check"><input type="checkbox" className="zl-check" checked={ids.includes(s.id)} onChange={e => setIds(e.target.checked ? [...ids, s.id] : ids.filter(x => x !== s.id))} /> {s.name}</label>)}</div></fieldset>}
      <Field label="Description" wide><textarea className="zl-input" rows={2} value={f.description} onChange={e => setF({...f, description: e.target.value})} /></Field>
      <Field label="Instructions for the salesman" wide><textarea className="zl-input" rows={2} value={f.instructions} onChange={e => setF({...f, instructions: e.target.value})} /></Field>
      {target && <Field label="Reason for this revision *" wide hint="Targets are never changed silently; the previous values are kept in the history."><input className="zl-input" value={f.reason} onChange={e => setF({...f, reason: e.target.value})} /></Field>}
    </div>
    <p className="zl-note">Sales and order count use orders approved (or dispatched, per Settings) in the period, excluding pending, rejected and cancelled orders. Revenue uses invoices created. Collections count only payments verified by accounts. New customers count customers created in the period who placed a counted order.</p>
  </Modal>;
}

function TargetsTab({perms}: {perms: string[] | null}) {
  const [salesmanId, setSalesmanId] = useState(''), [type, setType] = useState(''), [state, setState] = useState('');
  const [form, setForm] = useState<any>(null), [hist, setHist] = useState<any>(null), [cancel, setCancel] = useState<any>(null);
  const list = useApi(() => get<any>('/api/targets', {salesmanId, type, state}), [salesmanId, type, state]);
  const salesmen = useApi(async () => (await get<any>('/api/salesmen', {status: 'ACTIVE'})).items.map((s: any) => ({id: s.id, name: s.name})) as Array<{id: string; name: string}>, []);
  const {run} = useRun();
  const sm = list.data?.summary, manage = can(perms, 'target.manage');
  const pick = (v: string) => setState(state === v ? '' : v);
  if (list.error) return <ErrorState error={list.error} retry={() => void list.reload()} />;
  return <>
    {!sm ? <StatSkeletons /> : <section className="zl-stats" aria-label="Target figures">
      <StatCard label="All targets" value={count(sm.total)} icon={<Target size={16} />} hint="Excluding cancelled" onClick={() => setState('')} pressed={!state} />
      <StatCard label="Running" value={count(sm.active)} icon={<TrendingUp size={16} />} hint="In progress now" onClick={() => pick('ACTIVE')} pressed={state === 'ACTIVE'} />
      <StatCard label="Reached" value={count(sm.completed)} icon={<Check size={16} />} hint="Target met" onClick={() => pick('COMPLETED')} pressed={state === 'COMPLETED'} />
      <StatCard label="Missed" value={count(sm.overdue)} tone={sm.overdue ? 'red' : 'violet'} icon={<AlertTriangle size={16} />} hint="Ended below target" onClick={() => pick('OVERDUE')} pressed={state === 'OVERDUE'} />
      <StatCard label="Upcoming" value={count(sm.upcoming)} icon={<CalendarDays size={16} />} hint="Not started yet" onClick={() => pick('UPCOMING')} pressed={state === 'UPCOMING'} />
    </section>}
    <section className="zl-card sl-panel sl-flush">
      <div className="sl-filters">
        <select className="zl-select" value={salesmanId} onChange={e => setSalesmanId(e.target.value)} aria-label="Salesman"><option value="">All salesmen</option>{(salesmen.data || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select className="zl-select" value={type} onChange={e => setType(e.target.value)} aria-label="Type"><option value="">All types</option>{TARGET_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="zl-select" value={state} onChange={e => setState(e.target.value)} aria-label="Status"><option value="">Any status</option><option value="ACTIVE">Running</option><option value="COMPLETED">Reached</option><option value="OVERDUE">Missed</option><option value="UPCOMING">Upcoming</option><option value="CANCELLED">Cancelled</option></select>
      </div>
      {!list.data ? <div className="sl-pad"><Skeleton h={180} r={12} /></div> : list.data.items.length ? <ul className="sl-trows">{list.data.items.map((t: any) => { const h = health(t); return <li key={t._id}>
        <div className="sl-tname"><b>{t.name}</b><small>{t.salesmanName} · {typeLabel(t.type)}{t.revisions?.length ? ` · revised ${t.revisions.length}×` : ''}</small></div>
        <TargetBar t={t} compact />
        <div className="sl-tdates"><Chip tone={h.tone} dot>{h.text}</Chip><small>{day(t.startDate)} – {day(t.endDate)}</small></div>
        <div className="sl-tacts"><button type="button" className="zl-btn ghost sm" onClick={() => setHist(t)}>History</button>{manage && t.status === 'ACTIVE' && <><button type="button" className="zl-btn ghost sm" onClick={() => setForm(t)}>Revise</button><button type="button" className="zl-btn ghost sm" onClick={() => setCancel(t)}>Cancel</button></>}</div>
      </li>; })}</ul> : <EmptyState icon={<Target size={26} aria-hidden="true" />}>{state || type || salesmanId ? 'No targets match these filters.' : 'No targets yet. Add one so the team knows what to aim for.'}</EmptyState>}
    </section>
    {form && <TargetForm salesmen={salesmen.data || []} target={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); void list.reload(true); }} />}
    {hist && <Modal title={`History · ${hist.name}`} onClose={() => setHist(null)}><ol className="zl-tl sl-tl">
      <li><b>Assigned</b><small>{dateTime(hist.createdAt)} · {targetValue(hist, hist.revisions?.[0]?.before?.targetValue ?? hist.targetValue)} by {hist.assignedBy?.name}</small></li>
      {(hist.revisions || []).map((r: any, i: number) => <li key={i}><b>{r.after?.status === 'CANCELLED' ? 'Cancelled' : `Revised to v${r.version}`}</b><small>{dateTime(r.at)} · {r.reason} · {r.by?.name}{r.before?.targetValue != null && r.after?.targetValue != null ? ` · ${targetValue(hist, r.before.targetValue)} → ${targetValue(hist, r.after.targetValue)}` : ''}{r.before?.endDate && r.after?.endDate && r.before.endDate !== r.after.endDate ? ` · ends ${day(r.before.endDate)} → ${day(r.after.endDate)}` : ''}</small></li>)}
    </ol></Modal>}
    {cancel && <Confirm title={`Cancel ${cancel.name}`} danger reasonLabel="Reason" confirmLabel="Cancel target" message="The target stays in the history as cancelled." onClose={() => setCancel(null)} onConfirm={async reason => { if (await run(() => send('POST', `/api/targets/${cancel._id}/cancel`, {reason}), 'Target cancelled')) void list.reload(true); setCancel(null); }} />}
  </>;
}

// ============================ Performance ============================
function PerformanceTab({period}: {period: Period}) {
  const [salesmanId, setSalesmanId] = useState(''), [territory, setTerritory] = useState('');
  const d = useApi(() => get<any>('/api/sales/performance', {from: period.from, to: period.to, salesmanId, territory}), [period.from, period.to, salesmanId, territory]);
  const all = useApi(() => get<any>('/api/sales/performance', {from: period.from, to: period.to}), [period.from, period.to]);
  const p = d.data, t = p?.totals;
  if (d.error) return <ErrorState error={d.error} retry={() => void d.reload()} />;
  if (!p) return <><StatSkeletons /><Skeleton h={320} r={16} /></>;
  const rows = [...p.salesmen].filter((s: any) => s.active || s.salesPaise || s.collectedPaise).sort((a: any, b: any) => b.salesPaise - a.salesPaise);
  const earners = rows.filter((s: any) => s.salesPaise || s.collectedPaise), quiet = rows.length - earners.length;
  const top = Math.max(1, ...earners.map((s: any) => Math.max(s.salesPaise, s.collectedPaise)));
  const byTerritory = [...rows.reduce((m: Map<string, number>, s: any) => m.set(s.territory || 'No territory', (m.get(s.territory || 'No territory') || 0) + s.salesPaise), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const orders = t.successfulOrders + t.pendingOrders + t.cancelledOrders;
  return <>
    <div className="sl-filters sl-bare">
      <select className="zl-select" value={salesmanId} onChange={e => setSalesmanId(e.target.value)} aria-label="Salesman"><option value="">All salesmen</option>{(all.data?.salesmen || p.salesmen).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <select className="zl-select" value={territory} onChange={e => setTerritory(e.target.value)} aria-label="Territory"><option value="">All territories</option>{p.territories.map((x: string) => <option key={x} value={x}>{x}</option>)}</select>
    </div>
    <section className="zl-stats" aria-label="Performance figures">
      <StatCard label="Sales value" value={short(t.salesPaise)} exact={money(t.salesPaise)} icon={<IndianRupee size={16} />} hint={`Invoiced ${short(t.revenuePaise)}`} />
      <StatCard label="Collected" value={short(t.collectedPaise)} exact={money(t.collectedPaise)} icon={<ClipboardCheck size={16} />} hint={`${short(t.unverifiedCollectionsPaise)} awaiting check`} />
      <StatCard label="To collect now" value={short(t.outstandingPaise)} exact={money(t.outstandingPaise)} tone={t.outstandingPaise ? 'amber' : 'violet'} icon={<Wallet size={16} />} hint="Dispatched, not yet paid" />
      <StatCard label="Orders placed" value={count(t.ordersCreated)} icon={<TrendingUp size={16} />} hint={`${count(t.pendingOrders)} pending · ${count(t.cancelledOrders)} cancelled`} />
      <StatCard label="New customers" value={count(t.newCustomers)} icon={<UserPlus size={16} />} hint="With a counted order" />
    </section>
    <div className="sl-two">
      <Card title="Sales vs collected" hint="Who sells, and who brings the money in">
        {earners.length ? <><ul className="sl-pairs">{earners.map((s: any) => <li key={s.id}><div className="sl-row"><b>{s.name}</b><small>{s.territory || 'No territory'}</small></div>
          <div className="sl-pair"><span className="sl-pbar"><i style={{width: `${s.salesPaise / top * 100}%`, background: 'var(--accent2)'}} /></span><b className="num">{short(s.salesPaise)}</b><span className="sl-pbar"><i style={{width: `${s.collectedPaise / top * 100}%`, background: 'var(--cyan)'}} /></span><b className="num">{short(s.collectedPaise)}</b></div></li>)}</ul>
          <div className="zl-legend sl-legend"><span><i style={{background: 'var(--accent2)'}} />Sales</span><span><i style={{background: 'var(--cyan)'}} />Collected</span></div>{quiet > 0 && <p className="zl-note">{quiet} more with no sales or collections in this period.</p>}</> : <EmptyState>No sales or collections in this period.</EmptyState>}
      </Card>
      <div className="sl-stack">
        <Card title="Sales by territory">{byTerritory.some(x => x[1] > 0) ? <RankBars ariaLabel="Sales by territory" items={byTerritory.filter(x => x[1] > 0).map(([k, v]) => ({key: k, label: k, value: v, show: short(v), title: money(v)}))} /> : <EmptyState>No counted sales in this period.</EmptyState>}</Card>
        <Card title="What happened to orders" hint="Orders placed in this period">{orders ? <StackBar ariaLabel="Orders by outcome" format={n => count(n)} items={[{label: 'Dispatched or delivered', value: t.successfulOrders, color: 'var(--green)'}, {label: 'Pending', value: t.pendingOrders, color: 'var(--amber)'}, {label: 'Rejected or cancelled', value: t.cancelledOrders, color: 'var(--red)'}]} /> : <EmptyState>No orders in this period.</EmptyState>}</Card>
      </div>
    </div>
    <div className="sl-half">
      <Card title="Top products" hint="By counted sales">{p.products.length ? <RankBars ariaLabel="Top products" items={p.products.slice(0, 7).map((x: any) => ({key: x.name, label: x.name, sub: `${count(x.qty)} units`, value: x.valuePaise, show: short(x.valuePaise), title: money(x.valuePaise)}))} /> : <EmptyState>No counted sales in this period.</EmptyState>}</Card>
      <Card title="Top customers" hint="By counted sales">{p.customers.length ? <RankBars ariaLabel="Top customers" items={p.customers.slice(0, 7).map((x: any) => ({key: x.name, label: x.name, sub: `${count(x.orders)} orders`, value: x.valuePaise, show: short(x.valuePaise), title: money(x.valuePaise)}))} /> : <EmptyState>No counted sales in this period.</EmptyState>}</Card>
    </div>
    {rows.length > 0 && <Card title="Full comparison" hint="Every figure, side by side" className="sl-flushtable"><div className="sl-scroll"><table className="sl-table"><caption className="zl-sr">Salesman comparison</caption>
      <thead><tr><th scope="col">Salesman</th><th scope="col" className="r">Sales</th><th scope="col" className="r">Orders</th><th scope="col" className="r">Avg order</th><th scope="col" className="r">Collected</th><th scope="col" className="r">To collect</th><th scope="col" className="r">Cancelled</th><th scope="col" className="r">New cust.</th></tr></thead>
      <tbody>{rows.map((s: any) => <tr key={s.id}><th scope="row">{s.name}{!s.active && <small> · Inactive</small>}</th><td className="r num">{short(s.salesPaise)}</td><td className="r num">{count(s.countedOrders)}</td><td className="r num">{short(s.avgOrderValuePaise)}</td><td className="r num">{short(s.collectedPaise)}</td><td className="r num">{short(s.outstandingPaise)}</td><td className="r num">{count(s.cancelledOrders)}</td><td className="r num">{count(s.newCustomers)}</td></tr>)}</tbody>
    </table></div></Card>}
  </>;
}

function Pager({page, total, limit, onPage}: {page: number; total: number; limit: number; onPage: (p: number) => void}) {
  if (total <= limit) return null;
  return <div className="zl-pager"><span>Showing {(page - 1) * limit + 1}–{Math.min(total, page * limit)} of {count(total)}</span><span className="zl-actions"><button type="button" className="zl-btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><button type="button" className="zl-btn sm" disabled={page * limit >= total} onClick={() => onPage(page + 1)}>Next <ArrowRight size={14} aria-hidden="true" /></button></span></div>;
}

// ============================ Activity ============================
const ACTIVITY_TYPES = ['LOGIN', 'CUSTOMER_CREATED', 'CUSTOMERS_ASSIGNED', 'ORDER_SUBMITTED', 'ORDER_APPROVED', 'ORDER_REJECTED', 'ORDER_CANCELLED', 'ORDER_DISPATCHED', 'ORDER_DELIVERED', 'INVOICE_CREATED', 'COLLECTION_SUBMITTED', 'COLLECTION_VERIFIED', 'PAYMENT_RECORDED', 'TARGET_ASSIGNED', 'TARGET_REVISED'];
function ActivityTab({period}: {period: Period}) {
  const [type, setType] = useState(''), [page, setPage] = useState(1), [customer, setCustomer] = useState(''), [salesmanId, setSalesmanId] = useState('');
  const d = useApi(() => get<any>('/api/sales/activities', {from: period.from, to: period.to, salesmanId, type, customer, page, limit: 30}), [period.from, period.to, salesmanId, type, customer, page]);
  const salesmen = useApi(async () => (await get<any>('/api/salesmen', {status: 'all'})).items as any[], []);
  useEffect(() => setPage(1), [period.from, period.to]);
  return <section className="zl-card sl-panel sl-flush">
    <div className="sl-filters">
      <select className="zl-select" value={salesmanId} onChange={e => { setSalesmanId(e.target.value); setPage(1); }} aria-label="Salesman"><option value="">All salesmen</option>{(salesmen.data || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <select className="zl-select" value={type} onChange={e => { setType(e.target.value); setPage(1); }} aria-label="Activity type"><option value="">All activity</option>{ACTIVITY_TYPES.map(x => <option key={x} value={x}>{label(x)}</option>)}</select>
      <input className="zl-input" placeholder="Customer" aria-label="Customer" value={customer} onChange={e => { setCustomer(e.target.value); setPage(1); }} />
    </div>
    {d.error ? <div className="sl-pad"><ErrorState error={d.error} retry={() => void d.reload()} /></div> : !d.data ? <div className="sl-pad"><Skeleton h={220} r={12} /></div> : <><div className="sl-pad"><Timeline items={d.data.items} /></div><Pager page={page} total={d.data.total} limit={30} onPage={setPage} /></>}
    <p className="zl-note sl-pad-note">Business events only. No location or device tracking.</p>
  </section>;
}

// ============================ Collections ============================
const PAY_TONE: Record<string, Tone> = {VERIFIED: 'green', UNVERIFIED: 'amber', REJECTED: 'red', VOID: 'grey'};
function CollectionsTab({onChanged}: {onChanged: () => void}) {
  const [status, setStatus] = useState('UNVERIFIED'), [page, setPage] = useState(1), [decide, setDecide] = useState<{p: any; action: 'verify' | 'reject' | 'void'} | null>(null);
  const d = useApi(() => get<any>('/api/sales/payments', {status, page, limit: 25}), [status, page]); const {run} = useRun();
  return <section className="zl-card sl-panel sl-flush">
    <div className="sl-filters sl-scroll"><Segmented value={status} onChange={v => { setStatus(v); setPage(1); }} label="Collection status" options={[['UNVERIFIED', 'To verify'], ['VERIFIED', 'Verified'], ['REJECTED', 'Rejected'], ['VOID', 'Void']]} /></div>
    {d.error ? <div className="sl-pad"><ErrorState error={d.error} retry={() => void d.reload()} /></div> : !d.data ? <div className="sl-pad"><Skeleton h={160} r={12} /></div> : d.data.items.length ? <><ul className="sl-prows">{d.data.items.map((p: any) => <li key={p._id}>
      <div className="sl-pmain"><b>{p.customerName}</b><small>{day(p.paymentDate)} · {METHOD_LABEL[p.method] || label(p.method)}{p.reference ? ` · ${p.reference}` : ''} · <span className="mono">{orderNo(p.orderId)}</span></small></div>
      <b className="num sl-pamt">{`₹${p.amount.toLocaleString('en-IN')}`}</b>
      <div className="sl-pacts"><Chip tone={PAY_TONE[p.status] || 'grey'}>{label(p.status)}</Chip>{p.status === 'UNVERIFIED' && <><button type="button" className="zl-btn sm" onClick={() => setDecide({p, action: 'reject'})}>Reject</button><button type="button" className="zl-btn primary sm" onClick={() => setDecide({p, action: 'verify'})}><Check size={14} aria-hidden="true" />Verify</button></>}{p.status === 'VERIFIED' && <button type="button" className="zl-btn ghost sm" onClick={() => setDecide({p, action: 'void'})}>Void</button>}</div>
    </li>)}</ul><Pager page={page} total={d.data.total} limit={25} onPage={setPage} /></> : <EmptyState icon={<ClipboardCheck size={26} aria-hidden="true" />}>{status === 'UNVERIFIED' ? 'All caught up. Nothing to verify.' : 'Nothing here.'}</EmptyState>}
    {decide && <Confirm title={`${label(decide.action)} collection`} danger={decide.action !== 'verify'} reasonLabel={decide.action !== 'verify' ? 'Reason' : undefined} confirmLabel={label(decide.action)} message={decide.action === 'verify' ? `Confirms ₹${decide.p.amount.toLocaleString('en-IN')} was received. It then reduces the customer's balance and counts towards collection targets.` : decide.action === 'void' ? 'Reverses the payment\'s effect on the customer balance and invoice.' : 'The collection will not count.'} onClose={() => setDecide(null)} onConfirm={async reason => { if (await run(() => send('POST', `/api/sales/payments/${decide.p._id}/${decide.action}`, {reason}), 'Updated')) { void d.reload(true); onChanged(); } setDecide(null); }} />}
  </section>;
}
