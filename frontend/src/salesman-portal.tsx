import {useEffect, useMemo, useState} from 'react';
import {erpApi, ErpCategory, ErpProduct} from './erp-api';

function unwrap<T>(value: T[] | {items?: T[]; data?: T[]}): T[] {
  if (Array.isArray(value)) return value;
  return value.items || value.data || [];
}

export function SalesmanPortal() {
  const [categories, setCategories] = useState<ErpCategory[]>([]);
  const [products, setProducts] = useState<ErpProduct[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    Promise.all([erpApi.categories(), erpApi.products()])
      .then(([categoryResult, productResult]) => {
        if (!mounted) return;
        setCategories(unwrap(categoryResult));
        setProducts(unwrap(productResult));
      })
      .catch((reason: Error) => mounted && setError(reason.message))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, []);

  const visibleProducts = useMemo(() => products.filter((product) => {
    const matchesSearch = `${product.name} ${product.sku || ''}`.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !selectedCategory || product.category === selectedCategory;
    return matchesSearch && matchesCategory && product.status !== 'inactive';
  }), [products, search, selectedCategory]);

  return <main style={{maxWidth: 1100, margin: '0 auto', padding: 16, fontFamily: 'system-ui'}}>
    <header style={{display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap'}}>
      <div><h1 style={{marginBottom: 4}}>Salesman Catalogue</h1><p style={{marginTop: 0, color: '#64748b'}}>Active products available for customer orders</p></div>
      <input aria-label="Search products" placeholder="Search products" value={search} onChange={(event) => setSearch(event.target.value)} style={{padding: 12, minWidth: 220, border: '1px solid #cbd5e1', borderRadius: 8}} />
    </header>
    <nav style={{display: 'flex', gap: 8, overflowX: 'auto', padding: '8px 0 16px'}}>
      <button onClick={() => setSelectedCategory('')} style={{padding: '10px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: !selectedCategory ? '#0f172a' : '#fff', color: !selectedCategory ? '#fff' : '#0f172a'}}>All</button>
      {categories.map((category) => <button key={category._id} onClick={() => setSelectedCategory(category._id)} style={{whiteSpace: 'nowrap', padding: '10px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: selectedCategory === category._id ? '#0f172a' : '#fff', color: selectedCategory === category._id ? '#fff' : '#0f172a'}}>{category.name}</button>)}
    </nav>
    {loading && <p>Loading catalogue…</p>}
    {error && <p role="alert" style={{color: '#b91c1c'}}>Unable to load catalogue: {error}</p>}
    {!loading && !error && visibleProducts.length === 0 && <p>No active products match this search.</p>}
    <section style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16}}>
      {visibleProducts.map((product) => <article key={product._id} style={{border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, background: '#fff'}}>
        {product.imageUrl ? <img src={product.imageUrl} alt={product.name} style={{width: '100%', height: 160, objectFit: 'cover', borderRadius: 8}} /> : <div style={{height: 160, borderRadius: 8, background: '#f1f5f9', display: 'grid', placeItems: 'center', color: '#64748b'}}>No image</div>}
        <h2 style={{fontSize: 18, marginBottom: 4}}>{product.name}</h2>
        {product.sku && <small>SKU: {product.sku}</small>}
        {product.description && <p style={{color: '#475569'}}>{product.description}</p>}
        {typeof product.sellingPrice === 'number' && <strong>₹{product.sellingPrice.toLocaleString('en-IN')}</strong>}
      </article>)}
    </section>
  </main>;
}

