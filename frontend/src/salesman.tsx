import {lazy, Suspense, useEffect, useMemo, useState} from 'react';
import {Check, Home, LogOut, Moon, Package, Plus, Search, ShoppingCart, Sun, Target, TrendingUp, UserPlus, Wallet, X} from 'lucide-react';
import {api} from './api.js';
import {LanguageToggle, useLanguage} from './i18n.js';
import {day, dateTime, fileUrl, get, imgUrl, label, rupees, send} from './inventory/api';
import {Button, Chip, Dialog, Field, Input, Select, ToastHost, useAction, useToast} from './inventory/ui';
import './inventory/inventory.css';
import {productArt} from './products/art';
import type {GoTab} from './insights/types';

const InsightsPage = lazy(() => import('./insights/InsightsPage'));

type Product = {id: string; name: string; sku: string; category: string; unit: string; price: number; available: number; images: string[]; specs: any};
type Customer = {id: string; name: string; phone: string};
type Order = {id: string; customerName: string; total: number; status: string; createdAt: string; updatedAt?: string; reason?: string; items: {name: string; qty: number}[]};
type CartLine = {product: Product; qty: number};
type Tab = 'home' | 'target' | 'performance' | 'catalog' | 'orders' | 'collect';
const TABS: Tab[] = ['home', 'target', 'performance', 'catalog', 'orders', 'collect'];
// Keep older links working (#targets, and #insights from the short-lived single Insights tab).
const REDIRECTS: Record<string, Tab> = {targets: 'target', insights: 'target'};
const hashKey = () => window.location.hash.replace(/^#\/?/, '').toLowerCase();
const tabFromHash = (): Tab => REDIRECTS[hashKey()] || (TABS.includes(hashKey() as Tab) ? hashKey() as Tab : 'home');
const STATUS_TONE: Record<string, any> = {Pending: 'amber', Approved: 'blue', Processing: 'violet', Dispatched: 'violet', Delivered: 'green', Rejected: 'red', Cancelled: 'red'};
const FLOW = ['Pending', 'Approved', 'Dispatched', 'Delivered'];

function ChangePassword({forced, onDone, onClose}: {forced: boolean; onDone: () => void; onClose: () => void}) {
  const toast = useToast(); const {busy, run} = useAction();
  const [f, setF] = useState({current: '', next: '', confirm: ''});
  const save = async () => {
    if (f.next.length < 10) return toast('err', 'Use at least 10 characters');
    if (f.next !== f.confirm) return toast('err', 'The new passwords do not match');
    const r: any = await run(() => send('POST', '/api/auth/change-password', {currentPassword: f.current, newPassword: f.next}), 'Password changed');
    if (r?.token) { localStorage.setItem('token', r.token); onDone(); }
  };
  return <Dialog title={forced ? 'Set your own password' : 'Change password'} onClose={forced ? () => undefined : onClose} busy={busy} footer={<>{!forced && <Button variant="ghost" onClick={onClose}>Cancel</Button>}<Button onClick={save} disabled={busy}>Save password</Button></>}>
    {forced && <p style={{marginBottom: 12, color: 'var(--muted)'}}>You signed in with a temporary password. Choose your own password to continue.</p>}
    <div className="inv-form" style={{gridTemplateColumns: '1fr'}}>
      <Field label={forced ? 'Temporary password' : 'Current password'}><Input type="password" autoComplete="current-password" value={f.current} onChange={e => setF({...f, current: e.target.value})} /></Field>
      <Field label="New password (min 10 characters)"><Input type="password" autoComplete="new-password" value={f.next} onChange={e => setF({...f, next: e.target.value})} /></Field>
      <Field label="Repeat new password"><Input type="password" autoComplete="new-password" value={f.confirm} onChange={e => setF({...f, confirm: e.target.value})} /></Field>
    </div>
  </Dialog>;
}

// Target cards moved to the Target tab (insights/TargetList.tsx); the dashboard keeps a one-line summary.
function Home_({goCatalog, goTarget}: {goCatalog: () => void; goTarget: () => void}) {
  const [d, setD] = useState<any>(null), [err, setErr] = useState('');
  useEffect(() => { get('/api/sales/me/dashboard').then(setD).catch(e => setErr(e.message)); }, []);
  if (err) return <div className="error">{err}</div>;
  if (!d) return <p className="muted">Loading your dashboard…</p>;
  const m = d.thisMonth, s = d.ordersByStatus;
  const current = d.targets.filter((t: any) => t.progress.state !== 'UPCOMING'), upcoming = d.targets.filter((t: any) => t.progress.state === 'UPCOMING');
  return <div style={{display: 'grid', gap: 14}}>
    <section className="card" style={{padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap'}}><div style={{minWidth: 0}}><h3>My targets</h3><p className="muted">{current.length ? current.map((t: any) => `${t.name}: ${t.progress.pct == null ? '—' : `${t.progress.pct}%`}`).join(' · ') : 'No target is assigned to you right now.'}{upcoming.length > 0 ? ` · ${upcoming.length} upcoming` : ''}</p></div><Button small variant="ghost" onClick={goTarget}><Target size={15} /> Open Target</Button></section>
    <section className="inv-tiles" style={{gridTemplateColumns: 'repeat(2,minmax(0,1fr))', margin: 0}}>
      <div className="inv-tile"><span>Sales this month</span><div className="v">{rupees(m.salesPaise)}</div><small>{m.countedOrders} order(s) · today {rupees(d.todayMetrics.salesPaise)}</small></div>
      <div className="inv-tile"><span>Collected (verified)</span><div className="v green">{rupees(m.collectedPaise)}</div>{m.unverifiedCollectionsPaise ? <small>{rupees(m.unverifiedCollectionsPaise)} awaiting verification</small> : <small>this month</small>}</div>
      <div className="inv-tile"><span>Pending customer payments</span><div className="v amber">{rupees(m.outstandingPaise)}</div><small>dispatched orders not yet paid</small></div>
      <div className="inv-tile"><span>My customers</span><div className="v">{m.assignedCustomers}</div><small>{m.newCustomers} new this month</small></div>
    </section>
    <section className="card" style={{padding: 16}}><h3 style={{marginBottom: 8}}>My orders</h3><div className="inv-kv" style={{gridTemplateColumns: 'repeat(3,1fr)'}}>{[['Total', d.totalOrders], ['Pending', s.Pending], ['Approved', s.Approved + s.Processing], ['Dispatched', s.Dispatched], ['Delivered', s.Delivered], ['Rejected / cancelled', s.Rejected + s.Cancelled]].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div><Button small variant="subtle" onClick={goCatalog}>+ Take a new order</Button></section>
    <section className="card" style={{padding: 16}}><h3 style={{marginBottom: 6}}>Recent activity</h3>{d.activities.length ? d.activities.map((a: any) => <div key={a._id} className="inv-row"><div className="grow"><b>{label(a.type)}</b><small>{a.description}{a.customerName ? ` · ${a.customerName}` : ''}</small></div><small>{dateTime(a.at)}</small></div>) : <p className="muted">Nothing yet.</p>}</section>
    <small className="muted">Sales count once an order is {d.policy === 'DISPATCHED' ? 'dispatched' : 'approved'}. Pending, rejected and cancelled orders never count. Collections count after the accounts team verifies them.</small>
  </div>;
}

function ProductSheet({p, onAdd, onClose}: {p: Product; onAdd: () => void; onClose: () => void}) {
  const [i, setI] = useState(0); const s = p.specs || {};
  const rows: Array<[string, any]> = ([['Model', s.model], ['Design', s.design], ['Doors', s.doorCount], ['Drawers', s.drawerCount], ['Size (H×W×D)', s.heightIn ? `${s.heightIn} × ${s.widthIn ?? '—'} × ${s.depthIn ?? '—'} in` : null], ['Material', s.material], ['Colour', s.colour], ['Finish', s.finish], ['Lock', s.lockType], ['Handle', s.handleType]] as Array<[string, any]>).filter(([, v]) => v != null && v !== '');
  return <Dialog title={p.name} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button disabled={!p.available} onClick={() => { onAdd(); onClose(); }}>{p.available ? 'Add to order' : 'Out of stock'}</Button></>}>
    {p.images.length ? <><img src={imgUrl(p.images[i], 900)} alt={p.name} style={{width: '100%', maxHeight: 420, objectFit: 'contain', borderRadius: 12, background: 'var(--raise)'}} />{p.images.length > 1 && <div className="inv-gallery strip" style={{display: 'flex', gap: 6, marginTop: 8}}>{p.images.map((u, j) => <button key={u} type="button" aria-pressed={i === j} onClick={() => setI(j)} style={{padding: 0, border: `2px solid ${i === j ? 'var(--violet)' : 'transparent'}`, borderRadius: 8, background: 'none'}}><img src={imgUrl(u, 120)} alt="" width={54} height={54} style={{objectFit: 'cover', borderRadius: 6, display: 'block'}} /></button>)}</div>}</> : <img src={productArt({name: p.name, category: p.category, profile: p.specs})} alt={`${p.name} (illustration)`} style={{width: '100%', maxHeight: 420, objectFit: 'contain', borderRadius: 12}} />}
    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0'}}><strong style={{fontSize: 22}}>₹{p.price.toLocaleString('en-IN')}</strong>{p.available ? <Chip tone="green">{p.available} available</Chip> : <Chip tone="red">Out of stock</Chip>}</div>
    <small className="inv-mono">{p.sku} · {p.category}</small>
    {s.description && <p className="muted" style={{marginTop: 8}}>{s.description}</p>}
    {s.features?.length > 0 && <div className="inv-actions" style={{margin: '8px 0'}}>{s.features.map((f: string) => <Chip key={f} tone="violet">{f}</Chip>)}</div>}
    {rows.length > 0 && <div className="inv-kv" style={{marginTop: 8}}>{rows.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>}
  </Dialog>;
}

function Collect({orders}: {orders: Order[]}) {
  const toast = useToast(); const {busy, run} = useAction();
  const eligible = orders.filter(o => ['Approved', 'Processing', 'Dispatched', 'Delivered'].includes(o.status));
  const [f, setF] = useState({orderId: '', amount: '', method: 'cash', reference: ''});
  const [list, setList] = useState<any[]>([]);
  const load = () => get<any>('/api/sales/payments', {limit: 30}).then(r => setList(r.items)).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  const save = async () => {
    if (!f.orderId || !(Number(f.amount) > 0)) return toast('err', 'Choose the order and enter the amount received');
    if (await run(() => send('POST', '/api/sales/payments', {orderId: f.orderId, amount: Number(f.amount), method: f.method, reference: f.reference}), 'Collection submitted — accounts will verify it')) { setF({orderId: '', amount: '', method: 'cash', reference: ''}); void load(); }
  };
  return <div style={{display: 'grid', gap: 14}}>
    <section className="card" style={{padding: 16}}><h3 style={{marginBottom: 10}}>Record a collection</h3>
      <div className="inv-form" style={{gridTemplateColumns: '1fr'}}>
        <Field label="Order"><Select value={f.orderId} onChange={e => setF({...f, orderId: e.target.value})} placeholder="Choose an approved order…" options={eligible.map(o => [o.id, `${o.customerName} · ₹${o.total.toLocaleString('en-IN')} · ${o.status}`])} /></Field>
        <Field label="Amount received (₹)"><Input type="number" inputMode="decimal" min="0" step="any" value={f.amount} onChange={e => setF({...f, amount: e.target.value})} /></Field>
        <Field label="Method"><Select value={f.method} onChange={e => setF({...f, method: e.target.value})} options={[['cash', 'Cash'], ['upi', 'UPI'], ['bank_transfer', 'Bank transfer'], ['cheque', 'Cheque'], ['other', 'Other']]} /></Field>
        <Field label="Reference (UTR / cheque no.)"><Input value={f.reference} onChange={e => setF({...f, reference: e.target.value})} /></Field>
      </div>
      <Button className="wide" disabled={busy} onClick={save}><Wallet size={16} /> Submit collection</Button>
      <small className="muted" style={{display: 'block', marginTop: 6}}>It counts towards your collection target once the accounts team verifies it.</small></section>
    <section className="card" style={{padding: 16}}><h3 style={{marginBottom: 6}}>My collections</h3>{list.length ? list.map(p => <div key={p._id} className="inv-row"><div className="grow"><b>₹{p.amount.toLocaleString('en-IN')} · {p.customerName}</b><small>{label(p.method)} · {day(p.paymentDate)}{p.voidReason ? ` · ${p.voidReason}` : ''}</small></div><Chip tone={p.status === 'VERIFIED' ? 'green' : p.status === 'UNVERIFIED' ? 'amber' : 'red'}>{p.status === 'UNVERIFIED' ? 'Awaiting check' : label(p.status)}</Chip></div>) : <p className="muted">No collections recorded yet.</p>}</section>
  </div>;
}

function Inner({user, theme, setTheme, onSignOut}: {user: {name: string; mustChangePassword?: boolean}; theme: string; setTheme: (theme: string) => void; onSignOut: () => void}) {
  const {t} = useLanguage();
  const [tab, setTabState] = useState<Tab>(tabFromHash), [products, setProducts] = useState<Product[]>([]), [categories, setCategories] = useState<string[]>([]), [category, setCategory] = useState(''), [customers, setCustomers] = useState<Customer[]>([]), [orders, setOrders] = useState<Order[]>([]), [cart, setCart] = useState<CartLine[]>([]), [q, setQ] = useState(''), [customerId, setCustomerId] = useState(''), [newName, setNewName] = useState(''), [newPhone, setNewPhone] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [sheet, setSheet] = useState<Product | null>(null), [mustChange, setMustChange] = useState(Boolean(user.mustChangePassword)), [pwd, setPwd] = useState(false);
  // Tabs are mirrored in the URL hash (#target, #performance, #catalog…) so they can be linked.
  const setTab = (next: Tab) => { setTabState(next); try { window.history.replaceState(null, '', next === 'home' ? window.location.pathname + window.location.search : `#${next}`); } catch { /* ignore */ } };
  useEffect(() => { if (REDIRECTS[hashKey()]) setTab(tabFromHash()); const sync = () => setTabState(tabFromHash()); window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync); }, []);
  const loadCatalog = async () => { const r = await get<any>('/api/sales/catalogue', {q, category, limit: 60}); setProducts(r.items); };
  const loadRest = async () => { const [c, o] = await Promise.all([api<Customer[]>('/api/my-customers'), api<Order[]>('/api/orders')]); setCustomers(c); setOrders(o); };
  useEffect(() => { loadCatalog().catch(e => setMessage(e instanceof Error ? e.message : 'Unable to load catalogue')); }, [q, category]);
  useEffect(() => { loadRest().catch(e => setMessage(e instanceof Error ? e.message : 'Unable to load workspace')); get<string[]>('/api/sales/catalogue/categories').then(setCategories).catch(() => undefined); const id = setInterval(() => { if (document.visibilityState === 'visible') void api<Order[]>('/api/orders').then(setOrders).catch(() => undefined); }, 30000); return () => clearInterval(id); }, []);
  const total = useMemo(() => cart.reduce((sum, line) => sum + line.product.price * line.qty, 0), [cart]);
  const add = (product: Product) => setCart(lines => { const ex = lines.find(l => l.product.id === product.id); if (ex && ex.qty >= product.available) { setMessage(`Only ${product.available} of ${product.name} available`); return lines; } return ex ? lines.map(l => l.product.id === product.id ? {...l, qty: l.qty + 1} : l) : [...lines, {product, qty: 1}]; });
  const createCustomer = async () => { if (!newName.trim() || !newPhone.trim()) { setMessage('Enter customer name and phone.'); return; } setBusy(true); try { const c = await api<Customer>('/api/customers', {method: 'POST', body: JSON.stringify({name: newName, phone: newPhone})}); setCustomers(list => [c, ...list]); setCustomerId(c.id); setNewName(''); setNewPhone(''); setMessage('Customer created.'); } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to create customer'); } finally { setBusy(false); } };
  const submit = async () => { if (!cart.length) { setMessage('Add at least one product.'); return; } setBusy(true); try { let target = customerId; if (!target && newName.trim() && newPhone.trim()) { const created = await api<Customer>('/api/customers', {method: 'POST', body: JSON.stringify({name: newName.trim(), phone: newPhone.trim()})}); setCustomers(list => [created, ...list]); setCustomerId(created.id); target = created.id; setNewName(''); setNewPhone(''); } if (!target) { setMessage('Select a customer or enter a new customer name and phone.'); return; } await api('/api/orders', {method: 'POST', headers: {'Idempotency-Key': crypto.randomUUID()}, body: JSON.stringify({customerId: target, items: cart.map(l => ({productId: l.product.id, qty: l.qty}))})}); setCart([]); setMessage('Order submitted for approval.'); setTab('orders'); await loadRest(); await loadCatalog(); } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to submit order'); } finally { setBusy(false); } };
  const NAV: Array<[Tab, string, any]> = [['home', 'Dashboard', Home], ['target', 'Target', Target], ['performance', 'Performance', TrendingUp], ['catalog', 'Catalogue', Package], ['orders', 'My orders', ShoppingCart], ['collect', 'Collections', Wallet]];
  return <div className="sales-shell">
    <header className="sales-header"><div className="logo"><div className="logo-mark">Z</div><span>zen ledger</span></div><div className="sales-actions"><LanguageToggle /><button className="icon-btn" aria-label="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button><button className="sales-user" style={{background: 'none'}} onClick={() => setPwd(true)} title="Change password">{user.name}</button><button className="icon-btn" aria-label="Sign out" onClick={onSignOut}><LogOut size={18} /></button></div></header>
    <main className={tab === 'target' || tab === 'performance' ? 'sales-main wide' : 'sales-main'}>
      <div className="sales-tabs" role="tablist" style={{position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg)', padding: '8px 0', margin: '0 0 14px', overflowX: 'auto'}}>{NAV.map(([k, l, I]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}><I size={16} /> {t(l)}{k === 'orders' && <span>{orders.length}</span>}{k === 'catalog' && cart.length > 0 && <span>{cart.reduce((a, l) => a + l.qty, 0)}</span>}</button>)}</div>
      {message && <div className="sales-message">{message}<button onClick={() => setMessage('')} aria-label="Dismiss"><X size={15} /></button></div>}
      {tab === 'home' && <Home_ goCatalog={() => setTab('catalog')} goTarget={() => setTab('target')} />}
      {(tab === 'target' || tab === 'performance') && <Suspense fallback={<p className="muted" role="status">Loading…</p>}><InsightsPage key={tab} view={tab} go={(next: GoTab) => setTab(next)} /></Suspense>}
      {tab === 'catalog' && <>
        <div className="sales-search"><Search size={17} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search almirah, design code or SKU" /></div>
        {categories.length > 1 && <div className="inv-segment" style={{marginBottom: 12, overflowX: 'auto', flexWrap: 'nowrap', maxWidth: '100%'}}><button type="button" aria-pressed={!category} onClick={() => setCategory('')}>All</button>{categories.map(c => <button key={c} type="button" aria-pressed={category === c} onClick={() => setCategory(c)} style={{whiteSpace: 'nowrap'}}>{c}</button>)}</div>}
        <div className="sales-grid">{products.map(p => <article className="sales-product" key={p.id} style={{padding: 0, overflow: 'hidden'}}>
          <button type="button" onClick={() => setSheet(p)} style={{padding: 0, border: 0, background: 'var(--raise)', aspectRatio: '4/5', display: 'grid', placeItems: 'center', overflow: 'hidden'}} aria-label={`View ${p.name}`}>{p.images[0] ? <img src={imgUrl(p.images[0], 400)} alt={p.name} loading="lazy" style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : <img src={productArt({name: p.name, category: p.category, profile: p.specs})} alt={p.name} loading="lazy" style={{width: '100%', height: '100%', objectFit: 'cover'}} />}</button>
          <div style={{padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 4}}><div className="eyebrow" style={{marginBottom: 0}}>{p.category}</div><h3>{p.name}</h3><p className="muted">{p.sku}</p><div className="sales-product-bottom" style={{marginTop: 4}}><strong>₹{p.price.toLocaleString('en-IN')}</strong><button className="primary small" disabled={!p.available} onClick={() => add(p)}><Plus size={15} /> {t('Add')}</button></div><small className={p.available ? 'muted' : 'danger-text'}>{p.available ? `${p.available} available` : 'Out of stock'}</small></div>
        </article>)}{!products.length && <p className="muted">No products match.</p>}</div>
        <section className="sales-cart card"><div className="sales-section-head"><div><h2>Your order</h2><p className="muted">{cart.length} product line(s) · ₹{total.toLocaleString('en-IN')}</p></div><ShoppingCart size={21} /></div>
          {cart.map(line => <div className="cart-line" key={line.product.id}><span>{line.product.name}<small>{line.qty} × ₹{line.product.price.toLocaleString('en-IN')} (fixed price)</small></span><div><button aria-label="Decrease" onClick={() => setCart(lines => lines.map(x => x.product.id === line.product.id ? {...x, qty: x.qty - 1} : x).filter(x => x.qty > 0))}>−</button><b>{line.qty}</b><button aria-label="Increase" onClick={() => add(line.product)}>+</button></div></div>)}
          <div className="customer-box"><label>Customer<select value={customerId} onChange={e => setCustomerId(e.target.value)}><option value="">Select a customer</option>{customers.map(c => <option value={c.id} key={c.id}>{c.name} · {c.phone}</option>)}</select></label><div className="new-customer"><input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New customer name" /><input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="Phone" inputMode="tel" /><button className="ghost" onClick={createCustomer} disabled={busy}><UserPlus size={16} /> Create</button></div></div>
          <button className="primary wide" onClick={submit} disabled={busy || !cart.length}>{busy ? 'Submitting…' : 'Submit order'}</button></section>
      </>}
      {tab === 'orders' && <section className="sales-orders">{orders.map(order => { const step = FLOW.indexOf(order.status === 'Processing' ? 'Approved' : order.status); return <article className="sales-order card" key={order.id} style={{display: 'block'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', gap: 10}}><div><span className="mono">{order.id.slice(-10)}</span><h3>{order.customerName}</h3><p className="muted">{order.items.map(i => `${i.qty} × ${i.name}`).join(', ')}</p><p className="muted">{new Date(order.createdAt).toLocaleString('en-IN')}</p></div><div className="sales-order-right"><Chip tone={STATUS_TONE[order.status]}>{order.status}</Chip><strong>₹{order.total.toLocaleString('en-IN')}</strong></div></div>
        {step >= 0 ? <div className="inv-steps" style={{marginTop: 10}} aria-label={`Status ${order.status}`}>{FLOW.map((s, i) => <i key={s} title={s} className={i < step ? 'done' : i === step ? (s === 'Delivered' ? 'done' : 'now') : ''} />)}</div> : null}
        {step >= 0 && <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--faint)', marginTop: 3}}>{FLOW.map(s => <span key={s}>{s}</span>)}</div>}
        {order.reason && <small className="danger-text">{order.reason}</small>}
      </article>; })}{!orders.length && <div className="empty">No orders submitted yet.</div>}</section>}
      {tab === 'collect' && <Collect orders={orders} />}
    </main>
    {sheet && <ProductSheet p={sheet} onAdd={() => add(sheet)} onClose={() => setSheet(null)} />}
    {(mustChange || pwd) && <ChangePassword forced={mustChange} onClose={() => setPwd(false)} onDone={() => { setMustChange(false); setPwd(false); try { const u = JSON.parse(localStorage.getItem('salesmanUser') || 'null'); if (u) localStorage.setItem('salesmanUser', JSON.stringify({...u, mustChangePassword: false})); } catch { /* ignore */ } }} />}
  </div>;
}

export function SalesmanApp(props: {user: {name: string; mustChangePassword?: boolean}; theme: string; setTheme: (theme: string) => void; onSignOut: () => void}) {
  return <ToastHost><Inner {...props} /></ToastHost>;
}
void Check;
