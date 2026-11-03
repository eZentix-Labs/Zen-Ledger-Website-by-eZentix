import { Product } from './types.js';

type CatalogItem = { sku: string; name: string; category: string; page: number };

const series = (prefix: string, start: number, end: number, category: string, label: string): CatalogItem[] =>
  Array.from({ length: end - start + 1 }, (_, index) => {
    const number = start + index;
    const code = `${prefix}${prefix === 'FM ' ? number : String(number).padStart(2, '0')}`;
    return { sku: code, name: `${label} ${code}`, category, page: index + 1 };
  });

const pdfCatalog: CatalogItem[] = [
  ...series('FM ', 901, 1000, 'Premium Design', 'Premium Design'),
  ...series('NO-', 1, 100, 'Luxury Photo', 'Luxury Photo'),
  ...series('SDH-', 1, 100, 'SDH', 'SDH'),
  ...[
    'SRH-16', 'SRH-15', 'SRH-13', 'SRH-11', 'SRH-52', 'SRH-50', 'SRH-51', 'SRH-53',
    'SRH-95', 'SRH-07', 'SRH-55', 'SRH-54', 'SRH-22', 'SRH-24', 'SRH-43', 'SRH-20',
  ].map((sku, index) => ({ sku, name: `Steel Raj ${sku}`, category: 'Steel Raj', page: 2 + Math.floor(index / 4) })),
  ...[
    ['STEEL-HEAVY-3', 'Steel Raj Heavy 3'],
    ['STEEL-ECO-2', 'Steel Raj Eco 2'],
    ['STEEL-CLASSIC-2', 'Steel Raj Classic 2'],
    ['STEEL-CLASSIC-3', 'Steel Raj Classic 3'],
    ['STEEL-ECO-3', 'Steel Raj Eco 3'],
    ['STEEL-CLASSIC-SPL-2', 'Steel Raj Classic SPL 2'],
    ['STEEL-PREMIUM-2L', 'Steel Raj Premium 2(L)'],
    ['STEEL-PREMIUM-2', 'Steel Raj Premium 2'],
  ].map(([sku, name], index) => ({ sku, name, category: 'Steel Raj', page: 3 + Math.floor(index / 2) })),
];

export const pdfCatalogProducts = (): Product[] => pdfCatalog.map((item, index) => ({
  id: `pdf-${item.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  name: item.name,
  sku: item.sku,
  category: item.category,
  unit: 'piece',
  price: 0,
  stock: 0,
  reservedStock: 0,
  reorder: 0,
  status: 'active',
  source: `resorce catalog page ${item.page}`,
  sortOrder: index,
} as Product));
