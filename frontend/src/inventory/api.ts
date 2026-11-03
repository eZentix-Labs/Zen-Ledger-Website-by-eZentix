// Inventory / sales API client. Every mutation carries an Idempotency-Key so a double-click
// or network retry can never post stock twice (the server returns the first result).
// Dev: same-origin, forwarded by the Vite proxy (vite.config.ts). Production: the deployed API.
const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || 'https://zen-ledger-website-by-ezentix.onrender.com').replace(/\/$/, '');
export const apiBase = API_BASE;

export class ApiError extends Error { constructor(message: string, public status: number, public details?: unknown) { super(message); } }
const token = () => localStorage.getItem('token') || '';
export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

async function parse(res: Response) {
  const text = await res.text();
  let body: any = null;
  if (text) { try { body = JSON.parse(text); } catch { if (!res.ok) throw new ApiError(`Server unavailable (HTTP ${res.status})`, res.status); } }
  if (!res.ok) throw new ApiError(body?.error || `Request failed (HTTP ${res.status})`, res.status, body?.details);
  return body;
}
export async function get<T = any>(path: string, query?: Record<string, unknown>): Promise<T> {
  const q = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, String(v)])).toString() : '';
  return parse(await fetch(`${API_BASE}${path}${q}`, {headers: {Authorization: `Bearer ${token()}`}}));
}
export async function send<T = any>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, key = newKey()): Promise<T> {
  return parse(await fetch(`${API_BASE}${path}`, {method, headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, 'Idempotency-Key': key}, body: body === undefined ? undefined : JSON.stringify(body)}));
}
export type StoredFile = {id: string; url: string; publicId: string; name?: string; mime?: string; size?: number};
export async function upload(file: File, purpose: string): Promise<StoredFile> {
  if (file.size > 10 * 1024 * 1024) throw new ApiError('Files must be 10 MB or smaller', 413);
  return parse(await fetch(`${API_BASE}/api/files?purpose=${encodeURIComponent(purpose)}`, {method: 'POST', headers: {Authorization: `Bearer ${token()}`, 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name)}, body: file}));
}
/** Resolve stored file URLs (relative /api/files/... or absolute Cloudinary). */
export const fileUrl = (url?: string | null) => !url ? '' : url.startsWith('/api/') ? `${API_BASE}${url}` : url;
/** Responsive image URL: Cloudinary images get an on-the-fly resize + automatic format/quality; other sources pass through. */
export const imgUrl = (url?: string | null, width = 600) => { const u = fileUrl(url); return /res\.cloudinary\.com\/.+\/image\/upload\//.test(u) ? u.replace('/image/upload/', `/image/upload/f_auto,q_auto,c_limit,w_${width}/`) : u; };
/** Private files (bills) need the auth header, so open them through a blob URL. */
export async function openPrivate(url: string) {
  const res = await fetch(fileUrl(url), {headers: {Authorization: `Bearer ${token()}`}});
  if (!res.ok) throw new ApiError('Could not open the file', res.status);
  const blob = await res.blob();
  window.open(URL.createObjectURL(blob), '_blank', 'noopener');
}
export async function downloadCsv(path: string, query: Record<string, unknown> = {}) {
  const q = new URLSearchParams(Object.entries({...query, format: 'csv'}).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString();
  const res = await fetch(`${API_BASE}${path}?${q}`, {headers: {Authorization: `Bearer ${token()}`}});
  if (!res.ok) throw new ApiError('Export failed', res.status);
  const blob = await res.blob();
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'report.csv';
  a.click(); URL.revokeObjectURL(a.href);
}

// ---------- formatting ----------
export const rupees = (paise: number | null | undefined, opts: {dash?: string} = {}) => paise == null ? (opts.dash ?? '—') : `₹${(paise / 100).toLocaleString('en-IN', {maximumFractionDigits: Math.abs(paise) < 10000 && paise % 100 ? 2 : 0, minimumFractionDigits: 0})}`;
export const compactRupees = (paise: number | null | undefined) => {
  if (paise == null) return '—';
  const r = paise / 100;
  if (Math.abs(r) >= 1e7) return `₹${(r / 1e7).toFixed(2)} Cr`;
  if (Math.abs(r) >= 1e5) return `₹${(r / 1e5).toFixed(2)} L`;
  return `₹${r.toLocaleString('en-IN', {maximumFractionDigits: 0})}`;
};
export const qty = (m: number | null | undefined, unit = '') => m == null ? '—' : `${(m / 1000).toLocaleString('en-IN', {maximumFractionDigits: 3})}${unit ? ` ${unit}` : ''}`;
export const day = (d?: string | Date | null) => d ? new Date(d).toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric'}) : '—';
export const dateTime = (d?: string | Date | null) => d ? new Date(d).toLocaleString('en-IN', {day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'}) : '—';
export const label = (s?: string | null) => (s || '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
export const todayIso = () => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Kolkata'}).format(new Date());
export const shiftDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
