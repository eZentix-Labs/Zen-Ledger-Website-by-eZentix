import React, {useMemo, useState} from 'react';
import {StoredFile, dateTime, day, get, label, qty, rupees, send} from './api';
import {Button, Card, Chip, Confirm, Dialog, ErrorBox, Field, ImageUploader, Input, Loading, Pager, Search, Select, Table, TextArea, Thumb, useAction, useLoad, useToast} from './ui';
import {useCan, useMeta} from './InventoryPage';
import {AdjustmentForm} from './Counts';

export const TYPE_LABEL: Record<string, string> = {RAW_MATERIAL: 'Raw material', COMPONENT: 'Accessory / component', CONSUMABLE: 'Consumable', PACKAGING: 'Packaging', SPARE_PART: 'Spare part', SEMI_FINISHED: 'Semi-finished', OTHER: 'Other'};
export const statusChip = (s: string) => s === 'OUT' ? <Chip tone="red">Out of stock</Chip> : s === 'LOW' ? <Chip tone="amber">Low stock</Chip> : <Chip tone="green">In stock</Chip>;
export const useCategories = (itemType?: string) => useLoad(() => get<any[]>('/api/inventory/categories', {itemType}), [itemType]);
export const useSupplierOptions = () => useLoad(async () => (await get<any>('/api/inventory/suppliers', {limit: 200})).items as any[], []);
export const useItemOptions = (group?: string) => useLoad(async () => (await get<any>('/api/inventory/items', {limit: 200, group})).items as any[], [group]);

function specText(i: any) {
  const parts = [i.grade, i.thicknessMm != null && `${i.thicknessMm} mm`, i.lengthMm != null && i.widthMm != null ? `${i.lengthMm}×${i.widthMm} mm` : i.lengthMm != null && `${i.lengthMm} mm long`, i.diameterMm != null && `Ø${i.diameterMm} mm`, i.weightKg != null && `${i.weightKg} kg/${i.stockUnit}`].filter(Boolean);
  return parts.join(' · ');
}

export function StockItems({group, title}: {group: 'materials' | 'accessories'; title: string}) {
  const can = useCan();
  const [q, setQ] = useState(''), [page, setPage] = useState(1), [f, setF] = useState({categoryId: '', itemType: '', stockStatus: '', supplierId: '', status: 'ACTIVE', location: ''});
  const cats = useCategories(), sups = useSupplierOptions();
  const list = useLoad(() => get<any>('/api/inventory/items', {group, q, page, limit: 25, ...f}), [group, q, page, JSON.stringify(f)]);
  const [edit, setEdit] = useState<any | null | 'new'>(null), [view, setView] = useState<string | null>(null), [cats2, setCats2] = useState(false), [more, setMore] = useState(false);
  const extraFilters = [f.itemType, f.supplierId, f.status !== 'ACTIVE' && f.status].filter(Boolean).length;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLSelectElement>) => { setF({...f, [k]: e.target.value}); setPage(1); };
  const typeOpts = (group === 'accessories' ? ['COMPONENT'] : ['RAW_MATERIAL', 'CONSUMABLE', 'PACKAGING', 'SPARE_PART', 'SEMI_FINISHED', 'OTHER']).map(t => [t, TYPE_LABEL[t]] as [string, string]);
  const catOpts = (cats.data || []).filter(c => group === 'accessories' ? c.itemType === 'COMPONENT' : c.itemType !== 'COMPONENT').map(c => [c._id, c.name] as [string, string]);
  const catName = (id: string) => cats.data?.find(c => c._id === id)?.name || '';
  const supName = (id: string) => sups.data?.find((s: any) => s._id === id)?.name || '';
  const showValue = list.data?.items?.[0]?.valuePaise !== undefined;   // hidden from roles without valuation access
  return <Card title={title} aside={<>{can('item.manage') && <Button variant="ghost" small onClick={() => setCats2(true)}>Categories</Button>}{can('item.manage') && <Button onClick={() => setEdit('new')}>+ Add {group === 'accessories' ? 'accessory' : 'material'}</Button>}</>}>
    <div className="inv-filters">
      <Search value={q} onChange={v => { setQ(v); setPage(1); }} placeholder="Search name, code, SKU or barcode" />
      <Select value={f.categoryId} onChange={set('categoryId')} options={catOpts} placeholder="All categories" />
      <Select value={f.stockStatus} onChange={set('stockStatus')} options={[['LOW', 'Low stock'], ['OUT', 'Out of stock'], ['OK', 'In stock']]} placeholder="Any stock status" />
      <Button variant="ghost" aria-expanded={more} onClick={() => setMore(v => !v)}>{more ? 'Fewer filters' : 'More filters'}{extraFilters ? ` (${extraFilters})` : ''}</Button>
      {more && <div className="inv-filters-more">
        {group === 'materials' && <Select value={f.itemType} onChange={set('itemType')} options={typeOpts} placeholder="All types" />}
        <Select value={f.supplierId} onChange={set('supplierId')} options={(sups.data || []).map((s: any) => [s._id, s.name])} placeholder="Any supplier" />
        <Select value={f.status} onChange={set('status')} options={[['ACTIVE', 'Active'], ['INACTIVE', 'Inactive'], ['all', 'Active + inactive']]} />
      </div>}
    </div>
    <ErrorBox error={list.error} retry={list.reload} />
    {!list.data ? <Loading /> : <>
      <Table headers={['Item', 'Category', <span className="num">Available</span>, ...(showValue ? [<span className="num">Value</span>] : []), 'Supplier', 'Status', '']} empty={<>No {group === 'accessories' ? 'accessories' : 'materials'} yet.{can('item.manage') && <> <Button variant="subtle" onClick={() => setEdit('new')}>Add the first one</Button></>}</>}>
        {list.data.items.map((i: any) => <tr key={i._id} className="inv-click" onClick={() => setView(i._id)}>
          <td><div className="inv-name">{i.images?.[0]?.url && <Thumb url={i.images[0].url} alt={i.name} size={34} />}<div><strong>{i.name}</strong><small><span className="inv-mono">{i.code}</span>{specText(i) ? ` · ${specText(i)}` : ''}</small></div></div></td>
          <td>{catName(i.categoryId) || <small>—</small>}{group === 'materials' && <small>{TYPE_LABEL[i.itemType]}</small>}</td>
          <td className="num"><strong>{qty(i.availableM)}</strong> {i.stockUnit}<small>{[i.reorderLevelM != null && `reorder at ${qty(i.reorderLevelM)}`, i.reservedM ? `${qty(i.reservedM)} reserved` : ''].filter(Boolean).join(' · ') || 'no reorder level'}</small></td>
          {showValue && <td className="num">{i.avgCostPaise == null ? <Chip tone="amber">No cost</Chip> : <>{rupees(i.valuePaise)}<small>{rupees(i.avgCostPaise)} each</small></>}</td>}
          <td className="inv-clip" title={supName(i.preferredSupplierId)}>{supName(i.preferredSupplierId) || <small>—</small>}{i.location && <small>{i.location}</small>}</td>
          <td>{i.status === 'INACTIVE' ? <Chip>Inactive</Chip> : statusChip(i.stockStatus)}</td>
          <td><Button small variant="ghost" onClick={() => setView(i._id)}>View</Button></td>
        </tr>)}
      </Table>
      <Pager page={page} total={list.data.total} limit={25} onPage={setPage} />
    </>}
    {edit && <ItemForm item={edit === 'new' ? undefined : edit} defaultType={group === 'accessories' ? 'COMPONENT' : 'RAW_MATERIAL'} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void list.reload(); }} />}
    {cats2 && <CategoryManager onClose={() => { setCats2(false); void cats.reload(); }} />}
    {view && <ItemDetail id={view} onClose={() => setView(null)} onChanged={() => void list.reload()} onEdit={it => { setView(null); setEdit(it); }} />}
  </Card>;
}

function CategoryManager({onClose}: {onClose: () => void}) {
  const meta = useMeta(); const toast = useToast(); const {busy, run} = useAction();
  const list = useLoad(() => get<any[]>('/api/inventory/categories', {active: 'all'}), []);
  const [name, setName] = useState(''), [type, setType] = useState('RAW_MATERIAL'), [editing, setEditing] = useState<{id: string; name: string} | null>(null);
  const add = async () => { if (name.trim().length < 2) return toast('err', 'Enter a category name'); if (await run(() => send('POST', '/api/inventory/categories', {name: name.trim(), itemType: type}), 'Category added')) { setName(''); void list.reload(); } };
  const patch = async (id: string, body: any, ok: string) => { if (await run(() => send('PATCH', `/api/inventory/categories/${id}`, body), ok)) { setEditing(null); void list.reload(); } };
  return <Dialog title="Stock categories" onClose={onClose} busy={busy} footer={<Button onClick={onClose}>Done</Button>}>
    <div className="inv-actions" style={{marginBottom: 10}}><Input placeholder="New category, e.g. CR Sheets" value={name} onChange={e => setName(e.target.value)} style={{flex: 1, minWidth: 180}} /><select className="inv-input" style={{width: 190}} value={type} onChange={e => setType(e.target.value)}>{meta.itemTypes.map(t => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}</select><Button onClick={add} disabled={busy}>Add</Button></div>
    {!list.data ? <Loading /> : !list.data.length ? <div className="inv-note">No categories yet. <LoadSuggested onDone={list.reload} /></div> :
      <Table headers={['Category', 'Type', 'Status', '']}>{list.data.map(c => <tr key={c._id}><td>{editing && editing.id === c._id ? <Input value={editing.name} onChange={e => setEditing({id: c._id, name: e.target.value})} /> : c.name}</td><td><small>{TYPE_LABEL[c.itemType] || c.itemType}</small></td><td>{c.active ? <Chip tone="green">Active</Chip> : <Chip tone="grey">Inactive</Chip>}</td><td><div className="inv-actions">{editing && editing.id === c._id ? <Button small onClick={() => patch(c._id, {name: editing.name.trim()}, 'Renamed')}>Save</Button> : <Button small variant="ghost" onClick={() => setEditing({id: c._id, name: c.name})}>Rename</Button>}<Button small variant="ghost" onClick={() => patch(c._id, {active: !c.active}, c.active ? 'Deactivated' : 'Activated')}>{c.active ? 'Deactivate' : 'Activate'}</Button></div></td></tr>)}</Table>}
    <small style={{display: 'block', marginTop: 8}}>Units come from a fixed, validated list (pieces, kg, sheets, metres, litres, boxes…). Purchase-unit conversions and specifications are set on each item, because the same unit can weigh differently per material.</small>
  </Dialog>;
}

function LoadSuggested({onDone}: {onDone: () => void}) {
  const {busy, run} = useAction();
  return <Button variant="ghost" disabled={busy} title="Creates the suggested categories from your catalogue (steel sheets, locks, hinges, powder coating…). You can rename or deactivate any of them." onClick={async () => { const r = await run(() => send<any>('POST', '/api/inventory/categories/load-suggested'), 'Suggested categories added'); if (r) onDone(); }}>Load suggested categories</Button>;
}

const n = (v: string) => v.trim() === '' ? null : Number(v);
export function ItemForm({item, defaultType = 'RAW_MATERIAL', onClose, onSaved}: {item?: any; defaultType?: string; onClose: () => void; onSaved: () => void}) {
  const meta = useMeta(); const toast = useToast();
  const cats = useCategories(), sups = useSupplierOptions();
  const m = (v: number | null | undefined) => v == null ? '' : String(v / 1000);
  const [f, setF] = useState({
    name: item?.name || '', code: item?.code || '', sku: item?.sku || '', barcode: item?.barcode || '', itemType: item?.itemType || defaultType, categoryId: item?.categoryId || '', description: item?.description || '',
    grade: item?.grade || '', thicknessMm: item?.thicknessMm ?? '', lengthMm: item?.lengthMm ?? '', widthMm: item?.widthMm ?? '', diameterMm: item?.diameterMm ?? '', weightKg: item?.weightKg ?? '',
    stockUnit: item?.stockUnit || 'pcs', minStock: m(item?.minStockM), maxStock: m(item?.maxStockM), reorderLevel: m(item?.reorderLevelM), reorderQty: m(item?.reorderQtyM), leadTimeDays: item?.leadTimeDays ?? '',
    preferredSupplierId: item?.preferredSupplierId || '', location: item?.location || '', openingQty: '', openingCost: '',
  });
  const [units, setUnits] = useState<Array<{unit: string; factor: string}>>((item?.purchaseUnits || []).map((p: any) => ({unit: p.unit, factor: String(p.factor)})));
  const [specs, setSpecs] = useState<Array<{key: string; value: string}>>(item?.specs || []);
  const [images, setImages] = useState<StoredFile[]>(item?.images || []);
  const {busy, run} = useAction();
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({...f, [k]: e.target.value});
  const unitOpts = meta.units.map(u => [u.code, `${u.label} (${u.code})`] as [string, string]);
  const stockDim = meta.units.find(u => u.code === f.stockUnit)?.dimension;
  const save = async () => {
    if (f.name.trim().length < 2 || !f.code.trim()) return toast('err', 'Name and item code are required');
    const body: any = {...f, categoryId: f.categoryId || null, preferredSupplierId: f.preferredSupplierId || null,
      thicknessMm: n(String(f.thicknessMm)), lengthMm: n(String(f.lengthMm)), widthMm: n(String(f.widthMm)), diameterMm: n(String(f.diameterMm)), weightKg: n(String(f.weightKg)),
      minStock: n(f.minStock), maxStock: n(f.maxStock), reorderLevel: n(f.reorderLevel), reorderQty: n(f.reorderQty), leadTimeDays: n(String(f.leadTimeDays)),
      purchaseUnits: units.filter(u => u.unit && u.factor).map(u => ({unit: u.unit, factor: Number(u.factor)})), specs: specs.filter(s => s.key.trim()), images};
    delete body.openingQty; delete body.openingCost;
    const r = item ? await run(() => send('PATCH', `/api/inventory/items/${item._id}`, {...body, revision: item.revision}), 'Item updated')
      : await run(() => send('POST', '/api/inventory/items', {...body, openingQty: Number(f.openingQty || 0), openingCostRupees: f.openingCost === '' ? null : Number(f.openingCost)}), 'Stock item added');
    if (r) onSaved();
  };
  return <Dialog title={item ? `Edit ${item.name}` : 'Add stock item'} onClose={onClose} busy={busy} wide footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : item ? 'Save changes' : 'Add item'}</Button></>}>
    <div className="inv-form four">
      <Field label="Item name *" wide><Input value={f.name} onChange={up('name')} maxLength={160} placeholder="e.g. E.D.D Steel Sheet 22 gauge" /></Field>
      <Field label="Item code *" hint="Unique; letters and numbers"><Input value={f.code} onChange={up('code')} maxLength={40} placeholder="RM-SHEET-22" /></Field>
      <Field label="SKU"><Input value={f.sku} onChange={up('sku')} maxLength={60} /></Field>
      <Field label="Barcode"><Input value={f.barcode} onChange={up('barcode')} maxLength={60} /></Field>
      <Field label="Item type *"><Select value={f.itemType} onChange={up('itemType')} options={meta.itemTypes.map(t => [t, TYPE_LABEL[t] || t])} /></Field>
      <Field label="Category"><Select value={f.categoryId} onChange={up('categoryId')} placeholder="— None —" options={(cats.data || []).filter(c => c.itemType === f.itemType).map(c => [c._id, c.name])} /></Field>
      <Field label="Storage location"><Input value={f.location} onChange={up('location')} maxLength={80} placeholder="e.g. Raw material store, Rack A" /></Field>
      <div className="inv-section-title">Specification</div>
      <Field label="Grade / material"><Input value={f.grade} onChange={up('grade')} placeholder="e.g. CRCA E.D.D" /></Field>
      <Field label="Thickness (mm)"><Input type="number" min="0" step="any" value={f.thicknessMm} onChange={up('thicknessMm')} /></Field>
      <Field label="Length (mm)"><Input type="number" min="0" step="any" value={f.lengthMm} onChange={up('lengthMm')} /></Field>
      <Field label="Width (mm)"><Input type="number" min="0" step="any" value={f.widthMm} onChange={up('widthMm')} /></Field>
      <Field label="Diameter (mm)"><Input type="number" min="0" step="any" value={f.diameterMm} onChange={up('diameterMm')} /></Field>
      <Field label={`Weight (kg per ${f.stockUnit})`}><Input type="number" min="0" step="any" value={f.weightKg} onChange={up('weightKg')} /></Field>
      <Field label="Description" wide><TextArea value={f.description} onChange={up('description')} maxLength={2000} /></Field>
      <div className="inv-field wide"><span>Other specifications</span>{specs.map((s, i) => <div key={i} className="inv-actions" style={{marginBottom: 6}}><Input placeholder="e.g. Finish" value={s.key} onChange={e => setSpecs(specs.map((x, j) => j === i ? {...x, key: e.target.value} : x))} style={{maxWidth: 220}} /><Input placeholder="Value" value={s.value} onChange={e => setSpecs(specs.map((x, j) => j === i ? {...x, value: e.target.value} : x))} /><Button small variant="ghost" onClick={() => setSpecs(specs.filter((_, j) => j !== i))}>Remove</Button></div>)}<Button small variant="subtle" onClick={() => setSpecs([...specs, {key: '', value: ''}])}>+ Add specification</Button></div>
      <div className="inv-section-title">Units</div>
      <Field label="Stock unit *" hint={item ? 'Locked once stock has moved' : 'All stock, BOM and history use this unit'}><Select value={f.stockUnit} onChange={up('stockUnit')} options={unitOpts} /></Field>
      <div className="inv-field wide" style={{gridColumn: 'span 3'}}><span>Purchase units (only where the conversion is verified)</span>
        {units.map((u, i) => <div key={i} className="inv-actions" style={{marginBottom: 6}}><span>1</span><select className="inv-input" style={{maxWidth: 170}} value={u.unit} onChange={e => setUnits(units.map((x, j) => j === i ? {...x, unit: e.target.value} : x))}><option value="">unit…</option>{unitOpts.filter(([c]) => c !== f.stockUnit).map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select><span>=</span><Input type="number" min="0" step="any" style={{maxWidth: 120}} value={u.factor} onChange={e => setUnits(units.map((x, j) => j === i ? {...x, factor: e.target.value} : x))} /><span>{f.stockUnit}</span><Button small variant="ghost" onClick={() => setUnits(units.filter((_, j) => j !== i))}>Remove</Button></div>)}
        <Button small variant="subtle" onClick={() => setUnits([...units, {unit: '', factor: ''}])}>+ Add purchase unit</Button>
        <small>Example: stock in sheets, buy by weight → 1 kg = 0.0467 sheet (from your actual sheet weight). Same-dimension units (kg↔g, m↔ft) convert automatically; pieces are never converted to kilograms unless you define it here.</small></div>
      <div className="inv-section-title">Stock levels & supplier</div>
      {!item && <Field label={`Opening quantity (${f.stockUnit})`} hint="Creates an opening-stock ledger entry"><Input type="number" min="0" step={stockDim === 'COUNT' ? 1 : 'any'} value={f.openingQty} onChange={up('openingQty')} /></Field>}
      {!item && <Field label={`Opening cost (₹ per ${f.stockUnit})`} hint="Leave blank if unknown"><Input type="number" min="0" step="any" value={f.openingCost} onChange={up('openingCost')} /></Field>}
      <Field label="Minimum stock"><Input type="number" min="0" step="any" value={f.minStock} onChange={up('minStock')} /></Field>
      <Field label="Reorder level"><Input type="number" min="0" step="any" value={f.reorderLevel} onChange={up('reorderLevel')} /></Field>
      <Field label="Maximum stock"><Input type="number" min="0" step="any" value={f.maxStock} onChange={up('maxStock')} /></Field>
      <Field label="Reorder quantity"><Input type="number" min="0" step="any" value={f.reorderQty} onChange={up('reorderQty')} /></Field>
      <Field label="Lead time (days)"><Input type="number" min="0" step="1" value={f.leadTimeDays} onChange={up('leadTimeDays')} /></Field>
      <Field label="Preferred supplier"><Select value={f.preferredSupplierId} onChange={up('preferredSupplierId')} placeholder="— None —" options={(sups.data || []).map((s: any) => [s._id, s.name])} /></Field>
      <div className="inv-section-title">Images</div>
      <div className="inv-field wide"><ImageUploader files={images} onChange={setImages} purpose="material" /></div>
    </div>
  </Dialog>;
}

export function ItemDetail({id, onClose, onChanged, onEdit}: {id: string; onClose: () => void; onChanged: () => void; onEdit: (item: any) => void}) {
  const can = useCan();
  const d = useLoad(() => get<any>(`/api/inventory/items/${id}`), [id]);
  const hist = useLoad(() => can('ledger.view') ? get<any>('/api/inventory/ledger', {itemId: id, limit: 25}) : Promise.resolve({items: []}), [id]);
  const [adjust, setAdjust] = useState(false), [confirm, setConfirm] = useState<'deactivate' | 'activate' | 'delete' | null>(null);
  const {run} = useAction();
  const i = d.data;
  const refresh = () => { void d.reload(); void hist.reload(); onChanged(); };
  return <Dialog title={i ? i.name : 'Stock item'} onClose={onClose} wide footer={i && <>
    {can('adjustment.request') && i.status === 'ACTIVE' && <Button variant="ghost" onClick={() => setAdjust(true)}>Record adjustment</Button>}
    {can('item.manage') && <Button variant="ghost" onClick={() => setConfirm(i.status === 'ACTIVE' ? 'deactivate' : 'activate')}>{i.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}</Button>}
    {can('item.manage') && !hist.data?.items?.length && <Button variant="danger" onClick={() => setConfirm('delete')}>Delete</Button>}
    {can('item.manage') && <Button onClick={() => onEdit(i)}>Edit item</Button>}
  </>}>
    <ErrorBox error={d.error} retry={d.reload} />
    {!i ? <Loading /> : <>
      <div className="inv-gallery" style={{gridTemplateColumns: i.images?.length ? '220px 1fr' : '1fr'}}>
        {i.images?.length > 0 && <div><div className="main" style={{aspectRatio: '1'}}><Thumb url={i.images[0].url} alt={i.name} size={220} /></div></div>}
        <div>
          <div className="inv-actions" style={{marginBottom: 10}}><span className="inv-mono">{i.code}</span><Chip tone="violet">{TYPE_LABEL[i.itemType]}</Chip>{i.status === 'INACTIVE' ? <Chip>Inactive</Chip> : statusChip(i.stockStatus)}{i.category && <Chip>{i.category.name}</Chip>}</div>
          <div className="inv-tiles" style={{gridTemplateColumns: 'repeat(4,minmax(0,1fr))'}}>
            <div className="inv-tile"><span>On hand</span><div className="v">{qty(i.onHandM)}</div><small>{i.stockUnit}</small></div>
            <div className="inv-tile"><span>Reserved</span><div className="v">{qty(i.reservedM)}</div><small>for production</small></div>
            <div className="inv-tile"><span>Available</span><div className={`v ${i.stockStatus === 'OUT' ? 'red' : i.stockStatus === 'LOW' ? 'amber' : 'green'}`}>{qty(i.availableM)}</div><small>{i.stockUnit}</small></div>
            {i.valuePaise !== undefined && <div className="inv-tile"><span>Stock value</span><div className="v">{rupees(i.valuePaise)}</div><small>avg {rupees(i.avgCostPaise)} / {i.stockUnit}</small></div>}
          </div>
          <div className="inv-kv">
            {[['Specification', specText(i) || '—'], ['Location', i.location || '—'], ['Preferred supplier', i.supplier?.name || '—'], ['Reorder level', i.reorderLevelM == null ? 'Not set' : qty(i.reorderLevelM, i.stockUnit)], ['Min / max', `${qty(i.minStockM)} / ${qty(i.maxStockM)}`], ['Lead time', i.leadTimeDays == null ? '—' : `${i.leadTimeDays} days`], ['Purchase units', i.purchaseUnits?.length ? i.purchaseUnits.map((p: any) => `1 ${p.unit} = ${p.factor} ${i.stockUnit}`).join(', ') : 'Stock unit only'], ['Last purchase rate', i.lastPurchaseRatePaise === undefined ? '—' : rupees(i.lastPurchaseRatePaise)]].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
            {(i.specs || []).map((s: any) => <div key={s.key}><span>{s.key}</span><b>{s.value}</b></div>)}
          </div>
          {i.description && <p style={{marginTop: 12, color: 'var(--muted)'}}>{i.description}</p>}
        </div>
      </div>
      <div className="inv-cols even" style={{marginTop: 16}}>
        <Card title="Purchase history">{i.purchaseHistory.length ? <Table headers={['Date', 'GRN', 'Supplier', <span className="num">Accepted</span>, <span className="num">Unit cost</span>]}>{i.purchaseHistory.map((p: any) => <tr key={p._id}><td>{day(p.date)}</td><td className="inv-mono">{p.number}</td><td>{p.supplierName}</td><td className="num">{qty(p.line?.acceptedM, i.stockUnit)}</td><td className="num">{rupees(p.line?.unitCostPaise)}</td></tr>)}</Table> : <small>No purchases received yet.</small>}</Card>
        <Card title="Consumption in production">{i.consumptionHistory.length ? <Table headers={['Date', 'Production order', 'Type', <span className="num">Qty</span>]}>{i.consumptionHistory.map((c: any) => <tr key={c._id}><td>{day(c.createdAt)}</td><td className="inv-mono">{c.refNumber}</td><td>{label(c.type)}</td><td className="num">{c.qtyOutM ? `−${qty(c.qtyOutM)}` : `+${qty(c.qtyInM)}`}</td></tr>)}</Table> : <small>Not issued to production yet.</small>}</Card>
      </div>
      {can('ledger.view') && <Card title="Stock history">{!hist.data ? <Loading /> : <Table headers={['When', 'Type', 'Reference', <span className="num">Before</span>, <span className="num">In</span>, <span className="num">Out</span>, <span className="num">After</span>, 'By']} empty="No movements yet.">{hist.data.items.map((r: any) => <tr key={r._id}><td><small>{dateTime(r.createdAt)}</small></td><td>{label(r.type)}</td><td className="inv-mono">{r.refNumber || '—'}</td><td className="num">{qty(r.prevM)}</td><td className="num">{r.qtyInM ? qty(r.qtyInM) : ''}</td><td className="num">{r.qtyOutM ? qty(r.qtyOutM) : ''}</td><td className="num">{qty(r.newM)}</td><td><small>{r.performedBy?.name}</small></td></tr>)}</Table>}</Card>}
    </>}
    {adjust && i && <AdjustmentForm item={{kind: 'ITEM', id: i._id, name: i.name, unit: i.stockUnit, availableM: i.availableM}} onClose={() => setAdjust(false)} onSaved={() => { setAdjust(false); refresh(); }} />}
    {confirm && i && <Confirm title={confirm === 'delete' ? 'Delete item' : confirm === 'deactivate' ? 'Deactivate item' : 'Reactivate item'} danger={confirm !== 'activate'} confirmLabel={confirm === 'delete' ? 'Delete' : confirm === 'deactivate' ? 'Deactivate' : 'Reactivate'}
      message={confirm === 'delete' ? 'This item has no stock history and will be permanently deleted.' : confirm === 'deactivate' ? 'Inactive items disappear from purchase and BOM pickers but keep all their history.' : 'The item becomes available again for purchases and BOMs.'}
      onClose={() => setConfirm(null)} onConfirm={async () => { const r = confirm === 'delete' ? await run(() => send('DELETE', `/api/inventory/items/${i._id}`), 'Item deleted') : await run(() => send('POST', `/api/inventory/items/${i._id}/status`, {status: confirm === 'deactivate' ? 'INACTIVE' : 'ACTIVE'}), 'Status updated'); setConfirm(null); if (r) { if (confirm === 'delete') { onChanged(); onClose(); } else refresh(); } }} />}
  </Dialog>;
}

/** Searchable item picker used by purchase, BOM, wastage and count forms. */
export function ItemPicker({items, value, onChange, placeholder = 'Choose item…'}: {items: any[]; value: string; onChange: (id: string) => void; placeholder?: string}) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => items.filter(i => !q || `${i.name} ${i.code} ${i.sku || ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 80), [items, q]);
  const cur = items.find(i => i._id === value || i.id === value);
  return <div style={{display: 'grid', gap: 4}}>
    {items.length > 12 && <Input placeholder="Type to filter…" value={q} onChange={e => setQ(e.target.value)} />}
    <select className="inv-input" value={value} onChange={e => onChange(e.target.value)}><option value="">{placeholder}</option>{cur && !shown.includes(cur) && <option value={cur._id || cur.id}>{cur.name}</option>}{shown.map(i => <option key={i._id || i.id} value={i._id || i.id}>{i.name} ({i.code || i.sku}){i.availableM !== undefined ? ` · ${qty(i.availableM)} ${i.stockUnit}` : ''}</option>)}</select>
  </div>;
}
