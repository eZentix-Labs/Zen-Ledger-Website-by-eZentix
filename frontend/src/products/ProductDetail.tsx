import React, {useState} from 'react';
import {StoredFile, dateTime, day, get, imgUrl, label, qty, rupees, send, upload} from '../inventory/api';
import {Button, Card, Chip, Confirm, Dialog, Empty, ErrorBox, Field, Input, Loading, Meter, Segment, Select, Table, TextArea, errText, useAction, useLoad, useToast} from '../inventory/ui';
import {useCan} from '../inventory/InventoryPage';
import {BomDetail, BomForm, ProductionDetail, ProductionForm} from '../inventory/Production';
import {AdjustmentForm} from '../inventory/Counts';
import {productArt} from './art';

export const VIEWS: Array<[string, string]> = [['MAIN', 'Main display'], ['FRONT', 'Front view'], ['SIDE', 'Side view'], ['INTERIOR', 'Interior view'], ['DOOR', 'Door design'], ['DETAIL', 'Detail']];
const viewLabel = (v?: string) => VIEWS.find(x => x[0] === v)?.[1] || 'Image';
/** Photos saved before views existed: the first counts as the main display image, the rest as details. */
export const normImages = (list: any[] = []) => { const hasMain = list.some(i => i.view === 'MAIN'); return list.map((f, i) => f.view ? f : {...f, view: !hasMain && i === 0 ? 'MAIN' : 'DETAIL'}); };

/** Product image with the generated almirah illustration as fallback (never an empty box). */
export function ProductImage({p, url, size, className, style}: {p: any; url?: string | null; size?: number; className?: string; style?: React.CSSProperties}) {
  const src = url === undefined ? p.image : url;
  return <span className={className} style={{position: 'relative', display: 'block', width: size, height: size ? size * 1.25 : undefined, ...style}}>
    <img src={src ? imgUrl(src, size ? Math.max(200, size * 2) : 900) : productArt(p)} alt={p.name} loading="lazy" style={{width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit', display: 'block'}} />
    {!src && size !== undefined && size > 90 && <span className="inv-chip grey" style={{position: 'absolute', left: 6, bottom: 6, fontSize: 10}}>Illustration</span>}
  </span>;
}

// ---------------- gallery editor ----------------
export function GalleryEditor({images, onChange}: {images: StoredFile[]; onChange: (f: StoredFile[]) => void}) {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  const withMain = (list: any[]) => list.some(i => i.view === 'MAIN') || !list.length ? list : list.map((i, k) => k === 0 ? {...i, view: 'MAIN'} : i);
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try { const added: any[] = []; for (const f of [...files].slice(0, 12 - images.length)) added.push({...(await upload(f, 'product')), view: images.length + added.length === 0 ? 'MAIN' : 'DETAIL'}); onChange(withMain([...images, ...added])); }
    catch (e) { toast('err', errText(e)); } finally { setBusy(false); }
  };
  const replace = async (i: number, f?: File) => { if (!f) return; setBusy(true); try { const up = await upload(f, 'product'); onChange(images.map((x: any, k) => k === i ? {...up, view: x.view} : x)); } catch (e) { toast('err', errText(e)); } finally { setBusy(false); } };
  const setView = (i: number, v: string) => onChange(images.map((x: any, k) => k === i ? {...x, view: v} : v === 'MAIN' && x.view === 'MAIN' ? {...x, view: 'DETAIL'} : x));
  return <div className="inv-uploader">
    {images.map((f: any, i) => <figure key={f.url + i} className={f.view === 'MAIN' ? 'primary' : ''} style={{width: 150}}>
      <img src={imgUrl(f.url, 300)} alt={viewLabel(f.view)} style={{width: 150, height: 150}} />
      <figcaption style={{flexDirection: 'column', alignItems: 'stretch'}}>
        <select className="inv-input" style={{padding: '3px 6px', fontSize: 12}} value={f.view || 'DETAIL'} onChange={e => setView(i, e.target.value)} aria-label="Image view">{VIEWS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <span style={{display: 'flex', justifyContent: 'space-between'}}><label style={{color: 'var(--iv-aci)', fontSize: 11, cursor: 'pointer'}}>Replace<input type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={e => { void replace(i, e.target.files?.[0]); e.target.value = ''; }} /></label><button type="button" onClick={() => onChange(withMain(images.filter((_, k) => k !== i)))}>Remove</button></span>
      </figcaption>
    </figure>)}
    {images.length < 12 && <label className={`inv-dropzone${busy ? ' busy' : ''}`} style={{width: 150, height: 210}}><input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { void add(e.target.files); e.target.value = ''; }} /><span>{busy ? 'Uploading…' : '+ Add photos'}</span><small>JPG / PNG / WebP · max 10 MB each · up to 12</small></label>}
  </div>;
}

// ---------------- product form (create / edit) ----------------
const s = (v: any) => v == null ? '' : String(v);
const n = (v: string) => v.trim() === '' ? null : Number(v);
export function ProductForm({product, categories, onClose, onSaved}: {product?: any; categories: string[]; onClose: () => void; onSaved: (id: string) => void}) {
  const toast = useToast(); const {busy, run} = useAction(); const can = useCan();
  const pr = product?.profile || {};
  const [f, setF] = useState({name: s(product?.name), sku: s(product?.sku), category: s(product?.category), status: product?.status || 'active', price: s(product?.price), reorder: s(product?.reorder ?? 0),
    productCode: s(pr.productCode), barcode: s(pr.barcode), brand: s(pr.brand), model: s(pr.model), description: s(pr.description),
    doorCount: s(pr.doorCount), drawerCount: s(pr.drawerCount), internalShelves: s(pr.internalShelves), heightIn: s(pr.heightIn), widthIn: s(pr.widthIn), depthIn: s(pr.depthIn), thicknessMm: s(pr.thicknessMm), material: s(pr.material), weightKg: s(pr.weightKg), colour: s(pr.colour), finish: s(pr.finish), lockType: s(pr.lockType), handleType: s(pr.handleType), doorDesign: s(pr.doorDesign || pr.design), features: (pr.features || []).join(', '),
    wholesale: pr.wholesalePricePaise == null ? '' : String(pr.wholesalePricePaise / 100), retail: pr.retailPricePaise == null ? '' : String(pr.retailPricePaise / 100), gst: pr.gstRateBps == null ? '' : String(pr.gstRateBps / 100), discount: pr.discountBps == null ? '' : String(pr.discountBps / 100), hsnCode: s(pr.hsnCode), warehouseLocation: s(pr.warehouseLocation),
    openingQty: '', openingCost: ''});
  const [images, setImages] = useState<StoredFile[]>(normImages(pr.images));
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({...f, [k]: e.target.value});
  const profile = () => ({productCode: f.productCode, barcode: f.barcode, brand: f.brand, model: f.model, description: f.description, doorCount: n(f.doorCount), drawerCount: n(f.drawerCount), internalShelves: n(f.internalShelves), heightIn: n(f.heightIn), widthIn: n(f.widthIn), depthIn: n(f.depthIn), thicknessMm: n(f.thicknessMm), material: f.material, weightKg: n(f.weightKg), colour: f.colour, finish: f.finish, lockType: f.lockType, handleType: f.handleType, doorDesign: f.doorDesign, features: f.features.split(',').map((x: string) => x.trim()).filter(Boolean), wholesalePriceRupees: n(f.wholesale), retailPriceRupees: n(f.retail), gstRateBps: f.gst === '' ? null : Math.round(Number(f.gst) * 100), discountPct: n(f.discount), hsnCode: f.hsnCode, warehouseLocation: f.warehouseLocation, images});
  const save = async () => {
    if (f.name.trim().length < 2 || f.sku.trim().length < 2 || !f.category.trim() || f.price === '') return toast('err', 'Name, SKU, category and selling price are required');
    if (Number(f.price) < 0) return toast('err', 'Price cannot be negative');
    const master = {name: f.name.trim(), sku: f.sku.trim(), category: f.category.trim(), price: Number(f.price), reorder: Number(f.reorder || 0), status: f.status as 'active' | 'archived'};
    if (product) {
      const a = await run(() => send('PATCH', `/api/inventory/products/${product.id}`, master));
      if (!a) return;
      if (await run(() => send('PUT', `/api/inventory/products/${product.id}/profile`, profile()), 'Product saved')) onSaved(product.id);
    } else {
      const r: any = await run(() => send('POST', '/api/inventory/products', {master, profile: profile(), openingQty: Number(f.openingQty || 0), openingCostRupees: f.openingCost === '' ? null : Number(f.openingCost)}), 'Product added');
      if (r) onSaved(r.id);
    }
  };
  const fld = (k: keyof typeof f, l: string, type = 'text', hint?: string) => <Field label={l} hint={hint}><Input type={type} min={type === 'number' ? '0' : undefined} step="any" value={f[k]} onChange={up(k)} /></Field>;
  const mfg = product?.manufacturingCostPaise;
  return <Dialog title={product ? `Edit ${product.name}` : 'Add new product'} onClose={onClose} busy={busy} wide footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : product ? 'Save product' : 'Add product'}</Button></>}>
    <datalist id="pf-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
    <div className="inv-form four">
      <div className="inv-section-title" style={{borderTop: 0, marginTop: 0}}>Basic information</div>
      <Field label="Product name *" wide><Input value={f.name} onChange={up('name')} placeholder="e.g. Steel Almari Double Door 6.5 ft" maxLength={160} /></Field>
      {fld('sku', 'SKU *')}{fld('productCode', 'Product code')}{fld('barcode', 'Barcode')}
      <Field label="Category *"><Input list="pf-categories" value={f.category} onChange={up('category')} placeholder="Choose or type" /></Field>
      {fld('brand', 'Brand')}{fld('model', 'Model / body')}
      <Field label="Status"><Select value={f.status} onChange={up('status')} options={[['active', 'Active (orderable)'], ['archived', 'Archived (hidden)']]} /></Field>
      <Field label="Description" wide><TextArea value={f.description} onChange={up('description')} maxLength={3000} /></Field>
      <div className="inv-section-title">Physical specifications</div>
      {fld('doorCount', 'Doors', 'number')}{fld('drawerCount', 'Drawers', 'number')}{fld('internalShelves', 'Internal shelves', 'number')}{fld('weightKg', 'Weight (kg)', 'number')}
      {fld('heightIn', 'Height (in)', 'number')}{fld('widthIn', 'Width (in)', 'number')}{fld('depthIn', 'Depth (in)', 'number')}{fld('thicknessMm', 'Sheet thickness (mm)', 'number')}
      {fld('material', 'Material grade')}{fld('colour', 'Colour')}{fld('finish', 'Surface finish')}{fld('doorDesign', 'Door design')}
      {fld('lockType', 'Lock type')}{fld('handleType', 'Handle type')}
      <Field label="Special features (comma separated)" wide hint="e.g. Locker, Churi stand, Light, Mirror"><Input value={f.features} onChange={up('features')} /></Field>
      <div className="inv-section-title">Commercial information</div>
      {fld('price', 'Selling price (₹) *', 'number')}{fld('wholesale', 'Wholesale price (₹)', 'number')}{fld('retail', 'Retail price / MRP (₹)', 'number')}{fld('discount', 'Discount (%)', 'number')}
      {fld('gst', 'GST rate (%)', 'number', 'e.g. 18')}{fld('hsnCode', 'HSN code', 'text', 'Steel furniture is usually 9403')}
      {can('inventory.valuation') && <Field label="Manufacturing cost" hint="Calculated from production — not editable"><div style={{padding: '8px 0'}}>{mfg == null ? <small>Not manufactured yet</small> : rupees(mfg)}</div></Field>}
      <div className="inv-section-title">Inventory</div>
      {fld('reorder', 'Reorder level (units)', 'number')}{fld('warehouseLocation', 'Warehouse location')}
      {!product && fld('openingQty', 'Opening stock (units)', 'number', 'Posts an opening entry to the stock ledger')}
      {!product && fld('openingCost', 'Opening cost per unit (₹)', 'number', 'Leave blank if unknown')}
      {product && <div className="inv-field wide"><small>Stock changes only through production, sales dispatch, returns, counts and approved adjustments — never by editing the product.</small></div>}
      <div className="inv-section-title">Images</div>
      <div className="inv-field wide"><GalleryEditor images={images} onChange={setImages} /></div>
    </div>
  </Dialog>;
}

// ---------------- variant / duplicate ----------------
function CopyForm({product, asVariant, onClose, onSaved}: {product: any; asVariant: boolean; onClose: () => void; onSaved: (id: string) => void}) {
  const toast = useToast(); const {busy, run} = useAction(); const pr = product.profile || {};
  const [f, setF] = useState({sku: `${product.sku}-${asVariant ? 'V' : 'COPY'}`, name: asVariant ? product.name : `${product.name} (copy)`, label: '', price: String(product.price), heightIn: s(pr.heightIn), widthIn: s(pr.widthIn), depthIn: s(pr.depthIn), thicknessMm: s(pr.thicknessMm), doorCount: s(pr.doorCount), colour: s(pr.colour), finish: s(pr.finish)});
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({...f, [k]: e.target.value});
  const save = async () => {
    if (f.sku.trim().length < 2 || f.name.trim().length < 2) return toast('err', 'Enter a SKU and name');
    if (asVariant && !f.label.trim()) return toast('err', 'Describe what is different, e.g. "72 in · Blue"');
    const r: any = await run(() => send('POST', `/api/inventory/products/${product.id}/duplicate`, {sku: f.sku.trim(), name: f.name.trim(), asVariant, variantLabel: f.label || undefined, price: Number(f.price || 0), overrides: {heightIn: n(f.heightIn), widthIn: n(f.widthIn), depthIn: n(f.depthIn), thicknessMm: n(f.thicknessMm), doorCount: n(f.doorCount), colour: f.colour, finish: f.finish}}), asVariant ? 'Variant created — it has its own SKU and stock' : 'Product duplicated');
    if (r) onSaved(r.id);
  };
  const fld = (k: keyof typeof f, l: string, type = 'text') => <Field label={l}><Input type={type} min="0" step="any" value={f[k]} onChange={up(k)} /></Field>;
  return <Dialog title={asVariant ? `Add variant of ${product.name}` : `Duplicate ${product.name}`} onClose={onClose} busy={busy} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{asVariant ? 'Create variant' : 'Duplicate'}</Button></>}>
    <div className="inv-note">{asVariant ? 'A variant is a separate sellable product with its own SKU and its own stock, grouped under this model. Specifications and images are copied; change what differs.' : 'Creates a new product with the same specifications and images. Stock and manufacturing cost are not copied.'}</div>
    <div className="inv-form three">{fld('sku', 'New SKU *')}<Field label="Name *" wide><Input value={f.name} onChange={up('name')} /></Field>{asVariant && <Field label="What is different? *" wide><Input value={f.label} onChange={up('label')} placeholder="e.g. 72 in height · Blue" /></Field>}{fld('price', 'Selling price (₹)', 'number')}{fld('heightIn', 'Height (in)', 'number')}{fld('widthIn', 'Width (in)', 'number')}{fld('depthIn', 'Depth (in)', 'number')}{fld('thicknessMm', 'Thickness (mm)', 'number')}{fld('doorCount', 'Doors', 'number')}{fld('colour', 'Colour')}{fld('finish', 'Finish')}</div>
  </Dialog>;
}

// ---------------- product detail ----------------
type Sec = 'overview' | 'images' | 'specs' | 'pricing' | 'variants' | 'bom' | 'stock' | 'production' | 'sales';
const SECS: Array<[Sec, string]> = [['overview', 'Overview'], ['images', 'Images'], ['specs', 'Specifications'], ['pricing', 'Pricing'], ['variants', 'Variants'], ['bom', 'BOM & Manufacturing'], ['stock', 'Stock'], ['production', 'Production History'], ['sales', 'Sales History']];

export function ProductDetail({id, categories = [], initialSection = 'overview', onClose, onChanged}: {id: string; categories?: string[]; initialSection?: Sec; onClose: () => void; onChanged: () => void}) {
  const can = useCan(); const toast = useToast();
  const [cur, setCur] = useState(id);
  const d = useLoad(() => get<any>(`/api/inventory/products/${cur}`), [cur]);
  const [sec, setSec] = useState<Sec>(initialSection), [img, setImg] = useState(0);
  const [dlg, setDlg] = useState<null | 'adjust' | 'edit' | 'variant' | 'duplicate' | 'delete' | 'archive' | 'bom' | 'bomNew' | 'production' | {bomId: string} | {prodId: string}>(null);
  const {busy, run} = useAction();
  const p = d.data, pr = p?.profile || {}, cost = can('inventory.valuation'), manage = can('item.manage');
  const refresh = () => { void d.reload(); onChanged(); };
  const images: any[] = normImages(pr.images);
  const sorted = [...images].sort((a, b) => VIEWS.findIndex(v => v[0] === (a.view || 'DETAIL')) - VIEWS.findIndex(v => v[0] === (b.view || 'DETAIL')));
  const specs: Array<[string, any]> = p ? ([['Brand', pr.brand], ['Model / body', pr.model], ['Product code', pr.productCode], ['Barcode', pr.barcode], ['Doors', pr.doorCount], ['Drawers', pr.drawerCount], ['Internal shelves', pr.internalShelves], ['Height', pr.heightIn != null ? `${pr.heightIn} in` : null], ['Width', pr.widthIn != null ? `${pr.widthIn} in` : null], ['Depth', pr.depthIn != null ? `${pr.depthIn} in` : null], ['Sheet thickness', pr.thicknessMm != null ? `${pr.thicknessMm} mm` : null], ['Material grade', pr.material], ['Weight', pr.weightKg != null ? `${pr.weightKg} kg` : null], ['Colour', pr.colour], ['Surface finish', pr.finish], ['Lock type', pr.lockType], ['Handle type', pr.handleType], ['Door design', pr.doorDesign || pr.design], ['HSN', pr.hsnCode], ['Warehouse location', pr.warehouseLocation], ...((pr.specs || []).map((x: any) => [x.key, x.value]) as Array<[string, any]>)] as Array<[string, any]>).filter(([, v]) => v != null && v !== '') : [];
  const missingSpecs = p ? (['doorCount', 'heightIn', 'widthIn', 'depthIn', 'colour', 'finish'] as const).filter(k => pr[k] == null || pr[k] === '') : [];
  const net = p ? p.price * (1 - (pr.discountBps || 0) / 10000) : 0;
  const stat = (l: string, v: React.ReactNode, sub?: React.ReactNode, tone = '') => <div className="inv-tile"><span>{l}</span><div className={`v ${tone}`}>{v}</div>{sub && <small>{sub}</small>}</div>;
  return <Dialog title={p ? p.name : 'Product'} onClose={onClose} wide busy={busy} footer={p && (manage || can('adjustment.request')) && <>
    {can('adjustment.request') && <Button variant="ghost" small onClick={() => setDlg('adjust')}>Record adjustment</Button>}
    {manage && <>    <Button variant="ghost" small onClick={() => setDlg('duplicate')}>Duplicate</Button>
    <Button variant="ghost" small onClick={() => setDlg('variant')}>Add variant</Button>
    <Button variant="ghost" small onClick={() => setDlg('archive')}>{p.status === 'active' ? 'Archive' : 'Activate'}</Button>
    <Button variant="danger" small onClick={() => setDlg('delete')}>Delete</Button>
    <Button onClick={() => setDlg('edit')}>Edit product</Button></>}
  </>}>
    <ErrorBox error={d.error} retry={d.reload} />
    {!p ? <Loading /> : <>
      <div className="inv-actions" style={{marginBottom: 8}}><span className="inv-mono">{p.sku}</span><Chip>{p.category}</Chip>{p.status === 'active' ? <Chip tone="green">Active</Chip> : <Chip tone="grey">Archived</Chip>}{pr.variantLabel && <Chip tone="violet">Variant: {pr.variantLabel}</Chip>}{p.manufacturing.configured ? <Chip tone="green">BOM v{p.manufacturing.bom.version}</Chip> : <Chip tone="amber">Manufacturing setup incomplete</Chip>}</div>
      <nav className="inv-tabs" role="tablist" style={{marginTop: 4}}>{SECS.map(([k, l]) => <button key={k} role="tab" type="button" aria-selected={sec === k} onClick={() => setSec(k)}>{l}</button>)}</nav>

      {sec === 'overview' && <div className="inv-gallery">
        <div><div className="main"><ProductImage p={p} url={sorted[0]?.url ?? null} style={{width: '100%', height: '100%'}} /></div>{!images.length && <small>No photo yet — showing an illustration of this almirah type.{manage ? ' Add photos in Images.' : ''}</small>}</div>
        <div>
          <div className="inv-tiles" style={{gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', marginTop: 0}}>
            {stat('Selling price', rupees(Math.round(p.price * 100)), pr.discountBps ? `${pr.discountBps / 100}% discount → ${rupees(Math.round(net * 100))}` : undefined)}
            {stat('Available', p.available, `${p.stock.onHand} on hand ·${p.reservedStock} reserved`, p.available > 0 ? 'green' : 'red')}
            {cost && stat('Manufacturing cost', rupees(p.manufacturingCostPaise), p.marginPct != null ? `margin ${p.marginPct}%` : 'not manufactured yet')}
            {stat('Manufactured', p.stock.totalManufactured ?? p.production.manufactured, `${p.production.inProduction} in production`)}
          </div>
          {pr.description && <p style={{color: 'var(--iv-mu)', margin: '4px 0 10px'}}>{pr.description}</p>}
          {pr.features?.length > 0 && <div className="inv-actions" style={{marginBottom: 10}}>{pr.features.map((x: string) => <Chip key={x} tone="violet">{x}</Chip>)}</div>}
          <div className="inv-kv">{specs.slice(0, 10).map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>
          {(missingSpecs.length > 0 || !p.manufacturing.configured || !images.length) && <div className="inv-note warn" style={{marginTop: 12}}>To complete this product: {[!images.length && 'add photos', missingSpecs.length && `fill ${missingSpecs.join(', ')}`, !p.manufacturing.configured && 'create and approve a BOM'].filter(Boolean).join(' · ')}</div>}
        </div>
      </div>}

      {sec === 'images' && <>
        {images.length ? <div className="inv-gallery"><div><div className="main"><img src={imgUrl(sorted[img]?.url, 900)} alt={viewLabel(sorted[img]?.view)} /></div><small>{viewLabel(sorted[img]?.view)}</small></div>
          <div><div className="inv-grid" style={{gridTemplateColumns: 'repeat(auto-fill,minmax(110px,1fr))'}}>{sorted.map((f: any, i) => <button key={f.url + i} type="button" className="inv-pcard" aria-pressed={i === img} onClick={() => setImg(i)} style={{borderColor: i === img ? 'var(--iv-ac)' : undefined}}><div className="img" style={{aspectRatio: '1'}}><img src={imgUrl(f.url, 240)} alt="" /></div><div className="body"><small>{viewLabel(f.view)}</small></div></button>)}</div>
            <small style={{display: 'block', marginTop: 8}}>Missing views: {VIEWS.filter(([v]) => !images.some((x: any) => x.view === v)).map(([, l]) => l).join(', ') || 'none'}</small>{manage && <Button style={{marginTop: 10}} onClick={() => setDlg('edit')}>Manage gallery</Button>}</div></div>
          : <Empty action={manage && <Button onClick={() => setDlg('edit')}>Upload photos</Button>}>No photos yet. Upload the main display image and front, side, interior and door-design views.</Empty>}
      </>}

      {sec === 'specs' && (specs.length ? <div className="inv-kv">{specs.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div> : <Empty>No specifications recorded yet.</Empty>)}

      {sec === 'pricing' && <div className="inv-tiles" style={{gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))'}}>
        {stat('Selling price', rupees(Math.round(p.price * 100)))}{stat('Wholesale price', rupees(pr.wholesalePricePaise))}{stat('Retail price / MRP', rupees(pr.retailPricePaise))}{stat('Discount', pr.discountBps == null ? '—' : `${pr.discountBps / 100}%`, pr.discountBps ? `net ${rupees(Math.round(net * 100))}` : undefined)}{stat('GST rate', pr.gstRateBps == null ? '—' : `${pr.gstRateBps / 100}%`, pr.gstRateBps != null ? `price incl. GST ${rupees(Math.round(net * 100 * (1 + pr.gstRateBps / 10000)))}` : undefined)}
        {cost && stat('Manufacturing cost', rupees(p.manufacturingCostPaise), 'weighted average of QC-passed output')}{cost && stat('Profit margin', p.marginPct == null ? '—' : `${p.marginPct}%`, 'on selling price, before GST', p.marginPct == null ? '' : p.marginPct < 10 ? 'red' : p.marginPct < 25 ? 'amber' : 'green')}
        {cost && p.manufacturing.bom?.cost && stat('BOM estimate', rupees(p.manufacturing.bom.cost.estimatedPerUnitPaise), p.manufacturing.bom.cost.estimatedPerUnitPaise == null ? 'some materials have no cost' : 'materials + labour + overhead')}
      </div>}

      {sec === 'variants' && <>{p.variants.length ? <Table headers={['', 'Variant', 'SKU', 'Difference', <span className="num">Price</span>, <span className="num">Available</span>, 'Status', '']}>{p.variants.map((v: any) => <tr key={v.id}><td><ProductImage p={v} url={v.image} size={40} style={{borderRadius: 8, overflow: 'hidden'}} /></td><td>{v.name}{v.isRoot && <small>base model</small>}</td><td className="inv-mono">{v.sku}</td><td>{v.variantLabel || '—'}</td><td className="num">{rupees(Math.round(v.price * 100))}</td><td className="num">{v.available}</td><td>{v.status === 'active' ? <Chip tone="green">Active</Chip> : <Chip tone="grey">Archived</Chip>}</td><td><Button small variant="ghost" onClick={() => { setCur(v.id); setSec('overview'); setImg(0); }}>Open</Button></td></tr>)}</Table> : <Empty action={manage && <Button onClick={() => setDlg('variant')}>Add a variant</Button>}>No variants. Add one for a different height, width, depth, colour, thickness, door count or finish — each variant gets its own SKU and stock.</Empty>}</>}

      {sec === 'bom' && <>
        {!p.manufacturing.configured ? <div className="inv-note warn">Manufacturing configuration is incomplete: this product has no approved BOM, so it cannot go into production. {p.manufacturing.bomVersions.length ? `There are ${p.manufacturing.bomVersions.length} draft/inactive version(s) below.` : ''}</div> : null}
        {p.manufacturing.bom && <Card title={<h3>Active BOM · version {p.manufacturing.bom.version}</h3>} aside={<small>approved by {p.manufacturing.bom.approvedBy?.name || '—'} {day(p.manufacturing.bom.approvedAt)}</small>}>
          <Table headers={['Material / accessory', <span className="num">Per almirah</span>, <span className="num">Wastage</span>, ...(cost ? [<span className="num">Unit cost</span>, <span className="num">Cost / almirah</span>] : []), <span className="num">Available</span>, <span className="num">Enough for</span>]}>
            {p.manufacturing.availability.map((a: any) => { const c = p.manufacturing.bom.cost?.lines.find((l: any) => l.itemId === a.itemId); const line = p.manufacturing.bom.lines.find((l: any) => l.itemId === a.itemId); return <tr key={a.itemId}><td>{a.itemName}</td><td className="num">{a.perUnit?.toFixed(3)} {a.unit}</td><td className="num">{(line?.wastageBps || 0) / 100}%</td>{cost && <td className="num">{c?.missingCost ? <Chip tone="amber">No cost</Chip> : rupees(c?.unitCostPaise)}</td>}{cost && <td className="num">{rupees(c?.costPerUnitPaise)}</td>}<td className="num">{a.available}</td><td className="num">{a.canMake == null ? '—' : <Chip tone={a.canMake > 0 ? 'green' : 'red'}>{a.canMake}</Chip>}</td></tr>; })}
          </Table>
          {cost && p.manufacturing.bom.cost && <div className="inv-totals"><span>Material</span><span>{p.manufacturing.bom.cost.materialPerUnitPaise == null ? 'incomplete' : rupees(p.manufacturing.bom.cost.materialPerUnitPaise)}</span><span>Labour</span><span>{rupees(p.manufacturing.bom.cost.labourPerUnitPaise)}</span><span>Overhead</span><span>{rupees(p.manufacturing.bom.cost.overheadPerUnitPaise)}</span><span>Other</span><span>{rupees(p.manufacturing.bom.cost.otherPerUnitPaise)}</span><span className="grand">Total production cost / almirah</span><span className="grand">{rupees(p.manufacturing.bom.cost.estimatedPerUnitPaise)}</span></div>}
          <div className="inv-note" style={{marginBottom: 0}}>Current unreserved stock is enough for <b>{p.manufacturing.maxBuildable ?? '—'}</b> almirah(s).</div>
        </Card>}
        <div className="inv-actions" style={{margin: '4px 0 12px'}}>{can('bom.manage') && (p.manufacturing.bom ? <Button onClick={() => setDlg('bom')}>Create new BOM version</Button> : <Button onClick={() => setDlg('bomNew')}>Create BOM</Button>)}{can('production.manage') && p.manufacturing.configured && <Button variant="ghost" onClick={() => setDlg('production')}>Create production order</Button>}</div>
        <h4 style={{margin: '6px 0'}}>BOM version history</h4>
        {p.manufacturing.bomVersions.length ? p.manufacturing.bomVersions.map((v: any) => <div className="inv-row" key={v._id}><div className="grow">Version {v.version}<small>{v.createdBy?.name} · {day(v.createdAt)}{v.approvedBy ? ` · approved by ${v.approvedBy.name}` : ''}</small></div><Chip tone={v.status === 'ACTIVE' ? 'green' : v.status === 'PENDING_APPROVAL' ? 'amber' : 'grey'}>{label(v.status)}</Chip><Button small variant="ghost" onClick={() => setDlg({bomId: v._id})}>Open</Button></div>) : <small>No BOM versions yet. Material quantities and costs are entered by you — they are not guessed.</small>}
      </>}

      {sec === 'stock' && <>
        <div className="inv-tiles" style={{gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))'}}>
          {stat('Opening stock', p.stock.opening)}{stat('Production receipts', p.stock.productionReceipts)}{stat('Sales dispatched', p.stock.dispatched)}{stat('Sales returns', p.stock.salesReturns)}{stat('Adjustments (net)', p.stock.adjustments)}{stat('Damaged / wasted', p.stock.damaged)}{stat('Reserved for orders', p.stock.reserved)}{stat('Available now', p.stock.available, `${p.stock.onHand} on hand`, p.stock.available > 0 ? 'green' : 'red')}
        </div>
        {p.stock.unrecordedBeforeHistory !== 0 && <div className="inv-note">{p.stock.unrecordedBeforeHistory} unit(s) of the current stock existed before stock movements were recorded in the ledger.</div>}
        <Table headers={['When', 'Movement', 'Reference', <span className="num">Before</span>, <span className="num">In</span>, <span className="num">Out</span>, <span className="num">After</span>, 'By']} empty="No stock movements yet.">{p.stockHistory.map((r: any) => <tr key={r._id}><td><small>{dateTime(r.at)}</small></td><td>{label(r.type)}{!r.qtyInM && !r.qtyOutM && <small>reserved {qty(r.prevReservedM)} → {qty(r.newReservedM)}</small>}</td><td className="inv-mono">{r.refNumber || '—'}</td><td className="num">{qty(r.prevM)}</td><td className="num">{r.qtyInM ? qty(r.qtyInM) : ''}</td><td className="num">{r.qtyOutM ? qty(r.qtyOutM) : ''}</td><td className="num">{qty(r.newM)}</td><td><small>{r.by}</small></td></tr>)}</Table>
        <small>Same stock record as Inventory › Finished Goods, sales orders and the salesman catalogue.</small>
      </>}

      {sec === 'production' && <>
        <div className="inv-tiles" style={{gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))'}}>{stat('Production orders', p.production.orders)}{stat('Total manufactured', p.production.manufactured)}{stat('In production', p.production.inProduction)}{stat('Completed (closed orders)', p.production.completed)}{stat('Rejected at QC', p.production.rejected, undefined, p.production.rejected ? 'amber' : '')}</div>
        <Table headers={['Order', 'Created', 'Status', <span className="num">Planned</span>, <span className="num">Done</span>, 'Progress', ...(cost ? ['Unit cost by batch'] : []), '']} empty="This product has not been manufactured yet.">{p.production.recent.map((o: any) => <tr key={o._id}><td className="inv-mono">{o.number}</td><td>{day(o.createdAt)}</td><td><Chip>{label(o.status)}</Chip></td><td className="num">{o.plannedQty}</td><td className="num">{o.completedQty}{o.rejectedQty ? <small>{o.rejectedQty} rejected</small> : null}</td><td style={{minWidth: 100}}><Meter pct={o.progress.outputPct} /><small>{o.progress.currentStage || ''}</small></td>{cost && <td><small>{(o.unitCosts || []).map((b: any) => `#${b.batchNo}: ${rupees(b.unitCostPaise)}`).join(' · ') || '—'}</small></td>}<td>{can('production.view') && <Button small variant="ghost" onClick={() => setDlg({prodId: o._id})}>Open</Button>}</td></tr>)}</Table>
      </>}

      {sec === 'sales' && <>
        <div className="inv-tiles" style={{gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))'}}>{stat('Orders containing it', p.sales.orders)}{stat('Approved+ orders', p.sales.countedOrders)}{stat('Units sold', p.sales.unitsSold)}{stat('Sales value', rupees(p.sales.valuePaise))}</div>
        <Table headers={['Order', 'Date', 'Customer', 'Salesman', 'Status', <span className="num">Qty</span>, <span className="num">Value</span>]} empty="No orders for this product yet.">{p.sales.recent.map((o: any) => <tr key={o.id}><td className="inv-mono">{o.id.slice(-10)}</td><td>{day(o.createdAt)}</td><td>{o.customerName}</td><td>{o.salesman}</td><td><Chip>{o.status}</Chip></td><td className="num">{o.qty}</td><td className="num">{rupees(o.valuePaise)}</td></tr>)}</Table>
        <small>Sales count once an order is approved; pending, rejected and cancelled orders are listed but not counted.</small>
      </>}
    </>}

    {dlg === 'adjust' && p && <AdjustmentForm item={{kind: 'PRODUCT', id: p.id, name: p.name, unit: 'pcs', availableM: p.available * 1000}} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); refresh(); }} />}
    {dlg === 'edit' && p && <ProductForm product={p} categories={categories} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); refresh(); }} />}
    {(dlg === 'variant' || dlg === 'duplicate') && p && <CopyForm product={p} asVariant={dlg === 'variant'} onClose={() => setDlg(null)} onSaved={nid => { setDlg(null); onChanged(); setCur(nid); setSec('overview'); }} />}
    {dlg === 'archive' && p && <Confirm title={p.status === 'active' ? 'Archive product' : 'Activate product'} message={p.status === 'active' ? 'Archived products disappear from the salesman catalogue and cannot be added to new orders. Existing orders, stock and history are kept.' : 'The product becomes orderable again.'} onClose={() => setDlg(null)} onConfirm={async () => { if (await run(() => send('PATCH', `/api/inventory/products/${p.id}`, {status: p.status === 'active' ? 'archived' : 'active'}), 'Status updated')) refresh(); setDlg(null); }} />}
    {dlg === 'delete' && p && <Confirm title="Delete product" danger confirmLabel="Delete permanently" message="Only products with no orders, stock movements, BOMs or production can be deleted. Anything with history must be archived instead." onClose={() => setDlg(null)} onConfirm={async () => { try { await send('DELETE', `/api/inventory/products/${p.id}`); toast('ok', 'Product deleted'); onChanged(); onClose(); } catch (e) { toast('err', errText(e)); setDlg(null); } }} />}
    {dlg === 'bomNew' && p && <BomForm bom={{productId: p.id, outputQty: 1, lines: [], labourPerUnitPaise: 0, overheadPerUnitPaise: 0, otherCosts: [], copy: true}} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); refresh(); }} />}
    {dlg === 'bom' && p && <BomForm bom={{...p.manufacturing.bom, _id: undefined, copy: true}} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); refresh(); }} />}
    {dlg === 'production' && p && <ProductionForm productId={p.id} onClose={() => setDlg(null)} onSaved={() => { setDlg(null); refresh(); }} />}
    {dlg && typeof dlg === 'object' && 'bomId' in dlg && <BomDetail id={dlg.bomId} onClose={() => setDlg(null)} onChanged={refresh} onEdit={(b, copy) => setDlg(copy ? 'bom' : null)} />}
    {dlg && typeof dlg === 'object' && 'prodId' in dlg && <ProductionDetail id={dlg.prodId} onClose={() => setDlg(null)} onChanged={refresh} />}
  </Dialog>;
}
