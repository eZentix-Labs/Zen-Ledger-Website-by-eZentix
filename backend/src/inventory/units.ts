// Units of measure. Quantities are stored as integer thousandths ("milli", suffix M)
// so additions never drift; COUNT-dimension units must be whole numbers.
export type Dimension = 'COUNT' | 'MASS' | 'LENGTH' | 'AREA' | 'VOLUME';

export const UNITS: Record<string, {label: string; dimension: Dimension; toBase?: number}> = {
  pcs: {label: 'Pieces', dimension: 'COUNT'},
  set: {label: 'Sets', dimension: 'COUNT'},
  sheet: {label: 'Sheets', dimension: 'COUNT'},
  box: {label: 'Boxes', dimension: 'COUNT'},
  bundle: {label: 'Bundles', dimension: 'COUNT'},
  roll: {label: 'Rolls', dimension: 'COUNT'},
  kg: {label: 'Kilograms', dimension: 'MASS', toBase: 1},
  g: {label: 'Grams', dimension: 'MASS', toBase: 0.001},
  m: {label: 'Metres', dimension: 'LENGTH', toBase: 1},
  cm: {label: 'Centimetres', dimension: 'LENGTH', toBase: 0.01},
  mm: {label: 'Millimetres', dimension: 'LENGTH', toBase: 0.001},
  ft: {label: 'Feet', dimension: 'LENGTH', toBase: 0.3048},
  in: {label: 'Inches', dimension: 'LENGTH', toBase: 0.0254},
  sqm: {label: 'Square metres', dimension: 'AREA', toBase: 1},
  sqft: {label: 'Square feet', dimension: 'AREA', toBase: 0.09290304},
  l: {label: 'Litres', dimension: 'VOLUME', toBase: 1},
  ml: {label: 'Millilitres', dimension: 'VOLUME', toBase: 0.001},
};
export const UNIT_CODES = Object.keys(UNITS) as [string, ...string[]];

export class UnitError extends Error {}

/** A purchase-unit conversion stored on an item: 1 `unit` = `factor` stock units. */
export type PurchaseUnit = {unit: string; factor: number};

/**
 * Factor to convert 1 `from` into the item's stock unit.
 * - same unit → 1
 * - same dimension with fixed factors (kg↔g, m↔ft, l↔ml…) → computed
 * - anything else only via an explicit, item-specific purchase unit (e.g. 1 sheet = 21.4 kg)
 */
export function factorToStock(from: string, stockUnit: string, purchaseUnits: PurchaseUnit[] = []): number {
  if (!UNITS[from] || !UNITS[stockUnit]) throw new UnitError(`Unknown unit ${!UNITS[from] ? from : stockUnit}`);
  if (from === stockUnit) return 1;
  const explicit = purchaseUnits.find(p => p.unit === from);
  if (explicit) { if (!(explicit.factor > 0)) throw new UnitError(`Invalid conversion for ${from}`); return explicit.factor; }
  const a = UNITS[from], b = UNITS[stockUnit];
  if (a.dimension === b.dimension && a.toBase && b.toBase) return a.toBase / b.toBase;
  throw new UnitError(`No conversion from ${from} to ${stockUnit} is defined for this item`);
}

export const toM = (qty: number) => Math.round(qty * 1000);
export const fromM = (m: number) => m / 1000;

/** Validate a quantity in a unit and return milli-units. */
export function qtyToM(qty: unknown, unit: string, {allowZero = false} = {}): number {
  const n = typeof qty === 'string' ? Number(qty) : qty;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new UnitError('Enter a valid quantity');
  if (n < 0 || (!allowZero && n === 0)) throw new UnitError('Quantity must be greater than zero');
  const m = toM(n);
  if (Math.abs(m - n * 1000) > 1e-6) throw new UnitError('Use at most 3 decimal places');
  if (UNITS[unit]?.dimension === 'COUNT' && m % 1000 !== 0) throw new UnitError(`${UNITS[unit].label} must be whole numbers`);
  return m;
}
