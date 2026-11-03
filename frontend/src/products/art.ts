// Demonstration almirah illustrations (SVG, generated in the browser; no external assets, no licensing issue).
// Used ONLY when a product has no uploaded photo, so a product never shows an empty box or a generic icon.
// Each type is drawn differently and tinted with the product's own colour.
export type ArtType = 'single' | 'double' | 'three' | 'four' | 'office' | 'storage' | 'locker' | 'custom';
export const ART_TYPES: Array<[ArtType, string]> = [['single', 'Single Door Steel Almari'], ['double', 'Double Door Steel Almari'], ['three', 'Three Door Steel Almari'], ['four', 'Four Door Steel Almari'], ['office', 'Steel Office Cabinet'], ['storage', 'Storage Cabinet'], ['locker', 'Locker Cabinet'], ['custom', 'Custom Design Almari']];

const COLOURS: Array<[RegExp, string]> = [[/red|maroon|crimson/i, '#a8323b'], [/blue|navy/i, '#2f5d9e'], [/green|olive/i, '#3f7a52'], [/grey|gray|silver/i, '#8a8f99'], [/black|charcoal/i, '#33343b'], [/white|ivory|cream/i, '#e9e4d8'], [/brown|wood|walnut|teak/i, '#7a5236'], [/yellow|gold/i, '#c99a2e'], [/pink|rose/i, '#c4677f'], [/purple|violet/i, '#6c4fa8'], [/beige|sand/i, '#c8b48f']];
const DEFAULT: Record<ArtType, string> = {single: '#7d8796', double: '#9b6f4a', three: '#5c7b93', four: '#6f7f68', office: '#8a8f99', storage: '#a4a9b1', locker: '#4f6f8f', custom: '#7a4f9a'};

export function artType(p: {name?: string; category?: string; profile?: {doorCount?: number | null; model?: string} | null}): ArtType {
  const s = `${p.name || ''} ${p.category || ''} ${p.profile?.model || ''}`.toLowerCase();
  if (/locker/.test(s)) return 'locker';
  if (/office|file|drawer cabinet/.test(s)) return 'office';
  if (/storage|rack|shelf/.test(s)) return 'storage';
  if (/custom|luxury|premium design|print|\bsdh\b|\bsrh\b|\bfm\b/.test(s)) return 'custom';
  const d = p.profile?.doorCount ?? (/single|1[\s-]?door/.test(s) ? 1 : /four|4[\s-]?door/.test(s) ? 4 : /three|3[\s-]?door|\b3\b/.test(s) ? 3 : /\b2\b|double|2[\s-]?door/.test(s) ? 2 : null);
  return d === 1 ? 'single' : d === 3 ? 'three' : d != null && d >= 4 ? 'four' : 'double';
}
function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.max(0, Math.min(255, Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1)))));
  return `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

export function almirahSvg(type: ArtType, colour?: string | null): string {
  const base = (colour && COLOURS.find(([r]) => r.test(colour))?.[1]) || DEFAULT[type];
  const hi = shade(base, 1.18), lo = shade(base, 0.72), line = shade(base, 0.55);
  const W = 400, H = 500, x = 70, y = 40, w = 260, h = 410;
  let doors = '';
  const handle = (hx: number, hy: number) => `<rect x="${hx - 3}" y="${hy}" width="6" height="46" rx="3" fill="#d9dbe0" stroke="#7d828c"/><rect x="${hx - 5}" y="${hy + 52}" width="10" height="14" rx="2" fill="#c9a640" stroke="#7a6320"/>`;
  const vDoors = (n: number, deco = false) => { const dw = w / n; let s = ''; for (let i = 0; i < n; i++) { const dx = x + i * dw; s += `<rect x="${dx + 4}" y="${y + 4}" width="${dw - 8}" height="${h - 8}" rx="3" fill="url(#door)" stroke="${line}"/>`; if (deco) s += `<g opacity=".85"><circle cx="${dx + dw / 2}" cy="${y + h * .32}" r="${dw * .26}" fill="${hi}" opacity=".35"/><circle cx="${dx + dw / 2}" cy="${y + h * .32}" r="${dw * .14}" fill="#f2d7a8" opacity=".6"/><path d="M${dx + dw * .2} ${y + h * .7} q${dw * .3} -${h * .18} ${dw * .6} 0" fill="none" stroke="#f2d7a8" stroke-width="3" opacity=".55"/></g>`; if (i < n - 1 || n === 1) s += handle(i < n - 1 ? dx + dw - 12 : dx + dw - 20, y + h * .42); } return s; };
  if (type === 'single') doors = vDoors(1);
  else if (type === 'double') doors = vDoors(2);
  else if (type === 'three') doors = vDoors(3);
  else if (type === 'four') doors = vDoors(4);
  else if (type === 'custom') doors = vDoors(2, true);
  else if (type === 'office') { const n = 4, dh = (h - 8) / n; for (let i = 0; i < n; i++) doors += `<rect x="${x + 4}" y="${y + 4 + i * dh}" width="${w - 8}" height="${dh - 6}" rx="3" fill="url(#door)" stroke="${line}"/><rect x="${x + w / 2 - 40}" y="${y + 4 + i * dh + dh * .35}" width="80" height="10" rx="5" fill="#d9dbe0" stroke="#7d828c"/><rect x="${x + w / 2 - 18}" y="${y + 4 + i * dh + dh * .12}" width="36" height="14" rx="2" fill="#f4f1e8" stroke="#9b9b9b"/>`; }
  else if (type === 'storage') { doors = `<rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h * .48}" rx="3" fill="#b9d3e2" opacity=".55" stroke="${line}"/>`; for (let i = 1; i < 3; i++) doors += `<line x1="${x + 8}" x2="${x + w - 8}" y1="${y + 4 + i * h * .16}" y2="${y + 4 + i * h * .16}" stroke="${line}" stroke-width="4"/>`; doors += `<line x1="${x + w / 2}" x2="${x + w / 2}" y1="${y + 4}" y2="${y + h * .48}" stroke="${line}" stroke-width="3"/>`; const by = y + h * .5; for (let i = 0; i < 2; i++) doors += `<rect x="${x + 4 + i * (w - 8) / 2}" y="${by}" width="${(w - 8) / 2 - 4}" height="${h * .5 - 8}" rx="3" fill="url(#door)" stroke="${line}"/>`; doors += handle(x + w / 2 - 12, by + 40) + handle(x + w / 2 + 12, by + 40); }
  else if (type === 'locker') { const c = 3, r = 4, cw = (w - 8) / c, rh = (h - 8) / r; for (let i = 0; i < c; i++) for (let j = 0; j < r; j++) { const lx = x + 4 + i * cw, ly = y + 4 + j * rh; doors += `<rect x="${lx + 2}" y="${ly + 2}" width="${cw - 4}" height="${rh - 4}" rx="3" fill="url(#door)" stroke="${line}"/>`; for (let k = 0; k < 3; k++) doors += `<line x1="${lx + 14}" x2="${lx + cw - 14}" y1="${ly + 14 + k * 6}" y2="${ly + 14 + k * 6}" stroke="${line}" stroke-width="2"/>`; doors += `<circle cx="${lx + cw - 16}" cy="${ly + rh / 2 + 8}" r="6" fill="#c9a640" stroke="#7a6320"/>`; } }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f2ee"/><stop offset="1" stop-color="#d9d5cc"/></linearGradient><linearGradient id="door" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${lo}"/><stop offset=".45" stop-color="${hi}"/><stop offset="1" stop-color="${base}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#bg)"/><ellipse cx="${W / 2}" cy="${y + h + 22}" rx="${w * .62}" ry="14" fill="#000" opacity=".16"/><rect x="${x - 6}" y="${y - 10}" width="${w + 12}" height="14" rx="3" fill="${lo}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${base}" stroke="${line}" stroke-width="2"/>${doors}<rect x="${x + 10}" y="${y + h}" width="16" height="14" fill="${line}"/><rect x="${x + w - 26}" y="${y + h}" width="16" height="14" fill="${line}"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
const cache = new Map<string, string>();
/** Illustration for a product without a photo (cached per type+colour). */
export function productArt(p: {name?: string; category?: string; profile?: any}) {
  const t = artType(p), c = p.profile?.colour || '';
  const k = `${t}|${c}`;
  if (!cache.has(k)) cache.set(k, almirahSvg(t, c));
  return cache.get(k)!;
}
