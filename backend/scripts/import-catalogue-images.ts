/*
 Attach the rendered catalogue images (scripts/render-catalogue.py) to existing products and fill
 the specifications that the Steel Raj catalogue actually states. Dry run unless --apply.

   npx tsx scripts/import-catalogue-images.ts <images-dir>            # dry run (no writes)
   npx tsx scripts/import-catalogue-images.ts <images-dir> --apply    # write
   options: --replace (also replace images that already exist)   --allow-remote (non-local MongoDB)

 Uses MONGODB_URI. Images are stored in Cloudinary when CLOUDINARY_* are set, otherwise in
 MongoDB GridFS. Prices, costs and quantities are never touched.
*/
import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns';
import mongoose from 'mongoose';

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'catalogue-import-script-not-used-for-auth-xx';
const {Models} = await import('../src/models.js');
const {Inv} = await import('../src/inventory/models.js');
const {storeFile, storageMode} = await import('../src/inventory/files.js');

const dir = path.resolve(process.argv[2] || '');
const apply = process.argv.includes('--apply'), replace = process.argv.includes('--replace');
const uri = process.env.MONGODB_URI || '';
if (!uri) { console.error('Set MONGODB_URI'); process.exit(1); }
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(uri) && !process.argv.includes('--allow-remote')) { console.error('Refusing a non-local database without --allow-remote (take a verified backup first).'); process.exit(1); }
if (uri.startsWith('mongodb+srv')) dns.setServers(['1.1.1.1', '8.8.8.8']);

// Verified from STEEL RAJ CATALOG1.pdf pages 3-6 (2026-11-03). Door count is NOT stated in the catalogue, so it is left blank.
const FEATURES_BASE = ['Churi stand', 'Light', 'Maruti lock', '7-tank treatment', 'Hot phosphating'];
const STEEL: Record<string, {model: string; w: number; drawers?: number; features: string[]}> = {
  'STEEL-HEAVY-3': {model: 'Heavy 3', w: 54, features: ['Panel door', 'Shelve-chamber', '1 locker', 'E.D.D quality sheet', ...FEATURES_BASE]},
  'STEEL-ECO-2': {model: 'Eco 2', w: 34, features: ['Panel door', 'Shelve-chamber', '1 locker', ...FEATURES_BASE]},
  'STEEL-CLASSIC-2': {model: 'Classic 2', w: 37, features: ['Panel door', 'Shelve-chamber', '1 locker', ...FEATURES_BASE]},
  'STEEL-CLASSIC-3': {model: 'Classic 3', w: 48, features: ['Shelve-chamber', '1 locker', 'E.D.D quality sheet', ...FEATURES_BASE]},
  'STEEL-ECO-3': {model: 'Eco 3', w: 48, features: ['Panel door', 'Shelve-chamber', '1 locker', 'E.D.D quality sheet', ...FEATURES_BASE]},
  'STEEL-CLASSIC-SPL-2': {model: 'Classic SPL 2', w: 37, drawers: 2, features: ['Panel door', '2 drawers', '1 locker', 'E.D.D quality sheet', ...FEATURES_BASE]},
  'STEEL-PREMIUM-2L': {model: 'Premium 2(L)', w: 42, drawers: 1, features: ['Panel door', '1 back chamber', '1 locker, 1 drawer', 'E.D.D quality sheet', ...FEATURES_BASE]},
  'STEEL-PREMIUM-2': {model: 'Premium 2', w: 42, drawers: 2, features: ['Panel door', '2 drawers', '1 locker, 1 back chamber', 'E.D.D quality sheet', ...FEATURES_BASE]},
};
const SERIES = (sku: string) => sku.startsWith('FM ') ? 'Premium Design (FM) door print' : sku.startsWith('NO-') ? 'Luxury Photo front design' : sku.startsWith('SDH-') ? 'SDH print design (shown on a 3-door body)' : sku.startsWith('SRH-') ? 'Steel Raj door print design' : '';

const manifest: Array<{sku: string; file: string; role: 'main' | 'gallery'; source: {file: string; page: number}}> = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
await mongoose.connect(uri);
const products: any[] = await Models.products.find({}).select('id sku name').lean();
const bySku = new Map(products.map(p => [p.sku, p]));
const groups = new Map<string, typeof manifest>();
for (const m of manifest) groups.set(m.sku, [...(groups.get(m.sku) || []), m]);
let matched = 0, skipped = 0, written = 0;
const missing: string[] = [];
for (const [sku, files] of groups) {
  const p = bySku.get(sku);
  if (!p) { missing.push(sku); continue; }
  matched++;
  const prof: any = await Inv.ProductProfile.findOne({productId: p.id}).lean();
  const steel = STEEL[sku];
  const specs: any = steel ? {model: steel.model, heightIn: 78, widthIn: steel.w, depthIn: 20, drawerCount: steel.drawers ?? null, features: steel.features, lockType: 'Maruti lock', material: 'Steel (E.D.D quality sheet where listed)', finish: 'Powder coated · 7-tank treatment · hot phosphating', description: `Steel Raj ${steel.model}. Specifications as printed in the Steel Raj catalogue; colours shown are indicative.`}
    : {design: sku, description: `${SERIES(sku)} ${sku}. Image from the business catalogue; available body sizes, price and stock are set by the business.`};
  const hasImages = (prof?.images || []).length > 0;
  if (hasImages && !replace) { skipped++; if (!apply) continue; }
  if (!apply) { console.log(`would attach ${files.length} image(s) to ${sku} (${p.name})${steel ? ' + catalogue specs' : ''}`); continue; }
  const images = hasImages && !replace ? prof.images : [];
  if (!hasImages || replace) for (const f of files.sort(a => a.role === 'main' ? -1 : 1)) {
    const stored = await storeFile(await fs.readFile(path.join(dir, f.file)), {name: f.file, purpose: 'product', visibility: 'public', imagesOnly: true, uploadedBy: {id: 'script', name: 'Catalogue import'}});
    images.push({id: stored.id, url: stored.url, publicId: stored.publicId, name: stored.name, mime: stored.mime, size: stored.size});
  }
  // Only fill fields that are still empty; never overwrite what a user typed.
  const set: any = {images, sourceRef: files[0].source};
  for (const [k, v] of Object.entries(specs)) if (v != null && (prof?.[k] == null || prof?.[k] === '' || (Array.isArray(prof?.[k]) && !prof[k].length))) set[k] = v;
  await Inv.ProductProfile.updateOne({productId: p.id}, {$set: set, $setOnInsert: {productId: p.id}}, {upsert: true});
  written++;
}
console.log(`${apply ? 'APPLIED' : 'DRY RUN'} · storage: ${storageMode()} · products matched: ${matched} · updated: ${written} · already had images: ${skipped} · images without a product: ${missing.length}${missing.length ? ` (${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''})` : ''}`);
await mongoose.disconnect();
