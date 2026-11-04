import React, {createContext, useContext, useEffect, useRef, useState} from 'react';
import {ChevronDown, Plus, Settings as SettingsIcon} from 'lucide-react';
import {get, todayIso} from './api';
import {Button, ErrorBox, Loading, ToastHost, useLoad} from './ui';
import {Overview} from './Overview';
import {StockItems, ItemForm} from './Items';
import {Purchases, PurchaseOrderForm, ImportBillDialog} from './Purchases';
import {Production, ProductionForm, WorkInProgress} from './Production';
import {FinishedGoods} from './Finished';
import {Wastage, WastageForm} from './Wastage';
import {StockCount, NewCountDialog} from './Counts';
import {History} from './History';
import {Suppliers} from './Suppliers';
import {Reports} from './Reports';
import {SettingsDialog} from './Settings';
import './inventory.css';
import './workspace.css';

export type Meta = {units: Array<{code: string; label: string; dimension: string}>; itemTypes: string[]; permissions: string[]};
export const MetaCtx = createContext<Meta>({units: [], itemTypes: [], permissions: []});
export const useMeta = () => useContext(MetaCtx);
export const useCan = () => { const m = useMeta(); return (p: string) => m.permissions.includes(p); };

export type Tab = 'overview' | 'raw' | 'accessories' | 'purchases' | 'production' | 'wip' | 'finished' | 'wastage' | 'count' | 'history' | 'suppliers' | 'reports';
export type Nav = (tab: Tab, sub?: string) => void;
type Quick = 'purchase' | 'production' | 'wastage' | 'count' | 'import' | 'item' | 'settings' | null;

// Navigation: six sections, each with at most one row of pages beneath it.
type Page = {tab: Tab; sub?: string; label: string; perm?: string};
type Section = {key: string; label: string; pages: Page[]};
const SECTIONS: Section[] = [
  {key: 'overview', label: 'Overview', pages: [{tab: 'overview', label: 'Overview'}]},
  {key: 'stock', label: 'Stock', pages: [{tab: 'raw', label: 'Materials'}, {tab: 'accessories', label: 'Accessories'}, {tab: 'finished', label: 'Finished goods'}]},
  {key: 'purchasing', label: 'Purchasing', pages: [{tab: 'purchases', sub: 'orders', label: 'Purchase orders'}, {tab: 'purchases', sub: 'receipts', label: 'Goods receipts'}, {tab: 'purchases', sub: 'bills', label: 'Supplier bills'}, {tab: 'purchases', sub: 'payments', label: 'Payments'}, {tab: 'purchases', sub: 'returns', label: 'Returns'}, {tab: 'purchases', sub: 'reorder', label: 'Reorder', perm: 'purchase.create'}, {tab: 'suppliers', label: 'Suppliers'}]},
  {key: 'production', label: 'Production', pages: [{tab: 'production', sub: 'orders', label: 'Production orders', perm: 'production.view'}, {tab: 'wip', label: 'Work in progress', perm: 'production.view'}, {tab: 'production', sub: 'bom', label: 'BOM & costing', perm: 'production.view'}]},
  {key: 'control', label: 'Control', pages: [{tab: 'wastage', label: 'Wastage'}, {tab: 'count', sub: 'counts', label: 'Stock counts'}, {tab: 'count', sub: 'adjustments', label: 'Adjustments'}, {tab: 'history', label: 'History', perm: 'ledger.view'}]},
  {key: 'reports', label: 'Reports', pages: [{tab: 'reports', label: 'Reports', perm: 'reports.view'}]},
];
const DEFAULT_SUB: Partial<Record<Tab, string>> = {purchases: 'orders', production: 'orders', count: 'counts'};
const samePage = (p: Page, tab: Tab, sub?: string) => p.tab === tab && (p.sub === undefined || p.sub === (sub || DEFAULT_SUB[tab]));

const PAGE_KEY = 'zl.inventory.tab';
const savedPage = (): {tab: Tab; sub?: string} | null => {
  try {
    const [tab, sub] = (localStorage.getItem(PAGE_KEY) || '').split('|') as [Tab, string | undefined];
    return SECTIONS.some(s => s.pages.some(p => samePage(p, tab, sub))) ? {tab, sub: sub || undefined} : null;
  } catch { return null; /* storage unavailable: the page simply isn't remembered */ }
};

const NEW_ACTIONS: Array<{k: Exclude<Quick, null | 'settings'>; title: string; text: string; perm: string}> = [
  {k: 'purchase', title: 'Purchase order', text: 'Buy materials from a supplier', perm: 'purchase.create'},
  {k: 'import', title: 'Import a bill', text: 'Upload a supplier invoice', perm: 'bill.manage'},
  {k: 'production', title: 'Production order', text: 'Plan a batch of almirahs', perm: 'production.manage'},
  {k: 'item', title: 'Stock item', text: 'Add a material or accessory', perm: 'item.manage'},
  {k: 'wastage', title: 'Wastage record', text: 'Report damaged or lost stock', perm: 'wastage.report'},
  {k: 'count', title: 'Stock count', text: 'Verify physical stock', perm: 'count.manage'},
];

function NewMenu({actions, onPick}: {actions: typeof NEW_ACTIONS; onPick: (k: Exclude<Quick, null | 'settings'>) => void}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); root.current?.querySelector<HTMLElement>('button')?.focus(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = [...(root.current?.querySelectorAll<HTMLElement>('[role=menuitem]') || [])];
      const i = items.indexOf(document.activeElement as HTMLElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  if (!actions.length) return null;
  return <div className="inv-new" ref={root}>
    <Button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}><Plus size={16} aria-hidden="true" />New<ChevronDown size={15} aria-hidden="true" /></Button>
    {open && <div className="inv-new-menu" role="menu" aria-label="Create new">{actions.map(a => <button key={a.k} type="button" role="menuitem" onClick={() => { setOpen(false); onPick(a.k); }}><b>{a.title}</b><small>{a.text}</small></button>)}</div>}
  </div>;
}

export function InventoryPage({initialTab = 'overview'}: {initialTab?: Tab}) {
  const meta = useLoad(() => get<Meta>('/api/inventory/meta'), []);
  const [where, setWhere] = useState<{tab: Tab; sub?: string}>(() => savedPage() || {tab: initialTab}), [quick, setQuick] = useState<Quick>(null), [version, setVersion] = useState(0);
  useEffect(() => { try { localStorage.setItem(PAGE_KEY, where.sub ? `${where.tab}|${where.sub}` : where.tab); } catch { /* storage unavailable */ } }, [where]);
  const nav: Nav = (tab, sub) => { setWhere({tab, sub}); window.scrollTo({top: 0, behavior: 'smooth'}); };
  const done = () => { setQuick(null); setVersion(v => v + 1); };

  const can = (p: string) => Boolean(meta.data?.permissions.includes(p));
  const sections = SECTIONS.map(s => ({...s, pages: s.pages.filter(p => !p.perm || can(p.perm))})).filter(s => s.pages.length);
  const section = sections.find(s => s.pages.some(p => samePage(p, where.tab, where.sub))) || sections[0];
  const page = section?.pages.find(p => samePage(p, where.tab, where.sub)) || section?.pages[0];

  // Each number on the navigation is something a person has to act on in that section.
  const counts = useLoad(async () => {
    const today = todayIso();
    const [d, a] = await Promise.all([get<any>('/api/inventory/dashboard', {from: today, to: today}), get<any>('/api/inventory/alerts')]);
    const ap = d.metrics.approvals;
    return {stock: d.metrics.lowStock + d.metrics.outOfStock, purchasing: ap.purchaseOrders + (a.overduePurchaseOrders?.length || 0), production: ap.boms + ap.production, control: ap.wastage + ap.adjustments + ap.stockCounts} as Record<string, number>;
  }, [version, section?.key]);

  if (!meta.data || !page) return <div className="inv"><div className="inv-pg" style={{paddingTop: 24}}>{meta.error ? <ErrorBox error={meta.error} retry={meta.reload} /> : <Loading text="Loading inventory…" />}</div></div>;
  const actions = NEW_ACTIONS.filter(a => can(a.perm));

  return <MetaCtx.Provider value={meta.data}><ToastHost><div className="inv inv-ws"><div className="inv-pg">
    <header className="inv-ws-head">
      <h1>Inventory</h1>
      <div className="inv-actions">
        {can('inventory.settings') && <Button variant="ghost" aria-label="Inventory settings" title="Inventory settings" onClick={() => setQuick('settings')}><SettingsIcon size={16} aria-hidden="true" /></Button>}
        <NewMenu actions={actions} onPick={setQuick} />
      </div>
    </header>
    <nav className="inv-ws-nav" aria-label="Inventory sections">{sections.map(s => <button key={s.key} type="button" aria-current={s.key === section.key ? 'true' : undefined} onClick={() => nav(s.pages[0].tab, s.pages[0].sub)}>{s.label}{counts.data?.[s.key] ? <span className="inv-count" aria-label={`${counts.data[s.key]} need attention`}>{counts.data[s.key]}</span> : null}</button>)}</nav>
    {section.pages.length > 1 && <nav className="inv-ws-sub" aria-label={`${section.label} pages`}>{section.pages.map(p => <button key={p.label} type="button" aria-current={p === page ? 'page' : undefined} onClick={() => nav(p.tab, p.sub)}>{p.label}</button>)}</nav>}
    <div key={`${page.tab}-${version}`} className="inv-ws-body">
      {page.tab === 'overview' && <Overview nav={nav} />}
      {page.tab === 'raw' && <StockItems group="materials" title="Materials" />}
      {page.tab === 'accessories' && <StockItems group="accessories" title="Accessories" />}
      {page.tab === 'purchases' && <Purchases sub={page.sub} />}
      {page.tab === 'production' && <Production sub={page.sub} />}
      {page.tab === 'wip' && <WorkInProgress />}
      {page.tab === 'finished' && <FinishedGoods />}
      {page.tab === 'wastage' && <Wastage />}
      {page.tab === 'count' && <StockCount sub={page.sub} />}
      {page.tab === 'history' && <History />}
      {page.tab === 'suppliers' && <Suppliers />}
      {page.tab === 'reports' && <Reports />}
    </div>
    {quick === 'purchase' && <PurchaseOrderForm onClose={() => setQuick(null)} onSaved={() => { done(); nav('purchases', 'orders'); }} />}
    {quick === 'production' && <ProductionForm onClose={() => setQuick(null)} onSaved={() => { done(); nav('production', 'orders'); }} />}
    {quick === 'wastage' && <WastageForm onClose={() => setQuick(null)} onSaved={() => { done(); nav('wastage'); }} />}
    {quick === 'count' && <NewCountDialog onClose={() => setQuick(null)} onSaved={() => { done(); nav('count', 'counts'); }} />}
    {quick === 'import' && <ImportBillDialog onClose={() => setQuick(null)} onSaved={() => { done(); nav('purchases', 'bills'); }} />}
    {quick === 'item' && <ItemForm onClose={() => setQuick(null)} onSaved={() => { done(); nav('raw'); }} />}
    {quick === 'settings' && <SettingsDialog onClose={() => setQuick(null)} onSaved={done} />}
  </div></div></ToastHost></MetaCtx.Provider>;
}
