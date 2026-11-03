// File storage for images and bill attachments.
// - Cloudinary when CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET are set
//   (signed server-side upload over HTTPS; the secret never reaches the browser).
// - Otherwise MongoDB GridFS (bucket "invfiles"), served by this API.
import crypto from 'node:crypto';
import express, {type Express, type Request} from 'express';
import mongoose from 'mongoose';
import {requireAuth, requirePerm, sessionUser} from '../auth.js';
import {Inv} from './models.js';
import {fail, route} from './http.js';

const MAX_BYTES = 10 * 1024 * 1024;
const KINDS: Array<{mime: string; ext: string; test: (b: Buffer) => boolean; image: boolean}> = [
  {mime: 'image/jpeg', ext: 'jpg', image: true, test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff},
  {mime: 'image/png', ext: 'png', image: true, test: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))},
  {mime: 'image/webp', ext: 'webp', image: true, test: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'},
  {mime: 'application/pdf', ext: 'pdf', image: false, test: b => b.subarray(0, 5).toString('latin1') === '%PDF-'},
];
export const sniff = (buf: Buffer) => KINDS.find(k => k.test(buf));

const cloud = () => {
  const name = process.env.CLOUDINARY_CLOUD_NAME, key = process.env.CLOUDINARY_API_KEY, secret = process.env.CLOUDINARY_API_SECRET;
  return name && key && secret ? {name, key, secret} : null;
};
export const storageMode = () => (cloud() ? 'cloudinary' : 'mongodb');

async function cloudinaryUpload(buf: Buffer, mime: string, folder: string) {
  const c = cloud()!;
  const timestamp = Math.floor(Date.now() / 1000);
  const params: Record<string, string> = {folder, timestamp: String(timestamp)};
  const toSign = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  const signature = crypto.createHash('sha1').update(toSign + c.secret).digest('hex');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buf)], {type: mime}));
  for (const [k, v] of Object.entries(params)) form.append(k, v);
  form.append('api_key', c.key); form.append('signature', signature);
  const type = mime === 'application/pdf' ? 'raw' : 'image';
  const res = await fetch(`https://api.cloudinary.com/v1_1/${c.name}/${type}/upload`, {method: 'POST', body: form});
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) fail(502, `Image service rejected the upload: ${body?.error?.message || res.status}`);
  return {url: body.secure_url as string, publicId: body.public_id as string};
}

/** Files can be shared (e.g. a duplicated product keeps the original's images): only destroy when nothing references them. */
async function stillReferenced(url?: string) {
  if (!url) return false;
  return Boolean(await Inv.ProductProfile.exists({'images.url': url}) || await Inv.Item.exists({'images.url': url}) || await Inv.Wastage.exists({'images.url': url}));
}
export async function destroyStored(file: {id?: string; publicId?: string; url?: string} | null | undefined) {
  if (!file) return;
  if (await stillReferenced(file.url)) return;
  const c = cloud();
  if (file.publicId && c) {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHash('sha1').update(`public_id=${file.publicId}&timestamp=${timestamp}${c.secret}`).digest('hex');
    const form = new FormData(); form.append('public_id', file.publicId); form.append('timestamp', String(timestamp)); form.append('api_key', c.key); form.append('signature', signature);
    await fetch(`https://api.cloudinary.com/v1_1/${c.name}/image/destroy`, {method: 'POST', body: form}).catch(e => console.error('Cloudinary destroy failed', e));
  } else if (file.id && mongoose.isValidObjectId(file.id)) {
    const meta: any = await Inv.File.findById(file.id).lean();
    if (meta?.gridId) await bucket().delete(new mongoose.Types.ObjectId(meta.gridId)).catch(() => undefined);
    await Inv.File.deleteOne({_id: file.id});
  }
}

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db!, {bucketName: 'invfiles'});

/** Store a validated buffer. Returns the descriptor saved on documents. */
export async function storeFile(buf: Buffer, opts: {name: string; purpose: string; visibility: 'public' | 'private'; uploadedBy?: any; imagesOnly?: boolean}) {
  if (!buf.length) fail(400, 'The file is empty');
  if (buf.length > MAX_BYTES) fail(413, 'Files must be 10 MB or smaller');
  const kind = sniff(buf);
  if (!kind) fail(415, 'Only JPEG, PNG, WebP images and PDF documents are accepted');
  if (opts.imagesOnly && !kind!.image) fail(415, 'Only JPEG, PNG or WebP images are accepted here');
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const name = opts.name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || `file.${kind!.ext}`;
  if (cloud() && opts.visibility === 'public') {
    const {url, publicId} = await cloudinaryUpload(buf, kind!.mime, `zen-ledger/${opts.purpose}`);
    return {id: '', url, publicId, name, mime: kind!.mime, size: buf.length, sha256};
  }
  const gridId = await new Promise<string>((resolve, reject) => {
    const up = bucket().openUploadStream(name, {metadata: {mime: kind!.mime, purpose: opts.purpose}});
    up.on('error', reject).on('finish', () => resolve(String(up.id)));
    up.end(buf);
  });
  const meta = await Inv.File.create({gridId, name, mime: kind!.mime, size: buf.length, sha256, visibility: opts.visibility, uploadedBy: opts.uploadedBy, purpose: opts.purpose});
  const id = String(meta._id);
  return {id, url: opts.visibility === 'public' ? `/api/files/public/${id}` : `/api/files/${id}`, publicId: '', name, mime: kind!.mime, size: buf.length, sha256};
}

async function streamTo(id: string, res: express.Response, requirePublic: boolean) {
  if (!mongoose.isValidObjectId(id)) return res.status(404).end();
  const meta: any = await Inv.File.findById(id).lean();
  if (!meta || (requirePublic && meta.visibility !== 'public')) return res.status(404).end();
  res.setHeader('Content-Type', meta.mime);
  res.setHeader('Cache-Control', requirePublic ? 'public, max-age=86400, immutable' : 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (meta.mime === 'application/pdf') res.setHeader('Content-Disposition', `inline; filename="${meta.name}"`);
  bucket().openDownloadStream(new mongoose.Types.ObjectId(meta.gridId)).on('error', () => res.status(404).end()).pipe(res);
}

/** Upload endpoint takes the raw file body (no multipart dependency). Must be registered before the global JSON parser. */
export function registerFileRoutes(app: Express) {
  const raw = express.raw({type: () => true, limit: MAX_BYTES + 1024});
  app.post('/api/files', requireAuth, requirePerm('inventory.view'), raw, route(async (req: Request, res) => {
    const purpose = String(req.query.purpose || 'misc').replace(/[^a-z-]/g, '').slice(0, 30) || 'misc';
    const visibility = purpose === 'bill' || purpose === 'payment' || purpose === 'document' ? 'private' : 'public';
    const name = decodeURIComponent(String(req.header('X-File-Name') || 'upload'));
    const stored = await storeFile(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), {name, purpose, visibility, imagesOnly: visibility === 'public', uploadedBy: {id: sessionUser(req).id, name: sessionUser(req).name}});
    res.status(201).json(stored);
  }));
  app.get('/api/files/public/:id', route(async (req, res) => { await streamTo(String(req.params.id), res, true); }));
  app.get('/api/files/:id', requireAuth, requirePerm('inventory.view'), route(async (req, res) => { await streamTo(String(req.params.id), res, false); }));
  app.get('/api/files-config', requireAuth, (_req, res) => res.json({storage: storageMode(), maxBytes: MAX_BYTES}));
}
