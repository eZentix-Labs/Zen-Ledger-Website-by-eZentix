import React, {createContext, useContext, useEffect, useState} from 'react';
import {get} from './api';
import {Button, ErrorBox, Loading, ToastHost, useLoad} from './ui';
import {Overview} from './Overview';
import {StockItems, ItemForm} from './Items';
import {Purchases, PurchaseOrderForm, ImportBillDialog} from './Purchases';
import {Production, WorkInProgress} from './Production';
import {FinishedGoods} from './Finished';
import {Wastage, WastageForm} from './Wastage';
import {StockCount, NewCountDialog} from './Counts';
import {History} from './History';
import {Suppliers} from './Suppliers';
import {Reports} from './Reports';
import {SettingsDialog} from './Settings';
import './inventory.css';

export type Meta = {units: Array<{code: string; label: string; dimension: string}>; itemTypes: string[]; permissions: string[]};
export const MetaCtx = createContext<Meta>({units: [], itemTypes: [], permissions: []});
export const useMeta = () => useContext(MetaCtx);
export const useCan = () => { const m = useMeta(); return (p: string) => m.permissions.includes(p); };

export type Tab = 'overview' | 'raw' | 'accessories' | 'purchases' | 'production' | 'wip' | 'finished' | 'wastage' | 'count' | 'history' | 'suppliers' | 'reports';
const TABS: Array<[Tab, string, string?]> = [['overview', 'Overview'], ['raw', 'Raw Materials'], ['accessories', 'Accessories'], ['purchases', 'Purchases'], ['suppliers', 'Suppliers'], ['production', 'Production', 'production.view'], ['wip', 'Work in Progress', 'production.view'], ['finished', 'Finished Goods'], ['wastage', 'Wastage'], ['count', 'Stock Count'], ['history', 'History', 'ledger.view'], ['reports', 'Reports', 'reports.view']];
const TAB_KEY = 'zl.inventory.tab';
const savedTab = (): Tab | null => { try { const t = localStorage.getItem(TAB_KEY) as Tab | null; return t && TABS.some(x => x[0] === t) ? t : null; } catch { return null; } };
export type Nav = (tab: Tab, sub?: string) => void;
type Quick = 'purchase' | 'wastage' | 'count' | 'import' | 'item' | 'settings' | null;

const QUICK: Array<{k: Exclude<Quick, null | 'settings'>; title: string; text: string; perm: string}> = [
  {k: 'purchase', title: 'Record Purchase', text: 'Purchase raw materials from suppliers.', perm: 'purchase.create'},
  {k: 'wastage', title: 'Log Wastage', text: 'Record damaged or wasted materials.', perm: 'wastage.report'},
  {k: 'count', title: 'Count Stock', text: 'Verify physical stock.', perm: 'count.manage'},
  {k: 'import', title: 'Import a Bill', text: 'Upload and review supplier invoices.', perm: 'bill.manage'},
  {k: 'item', title: 'Add Stock Item', text: 'Add new raw materials or components.', perm: 'item.manage'},
];

export function InventoryPage({initialTab = 'overview'}: {initialTab?: Tab}) {
  const meta = useLoad(() => get<Meta>('/api/inventory/meta'), []);
  const [tab, setTab] = useState<Tab>(() => savedTab() || initialTab), [sub, setSub] = useState<string | undefined>(), [quick, setQuick] = useState<Quick>(null), [version, setVersion] = useState(0);
  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab); } catch { /* storage unavailable: tab simply isn't remembered */ } }, [tab]);
  const nav: Nav = (t, s) => { setTab(t); setSub(s); window.scrollTo({top: 0, behavior: 'smooth'}); };
  const done = () => { setQuick(null); setVersion(v => v + 1); };
  if (!meta.data) return <div className="inv"><div className="inv-pg" style={{paddingTop: 24}}>{meta.error ? <ErrorBox error={meta.error} retry={meta.reload} /> : <Loading text="Loading inventory…" />}</div></div>;
  const can = (p: string) => meta.data!.permissions.includes(p);
  const tabs = TABS.filter(([, , perm]) => !perm || can(perm));
  const active: Tab = tabs.some(t => t[0] === tab) ? tab : 'overview';
  return <MetaCtx.Provider value={meta.data}><ToastHost><div className="inv"><div className="inv-pg">
    <header className="inv-head">
      <div><div className="inv-eb">Almirah factory · Inventory</div><h1>Inventory</h1><p>Manage raw materials, purchases, suppliers, manufacturing, wastage and stock history. Every stock movement is recorded.</p></div>
      <div className="inv-actions">{can('inventory.settings') && <Button variant="ghost" small onClick={() => setQuick('settings')}>Settings</Button>}</div>
    </header>
    <div className="inv-addbar">{QUICK.map(q => <button key={q.k} type="button" className="inv-add" disabled={!can(q.perm)} title={can(q.perm) ? undefined : 'You do not have permission for this action'} onClick={() => setQuick(q.k)}><b>{q.title}</b><small>{q.text}</small></button>)}</div>
    <nav className="inv-tabs" role="tablist" aria-label="Inventory sections">{tabs.map(([k, l]) => <button key={k} role="tab" type="button" aria-selected={active === k} onClick={() => nav(k)}>{l}</button>)}</nav>
    <div role="tabpanel" key={`${active}-${version}`}>
      {active === 'overview' && <Overview nav={nav} />}
      {active === 'raw' && <StockItems group="materials" title="Raw materials, consumables & packaging" />}
      {active === 'accessories' && <StockItems group="accessories" title="Accessories & components" />}
      {active === 'purchases' && <Purchases initialSub={sub} />}
      {active === 'production' && <Production initialSub={sub} />}
      {active === 'wip' && <WorkInProgress />}
      {active === 'finished' && <FinishedGoods />}
      {active === 'wastage' && <Wastage />}
      {active === 'count' && <StockCount initialSub={sub} />}
      {active === 'history' && <History />}
      {active === 'suppliers' && <Suppliers />}
      {active === 'reports' && <Reports />}
    </div>
    {quick === 'purchase' && <PurchaseOrderForm onClose={() => setQuick(null)} onSaved={() => { done(); nav('purchases'); }} />}
    {quick === 'wastage' && <WastageForm onClose={() => setQuick(null)} onSaved={() => { done(); nav('wastage'); }} />}
    {quick === 'count' && <NewCountDialog onClose={() => setQuick(null)} onSaved={() => { done(); nav('count'); }} />}
    {quick === 'import' && <ImportBillDialog onClose={() => setQuick(null)} onSaved={() => { done(); nav('purchases', 'bills'); }} />}
    {quick === 'item' && <ItemForm onClose={() => setQuick(null)} onSaved={() => { done(); nav('raw'); }} />}
    {quick === 'settings' && <SettingsDialog onClose={() => setQuick(null)} onSaved={done} />}
  </div></div></ToastHost></MetaCtx.Provider>;
}
