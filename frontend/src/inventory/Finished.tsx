import {useState} from 'react';
import {get, rupees} from './api';
import {Button, Card, Chip, ErrorBox, Loading, Pager, Search, Segment, Select, Table, useLoad} from './ui';
import {ProductDetail, ProductImage} from '../products/ProductDetail';

const dims = (p: any) => p.profile?.heightIn ? `${p.profile.heightIn}×${p.profile.widthIn ?? '—'}×${p.profile.depthIn ?? '—'} in` : '';
const stockChip = (p: any) => p.available <= 0 ? <Chip tone="red">Out of stock</Chip> : p.stockStatus === 'LOW' ? <Chip tone="amber">Low</Chip> : <Chip tone="green">Available</Chip>;

export function FinishedGoods() {
  const [q, setQ] = useState(''), [category, setCategory] = useState(''), [stock, setStock] = useState(''), [page, setPage] = useState(1), [view, setView] = useState<'grid' | 'list'>('grid'), [open, setOpen] = useState<string | null>(null);
  const list = useLoad(() => get<any>('/api/inventory/products', {q, category, stockStatus: stock, page, limit: 24}), [q, category, stock, page]);
  return <Card title="Finished almirahs" aside={<Segment value={view} onChange={setView} options={[['grid', 'Grid'], ['list', 'List']]} />}>
    <div className="inv-filters">
      <Search value={q} onChange={v => { setQ(v); setPage(1); }} placeholder="Search name, SKU or category" />
      <Select value={category} onChange={e => { setCategory(e.target.value); setPage(1); }} placeholder="All categories" options={(list.data?.categories || []).map((c: string) => [c, c])} />
      <Select value={stock} onChange={e => { setStock(e.target.value); setPage(1); }} placeholder="Any stock" options={[['IN', 'In stock'], ['OUT', 'Out of stock']]} />
    </div>
    <div className="inv-note">Finished goods are your existing Products. Stock rises only from QC-accepted production output and falls once on dispatch. Product details, images, specifications and pricing are managed on the Products page — this is the same record.</div>
    <ErrorBox error={list.error} retry={list.reload} />
    {!list.data ? <Loading /> : <>
      {view === 'grid' ? <div className="inv-grid">{list.data.items.map((p: any) => <button key={p.id} type="button" className="inv-pcard" onClick={() => setOpen(p.id)}>
        <div className="img"><ProductImage p={p} style={{width: '100%', height: '100%'}} /></div>
        <div className="body"><small className="inv-mono">{p.sku}</small><strong>{p.name}</strong><small>{[p.category, dims(p), p.profile?.colour].filter(Boolean).join(' · ')}</small><div className="inv-actions" style={{justifyContent: 'space-between', marginTop: 4}}><span>{p.price ? rupees(p.price * 100) : <small>No price</small>}</span>{stockChip(p)}</div><small>{p.available} available{p.reservedStock ? ` · ${p.reservedStock} reserved` : ''}</small></div>
      </button>)}</div>
      : <Table headers={['', 'Product', 'Category', 'Dimensions (H×W×D)', 'Colour / finish', <span className="num">Price</span>, <span className="num">On hand</span>, <span className="num">Reserved</span>, <span className="num">Available</span>, <span className="num">Mfg cost</span>, 'BOM', 'Status', '']} empty="No products match.">{list.data.items.map((p: any) => <tr key={p.id}><td><ProductImage p={p} size={40} style={{borderRadius: 8, overflow: 'hidden'}} /></td><td><strong>{p.name}</strong><small className="inv-mono">{p.sku}</small></td><td>{p.category}</td><td>{dims(p) || <small>—</small>}</td><td>{[p.profile?.colour, p.profile?.finish].filter(Boolean).join(' · ') || <small>—</small>}</td><td className="num">{p.price ? rupees(p.price * 100) : '—'}</td><td className="num">{p.stock}</td><td className="num">{p.reservedStock}</td><td className="num">{p.available}</td><td className="num">{p.manufacturingCostPaise === undefined ? '' : rupees(p.manufacturingCostPaise)}</td><td>{p.bom ? <Chip tone="green">v{p.bom.version}</Chip> : <Chip>None</Chip>}</td><td>{stockChip(p)}</td><td><Button small variant="ghost" onClick={() => setOpen(p.id)}>View</Button></td></tr>)}</Table>}
      <Pager page={page} total={list.data.total} limit={24} onPage={setPage} />
    </>}
    {open && <ProductDetail id={open} categories={list.data?.categories || []} initialSection="stock" onClose={() => setOpen(null)} onChanged={() => void list.reload()} />}
  </Card>;
}
