import React, {useMemo, useState} from 'react';
import {downloadCsv, get, rupees, send} from '../inventory/api';
import {Button, Card, Chip, Dialog, Empty, ErrorBox, Field, Input, Loading, Pager, Search, Segment, Select, Table, ToastHost, errText, useAction, useLoad, useToast} from '../inventory/ui';
import {Meta, MetaCtx, useCan} from '../inventory/InventoryPage';
import {GalleryEditor, normImages, ProductDetail, ProductForm, ProductImage, VIEWS} from './ProductDetail';
import {ART_TYPES, almirahSvg} from './art';
import '../inventory/inventory.css';

const LIMIT = 24;
const dims = (p: any) => p.profile?.heightIn ? `${p.profile.heightIn}×${p.profile.widthIn ?? '—'}×${p.profile.depthIn ?? '—'} in` : '';
const stockChip = (p: any) => p.available <= 0 ? <Chip tone="red">Out of stock</Chip> : p.stockStatus === 'LOW' ? <Chip tone="amber">Low stock</Chip> : <Chip tone="green">In stock</Chip>;

export function ProductsPage() {
  const meta = useLoad(() => get<Meta>('/api/inventory/meta'), []);
  return <ToastHost><MetaCtx.Provider value={meta.data || {units: [], itemTypes: [], permissions: []}}>
    <div className="inv">{meta.error ? <ErrorBox error={meta.error} retry={meta.reload} /> : !meta.data ? <Loading /> : <Products />}</div>
  </MetaCtx.Provider></ToastHost>;
}

type Dlg = null | 'add' | 'categories' | 'images' | 'import' | 'bulk' | {open: string};
function Products() {
  const can = useCan(); const toast = useToast(); const manage = can('item.manage'), cost = can('inventory.valuation');
  const [q, setQ] = useState(''), [category, setCategory] = useState(''), [stock, setStock] = useState(''), [status, setStatus] = useState('active'), [sort, setSort] = useState('catalogue'), [minPrice, setMin] = useState(''), [maxPrice, setMax] = useState(''), [gap, setGap] = useState<'' | 'images' | 'bom'>('');
  const [page, setPage] = useState(1), [view, setView] = useState<'grid' | 'list'>(() => { try { return (localStorage.getItem('zl.products.view') as any) || 'grid'; } catch { return 'grid'; } });
  const [sel, setSel] = useState<Set<string>>(new Set()), [dlg, setDlg] = useState<Dlg>(null), [exporting, setExporting] = useState(false);
  const query = {q, category, stockStatus: stock, status, sort, minPrice, maxPrice, images: gap === 'images' ? 'missing' : undefined, bom: gap === 'bom' ? 'missing' : undefined, page, limit: LIMIT};
  const list = useLoad(() => get<any>('/api/inventory/products', query), [JSON.stringify(query)]);
  const reset = (fn: () => void) => { fn(); setPage(1); setSel(new Set()); };
  const setV = (v: 'grid' | 'list') => { setView(v); try { localStorage.setItem('zl.products.view', v); } catch { /* not remembered */ } };
  const items: any[] = list.data?.items || [];
  const toggle = (id: string) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const reload = () => { void list.reload(); };
  const doExport = async () => { setExporting(true); try { await downloadCsv('/api/inventory/reports/product-catalogue'); } catch (e) { toast('err', errText(e)); } finally { setExporting(false); } };
  const filtered = Boolean(q || category || stock || status !== 'active' || minPrice || maxPrice || gap);

  return <>
    <header className="inv-head">
      <div><div className="inv-eb">Almirah factory · Catalogue</div><h1>Products</h1><p>Manage your Almari catalogue, product specifications, images, manufacturing costs, pricing and finished stock.</p></div>
      <div className="inv-actions">
        {manage && <Button onClick={() => setDlg('add')}>+ Add New Product</Button>}
        <Button variant="ghost" onClick={() => setDlg('categories')}>Manage Categories</Button>
        {manage && <Button variant="ghost" onClick={() => setDlg('images')}>Manage Product Images</Button>}
        {manage && <Button variant="ghost" onClick={() => setDlg('import')}>Import Products</Button>}
        {can('reports.view') && <Button variant="ghost" disabled={exporting} onClick={doExport}>{exporting ? 'Exporting…' : 'Export Products'}</Button>}
      </div>
    </header>

    <Card title={<h3>Catalogue{list.data ? <small style={{marginLeft: 8, fontWeight: 400}}>{list.data.total} product{list.data.total === 1 ? '' : 's'}</small> : null}</h3>} aside={<Segment value={view} onChange={setV} options={[['grid', 'Grid'], ['list', 'List']]} />}>
      <div className="inv-filters">
        <Search value={q} onChange={v => reset(() => setQ(v))} placeholder="Search name, SKU or category" />
        <Select aria-label="Category" value={category} onChange={e => reset(() => setCategory(e.target.value))} placeholder="All categories" options={(list.data?.categories || []).map((c: string) => [c, c])} />
        <Select aria-label="Stock" value={stock} onChange={e => reset(() => setStock(e.target.value))} placeholder="Any stock" options={[['IN', 'In stock'], ['LOW', 'Low stock'], ['OUT', 'Out of stock']]} />
        <Select aria-label="Status" value={status} onChange={e => reset(() => setStatus(e.target.value))} options={[['active', 'Active'], ['archived', 'Archived'], ['all', 'Active + archived']]} />
        <Input aria-label="Minimum price" type="number" min="0" placeholder="Min ₹" value={minPrice} onChange={e => reset(() => setMin(e.target.value))} style={{width: 100, minWidth: 0}} />
        <Input aria-label="Maximum price" type="number" min="0" placeholder="Max ₹" value={maxPrice} onChange={e => reset(() => setMax(e.target.value))} style={{width: 100, minWidth: 0}} />
        <Select aria-label="Sort" value={sort} onChange={e => reset(() => setSort(e.target.value))} options={[['catalogue', 'Catalogue order'], ['name', 'Name A–Z'], ['price', 'Price low → high'], ['price-desc', 'Price high → low'], ['stock', 'Most stock'], ['newest', 'Newest first']]} />
        <Segment value={gap} onChange={v => reset(() => setGap(v))} options={[['', 'All'], ['images', 'Missing photos'], ['bom', 'Missing BOM']]} />
        {filtered && <Button small variant="subtle" onClick={() => reset(() => { setQ(''); setCategory(''); setStock(''); setStatus('active'); setMin(''); setMax(''); setGap(''); })}>Clear filters</Button>}
      </div>

      {manage && sel.size > 0 && <div className="inv-note" style={{display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap'}}><b>{sel.size} selected</b><Button small onClick={() => setDlg('bulk')}>Bulk update</Button><Button small variant="ghost" onClick={() => setSel(new Set(items.map(p => p.id)))}>Select page</Button><Button small variant="ghost" onClick={() => setSel(new Set())}>Clear</Button></div>}
      <ErrorBox error={list.error} retry={list.reload} />
      {!list.data ? <Loading /> : !items.length ? <Empty action={manage && !filtered && <Button onClick={() => setDlg('add')}>Add your first product</Button>}>{filtered ? 'No products match these filters.' : 'No products yet.'}</Empty> : <>
        {view === 'grid' ? <div className="inv-grid">{items.map(p => <div key={p.id} className="inv-pcard" style={{position: 'relative', cursor: 'default'}}>
          {manage && <input type="checkbox" aria-label={`Select ${p.name}`} checked={sel.has(p.id)} onChange={() => toggle(p.id)} style={{position: 'absolute', top: 8, left: 8, zIndex: 2, width: 18, height: 18}} />}
          <button type="button" onClick={() => setDlg({open: p.id})} style={{all: 'unset', cursor: 'pointer', display: 'flex', flexDirection: 'column'}}>
            <div className="img" style={{position: 'relative'}}><ProductImage p={p} style={{width: '100%', height: '100%'}} />{!p.image && <span className="inv-chip grey" style={{position: 'absolute', right: 6, bottom: 6, fontSize: 10}}>Illustration</span>}{p.status !== 'active' && <span className="inv-chip grey" style={{position: 'absolute', right: 6, top: 6}}>Archived</span>}</div>
            <div className="body"><small className="inv-mono">{p.sku}</small><strong>{p.name}</strong><small>{[p.category, dims(p), p.profile?.colour].filter(Boolean).join(' · ')}</small>
              <div className="inv-actions" style={{justifyContent: 'space-between', marginTop: 4}}><span>{p.price ? rupees(Math.round(p.price * 100)) : <small>No price</small>}</span>{stockChip(p)}</div>
              <small>{p.available} available{p.reservedStock ? ` · ${p.reservedStock} reserved` : ''}{p.variantCount ? ` · ${p.variantCount} variants` : ''}</small>
              {cost && p.manufacturingCostPaise != null && <small>Cost {rupees(p.manufacturingCostPaise)} · margin {p.marginPct}%</small>}
              {!p.bom && <small style={{color: 'var(--iv-am)'}}>Manufacturing setup incomplete</small>}
            </div>
          </button>
        </div>)}</div>
        : <Table headers={[manage ? <input type="checkbox" aria-label="Select all on page" checked={items.every(p => sel.has(p.id))} onChange={e => setSel(e.target.checked ? new Set(items.map(p => p.id)) : new Set())} /> : '', '', 'Product', 'Category', 'Size (H×W×D)', 'Colour / finish', <span className="num">Price</span>, ...(cost ? [<span className="num">Mfg cost</span>, <span className="num">Margin</span>] : []), <span className="num">On hand</span>, <span className="num">Reserved</span>, <span className="num">Available</span>, 'BOM', 'Status', '']}>
          {items.map(p => <tr key={p.id}>
            <td>{manage && <input type="checkbox" aria-label={`Select ${p.name}`} checked={sel.has(p.id)} onChange={() => toggle(p.id)} />}</td>
            <td><ProductImage p={p} size={40} style={{borderRadius: 8, overflow: 'hidden'}} /></td>
            <td><strong>{p.name}</strong><small className="inv-mono">{p.sku}</small></td><td>{p.category}</td><td>{dims(p) || <small>—</small>}</td><td>{[p.profile?.colour, p.profile?.finish].filter(Boolean).join(' · ') || <small>—</small>}</td>
            <td className="num">{p.price ? rupees(Math.round(p.price * 100)) : '—'}</td>
            {cost && <td className="num">{rupees(p.manufacturingCostPaise)}</td>}{cost && <td className="num">{p.marginPct == null ? '—' : `${p.marginPct}%`}</td>}
            <td className="num">{p.stock}</td><td className="num">{p.reservedStock}</td><td className="num">{p.available}</td>
            <td>{p.bom ? <Chip tone="green">v{p.bom.version}</Chip> : <Chip tone="amber">Incomplete</Chip>}</td>
            <td>{p.status === 'active' ? stockChip(p) : <Chip>Archived</Chip>}</td>
            <td><Button small variant="ghost" onClick={() => setDlg({open: p.id})}>View</Button></td>
          </tr>)}
        </Table>}
        <Pager page={page} total={list.data.total} limit={LIMIT} onPage={n => { setPage(n); setSel(new Set()); }} />
      </>}
    </Card>

    {dlg === 'add' && <ProductForm categories={list.data?.categories || []} onClose={() => setDlg(null)} onSaved={id => { reload(); setDlg({open: id}); }} />}
    {dlg && typeof dlg === 'object' && <ProductDetail id={dlg.open} categories={list.data?.categories || []} onClose={() => setDlg(null)} onChanged={reload} />}
    {dlg === 'categories' && <CategoryManager manage={manage} onClose={() => setDlg(null)} onChanged={reload} />}
    {dlg === 'images' && <ImageManager onClose={() => { setDlg(null); reload(); }} />}
    {dlg === 'import' && <ImportDialog onClose={() => setDlg(null)} onDone={() => { setDlg(null); reload(); }} />}
    {dlg === 'bulk' && <BulkDialog ids={[...sel]} categories={list.data?.categories || []} onClose={() => setDlg(null)} onDone={() => { setDlg(null); setSel(new Set()); reload(); }} />}
  </>;
}

// ---------------- categories ----------------
function CategoryManager({manage, onClose, onChanged}: {manage: boolean; onClose: () => void; onChanged: () => void}) {
  const cats = useLoad(() => get<any[]>('/api/inventory/product-categories'), []);
  const {busy, run} = useAction(); const [name, setName] = useState(''), [rename, setRename] = useState<{from: string; to: string} | null>(null);
  const done = () => { void cats.reload(); onChanged(); };
  return <Dialog title="Product categories" onClose={onClose} busy={busy}>
    <ErrorBox error={cats.error} retry={cats.reload} />
    {manage && <div className="inv-actions" style={{marginBottom: 12}}><Input placeholder="New category, e.g. Office Cabinet" value={name} onChange={e => setName(e.target.value)} maxLength={80} style={{flex: 1}} /><Button disabled={busy || name.trim().length < 2} onClick={async () => { if (await run(() => send('POST', '/api/inventory/product-categories', {name: name.trim()}), 'Category added')) { setName(''); done(); } }}>Add</Button></div>}
    {!cats.data ? <Loading /> : <Table headers={['Category', <span className="num">Products</span>, <span className="num">Active</span>, 'Status', '']} empty="No categories yet.">{cats.data.map(c => <tr key={c.name}>
      <td>{rename && rename.from === c.name ? <Input autoFocus value={rename.to} onChange={e => setRename({from: rename.from, to: e.target.value})} maxLength={80} /> : <strong>{c.name}</strong>}</td>
      <td className="num">{c.products}</td><td className="num">{c.activeProducts}</td>
      <td>{c.active ? <Chip tone="green">Active</Chip> : <Chip>Inactive</Chip>}</td>
      <td>{manage && (rename && rename.from === c.name ? <span className="inv-actions"><Button small disabled={busy || rename.to.trim().length < 2} onClick={async () => { if (await run(() => send('POST', '/api/inventory/product-categories/rename', {from: c.name, to: rename.to.trim()}), `Renamed — ${c.products} product(s) moved`)) { setRename(null); done(); } }}>Save</Button><Button small variant="ghost" onClick={() => setRename(null)}>Cancel</Button></span>
        : <span className="inv-actions"><Button small variant="ghost" onClick={() => setRename({from: c.name, to: c.name})}>Rename</Button><Button small variant="ghost" disabled={busy || (c.active && c.activeProducts > 0)} title={c.active && c.activeProducts > 0 ? 'Archive or move its active products first' : undefined} onClick={async () => { if (await run(() => send('POST', '/api/inventory/product-categories/status', {name: c.name, active: !c.active}), 'Category updated')) done(); }}>{c.active ? 'Deactivate' : 'Activate'}</Button></span>)}</td>
    </tr>)}</Table>}
    <small>Renaming moves every product in the category. A category can be deactivated only when none of its products are active.</small>
  </Dialog>;
}

// ---------------- images ----------------
function ImageManager({onClose}: {onClose: () => void}) {
  const [missing, setMissing] = useState(true), [page, setPage] = useState(1), [q, setQ] = useState(''), [edit, setEdit] = useState<any>(null);
  const list = useLoad(() => get<any>('/api/inventory/products', {status: 'all', images: missing ? 'missing' : undefined, q, page, limit: 30}), [missing, q, page]);
  return <Dialog title="Manage product images" onClose={onClose} wide>
    <div className="inv-note">Every product should have real photos: a main display image plus front, side, interior and door-design views. Until a photo is uploaded, the catalogue shows an illustration of the almirah type, tinted with the product's colour:</div>
    <div className="inv-grid" style={{gridTemplateColumns: 'repeat(auto-fill,minmax(92px,1fr))', marginBottom: 14}}>{ART_TYPES.map(([t, l]) => <figure key={t} style={{margin: 0, textAlign: 'center'}}><img src={almirahSvg(t)} alt={l} style={{width: '100%', borderRadius: 10, border: '1px solid var(--iv-line)'}} /><figcaption><small>{l}</small></figcaption></figure>)}</div>
    <div className="inv-filters"><Search value={q} onChange={v => { setQ(v); setPage(1); }} placeholder="Search products" /><Segment value={missing ? 'm' : 'a'} onChange={v => { setMissing(v === 'm'); setPage(1); }} options={[['m', 'Without photos'], ['a', 'All products']]} /></div>
    <ErrorBox error={list.error} retry={list.reload} />
    {!list.data ? <Loading /> : <><Table headers={['', 'Product', 'Photos', 'Views covered', '']} empty={missing ? 'Every product has at least one photo.' : 'No products.'}>{list.data.items.map((p: any) => { const imgs = normImages(p.profile?.images); return <tr key={p.id}><td><ProductImage p={p} size={40} style={{borderRadius: 8, overflow: 'hidden'}} /></td><td><strong>{p.name}</strong><small className="inv-mono">{p.sku}</small></td><td>{imgs.length || <Chip tone="amber">None</Chip>}</td><td><small>{VIEWS.filter(([v]) => imgs.some((i: any) => i.view === v)).map(([, l]) => l).join(', ') || '—'}</small></td><td><Button small onClick={() => setEdit(p)}>{imgs.length ? 'Edit gallery' : 'Upload'}</Button></td></tr>; })}</Table>
      <Pager page={page} total={list.data.total} limit={30} onPage={setPage} /></>}
    {edit && <GalleryDialog product={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void list.reload(); }} />}
  </Dialog>;
}
function GalleryDialog({product, onClose, onSaved}: {product: any; onClose: () => void; onSaved: () => void}) {
  const [images, setImages] = useState<any[]>(normImages(product.profile?.images)); const {busy, run} = useAction();
  return <Dialog title={`Photos · ${product.name}`} onClose={onClose} busy={busy} wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={async () => { if (await run(() => send('PUT', `/api/inventory/products/${product.id}/profile`, {images}), 'Photos saved')) onSaved(); }}>Save photos</Button></>}>
    <p style={{marginTop: 0}}><small>Choose the view for each photo. The main display image is used on cards, in orders and in the salesman catalogue. Removed photos are deleted from storage unless another product still uses them.</small></p>
    <GalleryEditor images={images} onChange={setImages} />
  </Dialog>;
}

// ---------------- bulk ----------------
function BulkDialog({ids, categories, onClose, onDone}: {ids: string[]; categories: string[]; onClose: () => void; onDone: () => void}) {
  const {busy, run} = useAction(); const toast = useToast();
  const [f, setF] = useState({category: '', status: '', reorder: '', warehouseLocation: '', gst: ''});
  const go = async () => {
    const body: any = {ids};
    if (f.category.trim()) body.category = f.category.trim(); if (f.status) body.status = f.status; if (f.reorder !== '') body.reorder = Number(f.reorder);
    if (f.warehouseLocation.trim()) body.warehouseLocation = f.warehouseLocation.trim(); if (f.gst !== '') body.gstRateBps = Math.round(Number(f.gst) * 100);
    if (Object.keys(body).length === 1) return toast('err', 'Choose at least one field to change');
    const r: any = await run(() => send('POST', '/api/inventory/products/bulk', body));
    if (r) { toast('ok', `${r.updated} product(s) updated`); onDone(); }
  };
  return <Dialog title={`Bulk update ${ids.length} product(s)`} onClose={onClose} busy={busy} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={go}>Apply</Button></>}>
    <div className="inv-note">Only the fields you fill are changed. Stock and manufacturing cost can never be bulk-edited.</div>
    <datalist id="bulk-cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
    <div className="inv-form">
      <Field label="Move to category"><Input list="bulk-cats" value={f.category} onChange={e => setF({...f, category: e.target.value})} /></Field>
      <Field label="Status"><Select value={f.status} onChange={e => setF({...f, status: e.target.value})} placeholder="Unchanged" options={[['active', 'Activate'], ['archived', 'Archive']]} /></Field>
      <Field label="Reorder level"><Input type="number" min="0" value={f.reorder} onChange={e => setF({...f, reorder: e.target.value})} /></Field>
      <Field label="GST rate (%)"><Input type="number" min="0" max="28" step="any" value={f.gst} onChange={e => setF({...f, gst: e.target.value})} /></Field>
      <Field label="Warehouse location" wide><Input value={f.warehouseLocation} onChange={e => setF({...f, warehouseLocation: e.target.value})} /></Field>
    </div>
  </Dialog>;
}

// ---------------- import ----------------
const IMPORT_COLS = ['sku', 'name', 'category', 'price', 'reorder', 'doorCount', 'drawerCount', 'heightIn', 'widthIn', 'depthIn', 'thicknessMm', 'colour', 'finish', 'material', 'lockType', 'handleType', 'brand', 'description'];
/** Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') inQ = false; else cell += c; }
    else if (c === '"') inQ = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
function ImportDialog({onClose, onDone}: {onClose: () => void; onDone: () => void}) {
  const toast = useToast(); const {busy, run} = useAction();
  const [rows, setRows] = useState<any[] | null>(null), [report, setReport] = useState<any[] | null>(null), [file, setFile] = useState('');
  const counts = useMemo(() => (report || []).reduce((a: any, r) => ({...a, [r.action]: (a[r.action] || 0) + 1}), {}), [report]);
  const read = async (f?: File) => {
    if (!f) return; setReport(null); setFile(f.name);
    const grid = parseCsv(await f.text());
    if (grid.length < 2) return toast('err', 'The file has no data rows');
    const head = grid[0].map(h => h.trim().replace(/^﻿/, ''));
    const known = head.map(h => IMPORT_COLS.find(c => c.toLowerCase() === h.toLowerCase()) || null);
    if (!known.includes('sku')) return toast('err', 'The first row must contain column headers including "sku"');
    const data = grid.slice(1).map(r => Object.fromEntries(known.map((k, i) => [k, (r[i] || '').trim()]).filter(([k]) => k)));
    setRows(data);
    const r: any = await run(() => send('POST', '/api/inventory/products/import', {rows: data, apply: false}));
    if (r) setReport(r.report);
  };
  const apply = async () => { const r: any = await run(() => send('POST', '/api/inventory/products/import', {rows, apply: true})); if (r) { toast('ok', `Imported: ${r.created} created, ${r.updated} updated`); onDone(); } };
  const template = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([IMPORT_COLS.join(',') + '\n'], {type: 'text/csv'})); a.download = 'product-import-template.csv'; a.click(); URL.revokeObjectURL(a.href); };
  return <Dialog title="Import products" onClose={onClose} busy={busy} wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !report?.length || Boolean(counts.ERROR)} onClick={apply}>{busy ? 'Working…' : report ? `Import ${report.length} row(s)` : 'Import'}</Button></>}>
    <div className="inv-note">Upload a CSV with a header row. Rows with an existing SKU update that product; new SKUs create products (name, category and price required). <b>Stock is never imported</b> — it changes only through opening entries, production, sales and counts. Images are added afterwards.</div>
    <div className="inv-actions" style={{marginBottom: 12}}><label className="inv-btn primary" style={{cursor: 'pointer'}}>Choose CSV file<input type="file" accept=".csv,text/csv" hidden onChange={e => { void read(e.target.files?.[0]); e.target.value = ''; }} /></label><Button variant="ghost" onClick={template}>Download template</Button>{file && <small>{file}</small>}</div>
    <small>Columns: {IMPORT_COLS.join(', ')}</small>
    {report && <>
      <div className="inv-actions" style={{margin: '12px 0'}}><Chip tone="green">{counts.CREATE || 0} new</Chip><Chip tone="blue">{counts.UPDATE || 0} updates</Chip><Chip tone={counts.ERROR ? 'red' : 'grey'}>{counts.ERROR || 0} errors</Chip></div>
      {counts.ERROR ? <div className="inv-error" role="alert"><span>Fix the rows marked as errors in your file and choose it again. Nothing is imported while errors remain.</span></div> : null}
      <Table headers={['Row', 'SKU', 'Action', 'Details']}>{report.map((r: any) => <tr key={r.row}><td>{r.row}</td><td className="inv-mono">{r.sku}</td><td><Chip tone={r.action === 'ERROR' ? 'red' : r.action === 'CREATE' ? 'green' : 'blue'}>{r.action}</Chip></td><td><small>{r.message || [r.data?.name, r.data?.category, r.data?.price != null ? `₹${r.data.price}` : ''].filter(Boolean).join(' · ')}</small></td></tr>)}</Table>
    </>}
  </Dialog>;
}

