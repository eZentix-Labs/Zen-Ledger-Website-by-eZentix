import React, {useState} from 'react';
import {dateTime, day, get, label, rupees, send, shiftDays, todayIso} from '../inventory/api';
import {Button, Card, Chip, Confirm, Dialog, Empty, ErrorBox, Field, Input, Loading, Meter, Pager, Search, Segment, Select, Table, TextArea, ToastHost, useAction, useLoad, useToast} from '../inventory/ui';
import '../inventory/inventory.css';

type Perms = string[];
const usePerms = () => useLoad(async () => (await get<any>('/api/inventory/meta')).permissions as Perms, []);
export const TARGET_TYPES: Array<[string, string, boolean]> = [['SALES_AMOUNT', 'Sales amount', true], ['REVENUE', 'Revenue (invoiced)', true], ['ORDER_COUNT', 'Number of orders', false], ['COLLECTION_AMOUNT', 'Payment collection', true], ['NEW_CUSTOMERS', 'New customers', false], ['DELIVERIES', 'Completed deliveries', false]];
const tLabel = (t: string) => TARGET_TYPES.find(x => x[0] === t)?.[1] || label(t);
const STATE_TONE: Record<string, any> = {COMPLETED: 'green', ACTIVE: 'violet', OVERDUE: 'red', UPCOMING: 'blue', CANCELLED: 'grey'};
export const targetValue = (t: any, v: number) => t.progress?.money || ['SALES_AMOUNT', 'REVENUE', 'COLLECTION_AMOUNT'].includes(t.type) ? rupees(v) : String(v);

export function SalesWorkspace() {
  const [section, setSection] = useState<'team' | 'targets' | 'performance'>('team');
  return <div className="inv sales-workspace"><div className="inv-pg">
    <div className="sales-workspace-head"><div><div className="inv-eb">Sales management</div><h1>Sales team</h1><p>Manage your salesmen, set measurable goals and review results from one workspace.</p></div></div>
    <div className="sales-workspace-tabs" role="tablist" aria-label="Sales management sections">
      {([['team', 'Salesmen', 'Manage accounts and territories'], ['targets', 'Targets', 'Assign and track goals'], ['performance', 'Performance', 'Review sales and collections']] as const).map(([key, title, hint]) => <button key={key} role="tab" aria-selected={section === key} className={section === key ? 'active' : ''} onClick={() => setSection(key)}><strong>{title}</strong><small>{hint}</small></button>)}
    </div>
    {section === 'team' ? <SalesmenPage /> : section === 'targets' ? <TargetsPage /> : <PerformancePage />}
  </div></div>;
}

type Range = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
function rangeOf(r: Range, c: {from: string; to: string}) {
  const t = todayIso();
  if (r === 'today') return {from: t, to: t};
  if (r === 'yesterday') return {from: shiftDays(t, -1), to: shiftDays(t, -1)};
  if (r === 'week') { const dow = (new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7; return {from: shiftDays(t, -dow), to: t}; }
  if (r === 'month') return {from: t.slice(0, 8) + '01', to: t};
  return c;
}
function RangePicker({value, onChange, custom, setCustom}: {value: Range; onChange: (r: Range) => void; custom: {from: string; to: string}; setCustom: (c: {from: string; to: string}) => void}) {
  return <div className="inv-actions"><Segment value={value} onChange={onChange} options={[['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']]} />{value === 'custom' && <><Input type="date" value={custom.from} max={custom.to} onChange={e => setCustom({...custom, from: e.target.value})} aria-label="From" style={{width: 150}} /><Input type="date" value={custom.to} min={custom.from} onChange={e => setCustom({...custom, to: e.target.value})} aria-label="To" style={{width: 150}} /></>}</div>;
}
export function TargetBar({t}: {t: any}) {
  const p = t.progress;
  return <div><div className="inv-actions" style={{justifyContent: 'space-between'}}><span><b>{targetValue(t, p.achieved)}</b> of {targetValue(t, t.targetValue)}</span><span><b>{p.pct == null ? '—' : `${p.pct}%`}</b></span></div><Meter pct={p.pct} tone={p.state === 'COMPLETED' ? 'green' : p.state === 'OVERDUE' ? 'red' : undefined} /><small>{p.remaining ? `${targetValue(t, p.remaining)} remaining` : 'Target reached'} · {p.state === 'ACTIVE' ? `${p.daysLeft} day(s) left` : label(p.state)}</small></div>;
}

// ============================ Salesmen ============================
function SalesmenDirectory() {
  const perms = usePerms();
  const [q, setQ] = useState(''), [status, setStatus] = useState('ACTIVE'), [form, setForm] = useState<any | null | 'new'>(null), [open, setOpen] = useState<string | null>(null), [created, setCreated] = useState<any>(null);
  const list = useLoad(() => get<any>('/api/salesmen', {q, status}), [q, status]);
  const can = (p: string) => perms.data?.includes(p);
  return <ToastHost><div className="inv"><div className="inv-pg">
    <div className="inv-head"><div><div className="inv-eb">Sales management</div><h1>Salesmen</h1><p>Create salesman logins, assign customers, product categories and targets, and see what each salesman is achieving this month.</p></div>{can('salesman.manage') && <Button onClick={() => setForm('new')}>+ Add salesman</Button>}</div>
    <div style={{height: 18}} />
    <Card title={`${list.data?.items.length ?? '…'} salesmen`} aside={<small>This month · sales count when orders are {list.data?.policy === 'DISPATCHED' ? 'dispatched' : 'approved'}</small>}>
      <div className="inv-filters"><Search value={q} onChange={setQ} placeholder="Name, phone, employee ID or territory" /><Select value={status} onChange={e => setStatus(e.target.value)} options={[['ACTIVE', 'Active'], ['INACTIVE', 'Inactive'], ['all', 'All']]} /></div>
      <ErrorBox error={list.error} retry={list.reload} />
      {!list.data ? <Loading /> : <Table headers={['Salesman', 'Employee ID', 'Territory', 'Monthly target', <span className="num">Sales</span>, <span className="num">Orders</span>, <span className="num">Collected</span>, <span className="num">Outstanding</span>, 'Status', '']} empty={<>No salesmen yet.{can('salesman.manage') && <> <Button variant="subtle" onClick={() => setForm('new')}>Add the first one</Button></>}</>}>
        {list.data.items.map((s: any) => <tr key={s.id}><td><strong>{s.name}</strong><small>{s.phone}{s.email && !s.email.endsWith('@phone.local') ? ` · ${s.email}` : ''}</small></td><td className="inv-mono">{s.employeeId || '—'}</td><td>{s.territory || '—'}</td><td style={{minWidth: 190}}>{s.mainTarget ? <TargetBar t={s.mainTarget} /> : <small>No target</small>}</td><td className="num">{rupees(s.metrics.salesPaise)}</td><td className="num">{s.metrics.countedOrders}<small>{s.metrics.pendingOrders} pending</small></td><td className="num">{rupees(s.metrics.collectedPaise)}</td><td className="num">{rupees(s.metrics.outstandingPaise)}</td><td>{s.active ? <Chip tone="green">Active</Chip> : <Chip tone="red">Inactive</Chip>}{s.mustChangePassword && <small>temp. password</small>}</td><td><div className="inv-actions"><Button small variant="ghost" onClick={() => setOpen(s.id)}>Profile</Button>{can('salesman.manage') && <Button small variant="ghost" onClick={() => setForm(s)}>Edit</Button>}</div></td></tr>)}
      </Table>}
    </Card>
    {form && <SalesmanForm salesman={form === 'new' ? undefined : form} onClose={() => setForm(null)} onSaved={r => { setForm(null); void list.reload(); if (r?.temporaryPassword) setCreated(r); }} />}
    {created && <Dialog title="Salesman account created" onClose={() => setCreated(null)} footer={<Button onClick={() => setCreated(null)}>Done</Button>}><p>Share these sign-in details privately. The temporary password is shown <b>only once</b>; the salesman must change it at first sign-in.</p><div className="inv-kv" style={{marginTop: 14}}><div><span>Login (phone)</span><b className="inv-mono" style={{fontSize: 16}}>{created.loginWith}</b></div><div><span>Temporary password</span><b className="inv-mono" style={{fontSize: 16}}>{created.temporaryPassword}</b></div></div><Button variant="ghost" small onClick={() => navigator.clipboard?.writeText(`Login: ${created.loginWith}\nPassword: ${created.temporaryPassword}`)}>Copy</Button></Dialog>}
    {open && <SalesmanProfile id={open} perms={perms.data || []} onClose={() => setOpen(null)} onChanged={() => void list.reload()} />}
  </div></div></ToastHost>;
}

export function SalesmenPage() {
  const [section, setSection] = useState<'team' | 'targets' | 'performance'>('team');
  return <div className="inv sales-workspace"><div className="inv-pg">
    <div className="sales-workspace-head"><div><div className="inv-eb">Sales management</div><h1>Sales team</h1><p>Manage your salesmen, set measurable goals and review results from one workspace.</p></div></div>
    <div className="sales-workspace-tabs" role="tablist" aria-label="Sales management sections">
      {([['team', 'Salesmen', 'Manage accounts and territories'], ['targets', 'Targets', 'Assign and track goals'], ['performance', 'Performance', 'Review sales and collections']] as const).map(([key, title, hint]) => <button key={key} role="tab" aria-selected={section === key} className={section === key ? 'active' : ''} onClick={() => setSection(key)}><strong>{title}</strong><small>{hint}</small></button>)}
    </div>
    {section === 'team' ? <SalesmenDirectory /> : section === 'targets' ? <TargetsPage /> : <PerformancePage />}
  </div></div>;
}

function SalesmanForm({salesman, onClose, onSaved}: {salesman?: any; onClose: () => void; onSaved: (r?: any) => void}) {
  const toast = useToast(); const {busy, run} = useAction();
  const customers = useLoad(() => get<any[]>('/api/customers'), []);
  const categories = useLoad(() => get<any[]>('/api/erp/categories'), []);
  const detail = useLoad(() => salesman ? get<any>(`/api/salesmen/${salesman.id}`) : Promise.resolve(null), [salesman?.id]);
  const s = salesman || {};
  const [f, setF] = useState({name: s.name || '', phone: s.phone || '', email: s.email && !s.email.endsWith('@phone.local') ? s.email : '', address: s.address || '', employeeId: s.employeeId || '', joiningDate: s.joiningDate || todayIso(), territory: s.territory || '', password: '', generate: true});
  const [custIds, setCustIds] = useState<string[] | null>(null), [catIds, setCatIds] = useState<string[] | null>(null), [cq, setCq] = useState('');
  const curCust = custIds ?? (detail.data?.customers || []).filter((c: any) => c.assigned).map((c: any) => c.id);
  const curCat = catIds ?? (detail.data?.assignment?.categoryIds || []);
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({...f, [k]: e.target.value});
  const save = async () => {
    if (f.name.trim().length < 2 || f.phone.replace(/\D/g, '').length < 10) return toast('err', 'Enter the name and a 10-digit phone number');
    if (!salesman && !f.generate && f.password.length < 8) return toast('err', 'Temporary password must be at least 8 characters');
    const body = {name: f.name, phone: f.phone, email: f.email, address: f.address, employeeId: f.employeeId, joiningDate: f.joiningDate, territory: f.territory, customerIds: curCust, categoryIds: curCat};
    const r = await run(() => salesman ? send('PATCH', `/api/salesmen/${salesman.id}`, body) : send('POST', '/api/salesmen', {...body, password: f.generate ? '' : f.password, generatePassword: f.generate}), salesman ? 'Salesman updated' : 'Salesman created');
    if (r) onSaved(r);
  };
  return <Dialog title={salesman ? `Edit ${salesman.name}` : 'Add salesman'} onClose={onClose} busy={busy} wide footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy}>{salesman ? 'Save' : 'Create account'}</Button></>}>
    <div className="inv-form three">
      <Field label="Full name *"><Input value={f.name} onChange={up('name')} /></Field>
      <Field label="Phone (login) *"><Input value={f.phone} onChange={up('phone')} inputMode="tel" /></Field>
      <Field label="Email"><Input type="email" value={f.email} onChange={up('email')} /></Field>
      <Field label="Employee ID"><Input value={f.employeeId} onChange={up('employeeId')} placeholder="SM-0001" /></Field>
      <Field label="Joining date"><Input type="date" value={f.joiningDate} onChange={up('joiningDate')} /></Field>
      <Field label="Territory"><Input value={f.territory} onChange={up('territory')} placeholder="e.g. Howrah North" /></Field>
      <Field label="Address" wide><TextArea value={f.address} onChange={up('address')} /></Field>
      {!salesman && <><div className="inv-section-title">Sign-in</div>
        <label className="inv-check"><input type="checkbox" checked={f.generate} onChange={e => setF({...f, generate: e.target.checked})} /> Generate a secure temporary password</label>
        {!f.generate && <Field label="Temporary password (min 8)"><Input type="text" value={f.password} onChange={up('password')} autoComplete="new-password" /></Field>}
        <small style={{gridColumn: '1/-1'}}>Passwords are stored only as secure hashes. The salesman must set their own password at first sign-in.</small></>}
      <div className="inv-section-title">Assigned product categories (empty = full catalogue)</div>
      <div className="inv-field wide"><div className="inv-actions">{(categories.data || []).map((c: any) => <label key={c._id} className="inv-check"><input type="checkbox" checked={curCat.includes(c._id)} onChange={e => setCatIds(e.target.checked ? [...curCat, c._id] : curCat.filter((x: string) => x !== c._id))} /> {c.name}</label>)}{!categories.data?.length && <small>No catalogue categories defined.</small>}</div></div>
      <div className="inv-section-title">Assigned customers ({curCust.length})</div>
      <div className="inv-field wide"><Input placeholder="Filter customers…" value={cq} onChange={e => setCq(e.target.value)} /><div style={{maxHeight: 180, overflow: 'auto', marginTop: 6}}>{(customers.data || []).filter((c: any) => !cq || `${c.name} ${c.phone}`.toLowerCase().includes(cq.toLowerCase())).map((c: any) => <label key={c.id} className="inv-check"><input type="checkbox" checked={curCust.includes(c.id)} onChange={e => setCustIds(e.target.checked ? [...curCust, c.id] : curCust.filter((x: string) => x !== c.id))} /> {c.name} · {c.phone}{c.assignedSalesmanId && c.assignedSalesmanId !== salesman?.id ? ' (assigned to someone else)' : ''}</label>)}</div></div>
    </div>
  </Dialog>;
}

function SalesmanProfile({id, perms, onClose, onChanged}: {id: string; perms: Perms; onClose: () => void; onChanged: () => void}) {
  const d = useLoad(() => get<any>(`/api/salesmen/${id}`), [id]); const {run} = useAction();
  const [tab, setTab] = useState('performance'), [confirm, setConfirm] = useState<'deactivate' | 'activate' | 'reset' | null>(null), [temp, setTemp] = useState(''), [target, setTarget] = useState(false);
  const s = d.data, m = s?.thisMonth;
  return <Dialog title={s ? s.name : 'Salesman'} onClose={onClose} wide footer={s && <>
    {perms.includes('salesman.resetPassword') && <Button variant="ghost" onClick={() => setConfirm('reset')}>Reset password</Button>}
    {perms.includes('salesman.deactivate') && <Button variant={s.active ? 'danger' : 'success'} onClick={() => setConfirm(s.active ? 'deactivate' : 'activate')}>{s.active ? 'Deactivate' : 'Reactivate'}</Button>}
    {perms.includes('target.manage') && <Button onClick={() => setTarget(true)}>Assign target</Button>}
  </>}>
    <ErrorBox error={d.error} retry={d.reload} />
    {!s ? <Loading /> : <>
      <div className="inv-actions" style={{marginBottom: 10}}>{s.active ? <Chip tone="green">Active</Chip> : <Chip tone="red">Inactive</Chip>}<span className="inv-mono">{s.employeeId || 'No employee ID'}</span><small>{s.phone} · {s.territory || 'no territory'} · joined {day(s.joiningDate)}</small></div>
      <div className="inv-tiles six">
        <div className="inv-tile"><span>Sales this month</span><div className="v">{rupees(m.salesPaise)}</div><small>{m.countedOrders} order(s) · avg {rupees(m.avgOrderValuePaise)}</small></div>
        <div className="inv-tile"><span>Collected</span><div className="v green">{rupees(m.collectedPaise)}</div>{m.unverifiedCollectionsPaise ? <small>{rupees(m.unverifiedCollectionsPaise)} unverified</small> : null}</div>
        <div className="inv-tile"><span>Pending collections</span><div className="v amber">{rupees(m.outstandingPaise)}</div><small>all dispatched orders</small></div>
        <div className="inv-tile"><span>Targets completed</span><div className="v">{s.completedTargets} / {s.targets.length}</div></div>
        <div className="inv-tile"><span>New customers</span><div className="v">{m.newCustomers}</div><small>{m.assignedCustomers} assigned in total</small></div>
        <div className="inv-tile"><span>Deliveries</span><div className="v">{m.deliveries}</div><small>this month</small></div>
      </div>
      <Segment value={tab} onChange={setTab} options={[['performance', 'Monthly history'], ['targets', `Targets (${s.targets.length})`], ['activity', 'Activity'], ['orders', `Orders (${s.orders.length})`], ['customers', `Customers (${s.customers.length})`]]} />
      <div style={{marginTop: 12}}>
        {tab === 'performance' && <Table headers={['Month', <span className="num">Sales</span>, <span className="num">Orders counted</span>, <span className="num">Avg order</span>, <span className="num">Collected</span>, <span className="num">Cancelled</span>, <span className="num">New customers</span>, <span className="num">Deliveries</span>]}>{s.history.map((h: any) => <tr key={h.month}><td>{new Date(h.month + '-01T00:00:00').toLocaleDateString('en-IN', {month: 'long', year: 'numeric'})}</td><td className="num">{rupees(h.salesPaise)}</td><td className="num">{h.countedOrders}</td><td className="num">{rupees(h.avgOrderValuePaise)}</td><td className="num">{rupees(h.collectedPaise)}</td><td className="num">{h.cancelledOrders}</td><td className="num">{h.newCustomers}</td><td className="num">{h.deliveries}</td></tr>)}</Table>}
        {tab === 'targets' && (s.targets.length ? s.targets.map((t: any) => <div className="inv-row" key={t._id}><div className="grow"><strong>{t.name}</strong><small>{tLabel(t.type)} · {day(t.startDate)} – {day(t.endDate)} · v{t.version}</small><TargetBar t={t} /></div><Chip tone={STATE_TONE[t.progress.state]}>{label(t.progress.state)}</Chip></div>) : <Empty>No targets assigned.</Empty>)}
        {tab === 'activity' && <Timeline items={s.activities} />}
        {tab === 'orders' && <Table headers={['Order', 'Date', 'Customer', <span className="num">Total</span>, 'Status']}>{s.orders.map((o: any) => <tr key={o.id}><td className="inv-mono">{o.id.slice(-10)}</td><td>{day(o.createdAt)}</td><td>{o.customerName}</td><td className="num">{rupees(o.total * 100)}</td><td><Chip>{o.status}</Chip></td></tr>)}</Table>}
        {tab === 'customers' && <Table headers={['Customer', 'Phone', <span className="num">Balance</span>, 'Relationship']}>{s.customers.map((c: any) => <tr key={c.id}><td>{c.name}</td><td>{c.phone}</td><td className="num">{rupees(c.balance * 100)}</td><td>{c.assigned ? 'Assigned' : 'Created by salesman'}</td></tr>)}</Table>}
      </div>
    </>}
    {confirm && s && <Confirm title={confirm === 'reset' ? 'Reset password' : confirm === 'deactivate' ? 'Deactivate salesman' : 'Reactivate salesman'} danger={confirm !== 'activate'} needReason={confirm === 'deactivate' ? 'Reason' : undefined} confirmLabel={confirm === 'reset' ? 'Reset password' : label(confirm)}
      message={confirm === 'reset' ? 'A new temporary password is generated and every existing session is signed out.' : confirm === 'deactivate' ? 'The salesman is signed out everywhere and can no longer sign in. Orders, customers and history are kept.' : 'The salesman can sign in again.'}
      onClose={() => setConfirm(null)} onConfirm={async reason => { const r: any = confirm === 'reset' ? await run(() => send('POST', `/api/salesmen/${id}/reset-password`), 'Password reset') : await run(() => send('POST', `/api/salesmen/${id}/status`, {active: confirm === 'activate', reason}), 'Status updated'); setConfirm(null); if (r?.temporaryPassword) setTemp(r.temporaryPassword); if (r) { void d.reload(); onChanged(); } }} />}
    {temp && <Dialog title="New temporary password" onClose={() => setTemp('')} footer={<Button onClick={() => setTemp('')}>Done</Button>}><p>Give this to {s?.name} privately. It is shown only once.</p><b className="inv-mono" style={{fontSize: 18}}>{temp}</b></Dialog>}
    {target && s && <TargetForm salesmen={[{id: s.id, name: s.name}]} onClose={() => setTarget(false)} onSaved={() => { setTarget(false); void d.reload(); onChanged(); }} />}
  </Dialog>;
}

export function Timeline({items}: {items: any[]}) {
  if (!items?.length) return <Empty>No activity recorded yet.</Empty>;
  return <div className="inv-timeline">{items.map((a: any) => <div className="ev" key={a._id}><small>{dateTime(a.at)}</small><div><b>{label(a.type)}</b>{a.salesmanName && <small> · {a.salesmanName}</small>}<small style={{display: 'block'}}>{a.description}{a.customerName ? ` · ${a.customerName}` : ''}{a.orderId ? ` · order ${a.orderId.slice(-10)}` : ''}</small></div><div style={{textAlign: 'right'}}>{a.amountPaise != null && <b>{rupees(a.amountPaise)}</b>}{a.status && <small style={{display: 'block'}}>{label(a.status)}</small>}</div></div>)}</div>;
}

// ============================ Targets ============================
export function TargetForm({salesmen, target, onClose, onSaved}: {salesmen: Array<{id: string; name: string}>; target?: any; onClose: () => void; onSaved: () => void}) {
  const toast = useToast(); const {busy, run} = useAction();
  const money = (t: string) => TARGET_TYPES.find(x => x[0] === t)?.[2];
  const [f, setF] = useState({name: target?.name || '', type: target?.type || 'SALES_AMOUNT', period: target?.period || 'MONTHLY', startDate: target?.startDate || todayIso().slice(0, 8) + '01', endDate: target?.endDate || '', value: target ? String(money(target.type) ? target.targetValue / 100 : target.targetValue) : '', description: target?.description || '', instructions: target?.instructions || '', reason: ''});
  const [ids, setIds] = useState<string[]>(target ? [target.salesmanId] : salesmen.length === 1 ? [salesmen[0].id] : []);
  const save = async () => {
    if (!ids.length) return toast('err', 'Choose at least one salesman');
    if (f.name.trim().length < 2 || !(Number(f.value) > 0)) return toast('err', 'Enter a name and a target value above zero');
    if (target && f.reason.trim().length < 3) return toast('err', 'Give a reason for revising the target');
    const body = {name: f.name, salesmanId: ids[0], salesmanIds: ids, type: f.type, period: f.period, startDate: f.startDate, endDate: f.period === 'CUSTOM' ? f.endDate : undefined, targetValue: Number(f.value), description: f.description, instructions: f.instructions};
    if (await run(() => target ? send('PUT', `/api/targets/${target._id}`, {...body, version: target.version, reason: f.reason}) : send('POST', '/api/targets', body), target ? 'Target revised' : `Target assigned to ${ids.length} salesman(s)`)) onSaved();
  };
  return <Dialog title={target ? `Revise target · ${target.name}` : 'Add target'} onClose={onClose} busy={busy} wide footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy}>{target ? 'Save revision' : 'Assign target'}</Button></>}>
    <div className="inv-form three">
      <Field label="Target name *" wide><Input value={f.name} onChange={e => setF({...f, name: e.target.value})} placeholder="e.g. November sales" /></Field>
      <Field label="Type *"><Select value={f.type} disabled={Boolean(target)} onChange={e => setF({...f, type: e.target.value})} options={TARGET_TYPES.map(([v, l]) => [v, l])} /></Field>
      <Field label="Period *"><Select value={f.period} onChange={e => setF({...f, period: e.target.value})} options={[['DAILY', 'Daily'], ['WEEKLY', 'Weekly (7 days)'], ['MONTHLY', 'Monthly'], ['CUSTOM', 'Custom range']]} /></Field>
      <Field label={`Target value * ${money(f.type) ? '(₹)' : '(count)'}`}><Input type="number" min="1" step={money(f.type) ? 'any' : '1'} value={f.value} onChange={e => setF({...f, value: e.target.value})} /></Field>
      <Field label="Start date *"><Input type="date" value={f.startDate} onChange={e => setF({...f, startDate: e.target.value})} /></Field>
      {f.period === 'CUSTOM' && <Field label="End date *"><Input type="date" min={f.startDate} value={f.endDate} onChange={e => setF({...f, endDate: e.target.value})} /></Field>}
      {!target && <div className="inv-field wide"><span>Salesmen * ({ids.length} selected — the same target is created for each)</span><div className="inv-actions">{salesmen.map(s => <label key={s.id} className="inv-check"><input type="checkbox" checked={ids.includes(s.id)} onChange={e => setIds(e.target.checked ? [...ids, s.id] : ids.filter(x => x !== s.id))} /> {s.name}</label>)}</div></div>}
      <Field label="Description" wide><TextArea value={f.description} onChange={e => setF({...f, description: e.target.value})} /></Field>
      <Field label="Instructions for the salesman" wide><TextArea value={f.instructions} onChange={e => setF({...f, instructions: e.target.value})} /></Field>
      {target && <Field label="Reason for this revision *" wide hint="Targets are never changed silently; the previous values are kept in the history."><Input value={f.reason} onChange={e => setF({...f, reason: e.target.value})} /></Field>}
    </div>
    <div className="inv-note">How achievement is measured: sales amount and order count use orders that are approved (or dispatched, per Settings) in the period, excluding pending, rejected and cancelled orders. Revenue uses invoices created. Collections count only payments verified by the accounts team. New customers count customers created in the period who placed a counted order.</div>
  </Dialog>;
}

export function TargetsPage() {
  const perms = usePerms();
  const [salesmanId, setSalesmanId] = useState(''), [type, setType] = useState(''), [state, setState] = useState(''), [form, setForm] = useState<any | null | 'new'>(null), [hist, setHist] = useState<any | null>(null), [cancel, setCancel] = useState<any | null>(null);
  const list = useLoad(() => get<any>('/api/targets', {salesmanId, type, state}), [salesmanId, type, state]);
  const salesmen = useLoad(async () => (await get<any>('/api/salesmen', {status: 'ACTIVE'})).items.map((s: any) => ({id: s.id, name: s.name})), []);
  const {run} = useAction();
  const can = (p: string) => perms.data?.includes(p);
  const sm = list.data?.summary;
  return <ToastHost><div className="inv"><div className="inv-pg">
    <div className="inv-head"><div><div className="inv-eb">Sales management</div><h1>Targets</h1><p>Assign daily, weekly, monthly or custom targets and follow progress calculated from approved orders and verified payments.</p></div>{can('target.manage') && <Button onClick={() => setForm('new')}>+ Add target</Button>}</div>
    <div style={{height: 18}} />
    {sm && <div className="inv-tiles five"><div className="inv-tile"><span>Targets</span><div className="v">{sm.total}</div></div><div className="inv-tile"><span>Active</span><div className="v">{sm.active}</div></div><div className="inv-tile"><span>Completed</span><div className="v green">{sm.completed}</div></div><div className="inv-tile"><span>Overdue</span><div className="v red">{sm.overdue}</div></div><div className="inv-tile"><span>Upcoming</span><div className="v">{sm.upcoming}</div></div></div>}
    <Card title="All targets">
      <div className="inv-filters"><Select value={salesmanId} onChange={e => setSalesmanId(e.target.value)} placeholder="All salesmen" options={(salesmen.data || []).map((s: any) => [s.id, s.name])} /><Select value={type} onChange={e => setType(e.target.value)} placeholder="All types" options={TARGET_TYPES.map(([v, l]) => [v, l])} /><Select value={state} onChange={e => setState(e.target.value)} placeholder="Any status" options={[['ACTIVE', 'Active'], ['COMPLETED', 'Completed'], ['OVERDUE', 'Overdue'], ['UPCOMING', 'Upcoming'], ['CANCELLED', 'Cancelled']]} /></div>
      <ErrorBox error={list.error} retry={list.reload} />
      {!list.data ? <Loading /> : <Table headers={['Salesman', 'Target', 'Period', 'Progress', 'Status', 'Assigned by', '']} empty="No targets yet.">
        {list.data.items.map((t: any) => <tr key={t._id}><td><strong>{t.salesmanName}</strong></td><td><b>{t.name}</b><small>{tLabel(t.type)}{t.revisions?.length ? ` · revised ${t.revisions.length}×` : ''}</small></td><td>{day(t.startDate)} – {day(t.endDate)}<small>{label(t.period)}</small></td><td style={{minWidth: 220}}><TargetBar t={t} /></td><td><Chip tone={STATE_TONE[t.progress.state]}>{label(t.progress.state)}</Chip></td><td><small>{t.assignedBy?.name} · {day(t.createdAt)}</small></td>
          <td><div className="inv-actions"><Button small variant="ghost" onClick={() => setHist(t)}>History</Button>{can('target.manage') && t.status === 'ACTIVE' && <><Button small variant="ghost" onClick={() => setForm(t)}>Revise</Button><Button small variant="ghost" onClick={() => setCancel(t)}>Cancel</Button></>}</div></td></tr>)}
      </Table>}
    </Card>
    {form && <TargetForm salesmen={salesmen.data || []} target={form === 'new' ? undefined : form} onClose={() => setForm(null)} onSaved={() => { setForm(null); void list.reload(); }} />}
    {hist && <Dialog title={`History · ${hist.name}`} onClose={() => setHist(null)}><div className="inv-timeline"><div className="ev"><small>{dateTime(hist.createdAt)}</small><div><b>Assigned</b><small style={{display: 'block'}}>{targetValue(hist, hist.revisions?.[0]?.before?.targetValue ?? hist.targetValue)} by {hist.assignedBy?.name}</small></div><span /></div>{(hist.revisions || []).map((r: any, i: number) => <div className="ev" key={i}><small>{dateTime(r.at)}</small><div><b>{r.after?.status === 'CANCELLED' ? 'Cancelled' : `Revised to v${r.version}`}</b><small style={{display: 'block'}}>{r.reason} · {r.by?.name}{r.before?.targetValue != null && r.after?.targetValue != null ? ` · ${targetValue(hist, r.before.targetValue)} → ${targetValue(hist, r.after.targetValue)}` : ''}{r.before?.endDate && r.after?.endDate && r.before.endDate !== r.after.endDate ? ` · ends ${day(r.before.endDate)} → ${day(r.after.endDate)}` : ''}</small></div><span /></div>)}</div></Dialog>}
    {cancel && <Confirm title={`Cancel ${cancel.name}`} danger needReason="Reason" confirmLabel="Cancel target" message="The target stays in the history as cancelled." onClose={() => setCancel(null)} onConfirm={async reason => { if (await run(() => send('POST', `/api/targets/${cancel._id}/cancel`, {reason}), 'Target cancelled')) void list.reload(); setCancel(null); }} />}
  </div></div></ToastHost>;
}

// ============================ Performance ============================
export function PerformancePage() {
  const perms = usePerms();
  const [range, setRange] = useState<Range>('month'), [custom, setCustom] = useState({from: shiftDays(todayIso(), -29), to: todayIso()}), [salesmanId, setSalesmanId] = useState(''), [territory, setTerritory] = useState(''), [tab, setTab] = useState('salesmen');
  const b = rangeOf(range, custom);
  const d = useLoad(() => get<any>('/api/sales/performance', {...b, salesmanId, territory}), [b.from, b.to, salesmanId, territory]);
  const p = d.data, t = p?.totals;
  return <ToastHost><div className="inv"><div className="inv-pg">
    <div className="inv-head"><div><div className="inv-eb">Sales management</div><h1>Business performance</h1><p>What every salesman is doing — orders, sales, collections and targets — from real records. Sales count when orders are {p?.policy === 'DISPATCHED' ? 'dispatched' : 'approved'}; collections only once verified.</p></div></div>
    <div className="inv-filters" style={{marginTop: 18}}><RangePicker value={range} onChange={setRange} custom={custom} setCustom={setCustom} /><Select value={salesmanId} onChange={e => setSalesmanId(e.target.value)} placeholder="All salesmen" options={(p?.salesmen || []).map((s: any) => [s.id, s.name])} /><Select value={territory} onChange={e => setTerritory(e.target.value)} placeholder="All territories" options={(p?.territories || []).map((x: string) => [x, x])} /><Button variant="ghost" small onClick={d.reload}>Refresh</Button></div>
    <ErrorBox error={d.error} retry={d.reload} />
    {!p ? <Loading /> : <>
      <div className="inv-tiles">
        <div className="inv-tile"><span>Salesmen</span><div className="v">{t.salesmen}</div><small>{t.active} active · {t.inactive} inactive</small></div>
        <div className="inv-tile"><span>Sales value</span><div className="v">{rupees(t.salesPaise)}</div><small>Revenue invoiced {rupees(t.revenuePaise)}</small></div>
        <div className="inv-tile"><span>Collections (verified)</span><div className="v green">{rupees(t.collectedPaise)}</div><small>{rupees(t.unverifiedCollectionsPaise)} awaiting verification</small></div>
        <div className="inv-tile"><span>Pending collections</span><div className="v amber">{rupees(t.outstandingPaise)}</div><small>dispatched, not yet paid</small></div>
        <div className="inv-tile"><span>Orders placed</span><div className="v">{t.ordersCreated}</div><small>{t.successfulOrders} completed · {t.pendingOrders} pending · {t.cancelledOrders} cancelled</small></div>
        <div className="inv-tile"><span>New customers</span><div className="v">{t.newCustomers}</div></div>
      </div>
      <Segment value={tab} onChange={setTab} options={[['salesmen', 'Salesman-wise'], ['products', 'Product-wise'], ['customers', 'Customer-wise'], ['activity', 'Activity timeline'], ...(perms.data?.includes('payment.verify') ? [['collections', 'Collections to verify'] as [string, string]] : [])]} />
      <div style={{marginTop: 12}}>
        {tab === 'salesmen' && <Card><Table headers={['Salesman', 'Territory', <span className="num">Sales</span>, <span className="num">Orders</span>, <span className="num">Avg order</span>, <span className="num">Collected</span>, <span className="num">Pending</span>, <span className="num">Cancelled</span>, <span className="num">New cust.</span>, 'Target progress']} empty="No salesmen.">{p.salesmen.map((s: any) => <tr key={s.id}><td><strong>{s.name}</strong>{!s.active && <Chip tone="red">Inactive</Chip>}</td><td>{s.territory || '—'}</td><td className="num">{rupees(s.salesPaise)}</td><td className="num">{s.countedOrders}</td><td className="num">{rupees(s.avgOrderValuePaise)}</td><td className="num">{rupees(s.collectedPaise)}</td><td className="num">{rupees(s.outstandingPaise)}</td><td className="num">{s.cancelledOrders}</td><td className="num">{s.newCustomers}</td><td style={{minWidth: 200}}>{s.targets.length ? s.targets.slice(0, 2).map((x: any) => <div key={x.id} style={{marginBottom: 4}}><small>{x.name}</small><TargetBar t={x} /></div>) : <small>No active target</small>}</td></tr>)}</Table></Card>}
        {tab === 'products' && <Card><Table headers={['Product', <span className="num">Units</span>, <span className="num">Value</span>]} empty="No counted sales in this period.">{p.products.map((x: any) => <tr key={x.name}><td>{x.name}</td><td className="num">{x.qty}</td><td className="num">{rupees(x.valuePaise)}</td></tr>)}</Table></Card>}
        {tab === 'customers' && <Card><Table headers={['Customer', <span className="num">Orders</span>, <span className="num">Value</span>]} empty="No counted sales in this period.">{p.customers.map((x: any) => <tr key={x.name}><td>{x.name}</td><td className="num">{x.orders}</td><td className="num">{rupees(x.valuePaise)}</td></tr>)}</Table></Card>}
        {tab === 'activity' && <ActivityFeed range={b} salesmanId={salesmanId} />}
        {tab === 'collections' && <Collections />}
      </div>
    </>}
  </div></div></ToastHost>;
}

function ActivityFeed({range, salesmanId}: {range: {from: string; to: string}; salesmanId: string}) {
  const [type, setType] = useState(''), [page, setPage] = useState(1), [customer, setCustomer] = useState('');
  const d = useLoad(() => get<any>('/api/sales/activities', {...range, salesmanId, type, customer, page, limit: 30}), [range.from, range.to, salesmanId, type, customer, page]);
  return <Card title="Activity timeline" aside={<small>Business events only — no location or device tracking</small>}>
    <div className="inv-filters"><Select value={type} onChange={e => { setType(e.target.value); setPage(1); }} placeholder="All activity" options={['LOGIN', 'CUSTOMER_CREATED', 'CUSTOMERS_ASSIGNED', 'ORDER_SUBMITTED', 'ORDER_APPROVED', 'ORDER_REJECTED', 'ORDER_CANCELLED', 'ORDER_DISPATCHED', 'ORDER_DELIVERED', 'INVOICE_CREATED', 'COLLECTION_SUBMITTED', 'COLLECTION_VERIFIED', 'PAYMENT_RECORDED', 'TARGET_ASSIGNED', 'TARGET_REVISED'].map(x => [x, label(x)])} /><Input placeholder="Customer" value={customer} onChange={e => { setCustomer(e.target.value); setPage(1); }} style={{maxWidth: 200}} /></div>
    <ErrorBox error={d.error} retry={d.reload} />
    {!d.data ? <Loading /> : <><Timeline items={d.data.items} /><Pager page={page} total={d.data.total} limit={30} onPage={setPage} /></>}
  </Card>;
}

function Collections() {
  const [status, setStatus] = useState('UNVERIFIED'), [page, setPage] = useState(1), [decide, setDecide] = useState<{p: any; action: 'verify' | 'reject' | 'void'} | null>(null);
  const d = useLoad(() => get<any>('/api/sales/payments', {status, page, limit: 25}), [status, page]); const {run} = useAction();
  return <Card title="Customer collections">
    <div className="inv-filters"><Segment value={status} onChange={v => { setStatus(v); setPage(1); }} options={[['UNVERIFIED', 'To verify'], ['VERIFIED', 'Verified'], ['REJECTED', 'Rejected'], ['VOID', 'Void']]} /></div>
    <ErrorBox error={d.error} retry={d.reload} />
    {!d.data ? <Loading /> : <><Table headers={['Date', 'Customer', 'Order', 'Method', 'Reference', <span className="num">Amount</span>, 'Status', '']} empty="Nothing here.">{d.data.items.map((p: any) => <tr key={p._id}><td>{day(p.paymentDate)}</td><td>{p.customerName}</td><td className="inv-mono">{p.orderId.slice(-10)}</td><td>{label(p.method)}</td><td>{p.reference || '—'}</td><td className="num">₹{p.amount.toLocaleString('en-IN')}</td><td><Chip tone={p.status === 'VERIFIED' ? 'green' : p.status === 'UNVERIFIED' ? 'amber' : 'red'}>{label(p.status)}</Chip></td><td><div className="inv-actions">{p.status === 'UNVERIFIED' && <><Button small variant="ghost" onClick={() => setDecide({p, action: 'reject'})}>Reject</Button><Button small variant="success" onClick={() => setDecide({p, action: 'verify'})}>Verify</Button></>}{p.status === 'VERIFIED' && <Button small variant="ghost" onClick={() => setDecide({p, action: 'void'})}>Void</Button>}</div></td></tr>)}</Table><Pager page={page} total={d.data.total} limit={25} onPage={setPage} /></>}
    {decide && <Confirm title={`${label(decide.action)} collection`} danger={decide.action !== 'verify'} needReason={decide.action !== 'verify' ? 'Reason' : undefined} confirmLabel={label(decide.action)} message={decide.action === 'verify' ? `Confirms ₹${decide.p.amount} was received. It then reduces the customer's balance and counts towards collection targets.` : decide.action === 'void' ? 'Reverses the payment\'s effect on the customer balance and invoice.' : 'The collection will not count.'} onClose={() => setDecide(null)} onConfirm={async reason => { if (await run(() => send('POST', `/api/sales/payments/${decide.p._id}/${decide.action}`, {reason}), 'Updated')) void d.reload(); setDecide(null); }} />}
  </Card>;
}
