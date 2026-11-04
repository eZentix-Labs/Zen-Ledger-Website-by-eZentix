// Two charts the shared admin kit did not have yet. Same rules as admin/charts.tsx: theme tokens only,
// aria-label + screen-reader table, keyboard/hover tooltip, resizes with its container.
import React, {useState} from 'react';
import {niceMax, SrTable, useWidth} from '../../admin/charts';

/** Bars = billed, solid line = collected, dashed line = previous period billed. The highest bar is labelled. */
export function ComboChart({labels, bars, line, prev, format, axisFormat, ariaLabel, names, height = 270}: {labels: string[]; bars: number[]; line: number[]; prev?: number[]; format: (n: number) => string; axisFormat: (n: number) => string; ariaLabel: string; names: {bars: string; line: string; prev: string}; height?: number}) {
  const [ref, w] = useWidth<HTMLDivElement>(); const [hover, setHover] = useState<number | null>(null);
  const W = Math.max(w, 200), H = Math.round(Math.min(height, Math.max(230, W * .6))), L = 62, R = 10, T = 26, B = 28, n = labels.length;
  const max = niceMax(Math.max(...bars, ...line, ...(prev || []), 0));
  const bw = (W - L - R) / Math.max(1, n), gap = Math.min(8, bw * .28);
  const cx = (i: number) => L + i * bw + bw / 2, y = (v: number) => T + (1 - v / max) * (H - T - B);
  const path = (d: number[]) => d.map((v, i) => `${i ? 'L' : 'M'}${cx(i)},${y(v)}`).join('');
  const top = bars.reduce((bi, v, i, a) => v > a[bi] ? i : bi, 0);
  const every = Math.ceil(n / Math.max(2, Math.floor((W - L) / 58)));
  const move = (d: number) => setHover(h => Math.max(0, Math.min(n - 1, (h ?? (d > 0 ? -1 : n)) + d)));
  return <div ref={ref} className="zl-chart">
    {w > 0 && <svg width={W} height={H} role="img" aria-label={ariaLabel} tabIndex={0} onMouseLeave={() => setHover(null)} onBlur={() => setHover(null)}
      onKeyDown={e => { if (e.key === 'ArrowRight') move(1); if (e.key === 'ArrowLeft') move(-1); }}>
      {[0, .25, .5, .75, 1].map(f => <g key={f}><line className="grid" x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} /><text className="axis" x={L - 8} y={y(max * f) + 4} textAnchor="end">{axisFormat(max * f)}</text></g>)}
      {bars.map((v, i) => { const h = (v / max) * (H - T - B), r = Math.min(5, h, (bw - gap) / 2); return <g key={i} onMouseEnter={() => setHover(i)}>
        <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill="transparent" />
        {v > 0 && <path d={`M${L + i * bw + gap / 2},${H - B}V${H - B - h + r}q0,-${r} ${r},-${r}H${L + (i + 1) * bw - gap / 2 - r}q${r},0 ${r},${r}V${H - B}Z`} fill="var(--accent2)" opacity={i === top ? 1 : hover === i ? .85 : .5} />}
        {((i % every === 0 && n - 1 - i >= every * .8) || i === n - 1) && <text className="axis" x={cx(i)} y={H - 8} textAnchor={i === n - 1 ? 'end' : 'middle'}>{labels[i]}</text>}
      </g>; })}
      {bars[top] > 0 && <text x={cx(top)} y={y(bars[top]) - 8} textAnchor="middle" className="ins-vlabel">{axisFormat(bars[top])}</text>}
      {prev && prev.some(v => v > 0) && <path d={path(prev)} fill="none" stroke="var(--faint)" strokeWidth="2" strokeDasharray="5 5" pointerEvents="none" />}
      {line.some(v => v > 0) && <><path d={path(line)} fill="none" stroke="var(--cyan)" strokeWidth="2.5" strokeLinejoin="round" pointerEvents="none" />
        {n <= 14 && line.map((v, i) => <circle key={i} cx={cx(i)} cy={y(v)} r={hover === i ? 5 : 3} fill="var(--cyan)" stroke="var(--card)" strokeWidth="1.5" pointerEvents="none" />)}</>}
      {hover != null && <line x1={cx(hover)} x2={cx(hover)} y1={T} y2={H - B} stroke="var(--line2)" pointerEvents="none" />}
    </svg>}
    {hover != null && w > 0 && <div className="zl-ctip" style={{left: Math.min(Math.max(cx(hover), 100), W - 100), top: y(Math.max(bars[hover], line[hover], prev?.[hover] || 0))}}>
      <b>{labels[hover]}</b><br />{names.bars}: <b>{format(bars[hover])}</b><br />{names.line}: <b>{format(line[hover])}</b>{prev && <><br /><span className="m">{names.prev}: {format(prev[hover] || 0)}</span></>}
    </div>}
    <SrTable caption={ariaLabel} head={['', names.bars, names.line, ...(prev ? [names.prev] : [])]} rows={labels.map((l, i) => [l, format(bars[i]), format(line[i]), ...(prev ? [format(prev[i] || 0)] : [])])} />
  </div>;
}

export type Zone = 'win' | 'popular' | 'slow' | 'fix';
export const ZONE_COLOR: Record<Zone, string> = {win: 'var(--green)', popular: 'var(--amber)', slow: 'var(--blue)', fix: 'var(--red)'};
export const zoneOf = (x: number, y: number, ax: number, ay: number): Zone => x >= ax ? (y >= ay ? 'win' : 'popular') : (y >= ay ? 'slow' : 'fix');

/** x = pieces sold, y = profit per piece; dashed averages split four named zones. */
export function Quadrant({points, ax, ay, formatY, ariaLabel, zoneName, axisNames, height = 300}: {points: Array<{id: string; label: string; x: number; y: number}>; ax: number; ay: number; formatY: (n: number) => string; ariaLabel: string; zoneName: Record<Zone, string>; axisNames: {x: string; y: string}; height?: number}) {
  const [ref, w] = useWidth<HTMLDivElement>(); const [hover, setHover] = useState<string | null>(null);
  const W = Math.max(w, 200), H = height, L = 66, R = 14, T = 14, B = 40;
  const xMax = niceMax(Math.max(...points.map(p => p.x), 1) * 1.08);
  const yHi = niceMax(Math.max(...points.map(p => p.y), 1) * 1.1), yLo = Math.min(0, ...points.map(p => p.y)) * 1.15;
  const x = (v: number) => L + (v / xMax) * (W - L - R), y = (v: number) => T + (1 - (v - yLo) / (yHi - yLo)) * (H - T - B);
  const hp = points.find(p => p.id === hover);
  const corner = (z: Zone, xx: number, yy: number, anchor: 'start' | 'end') => <text x={xx} y={yy} textAnchor={anchor} className="ins-zone">{zoneName[z]}</text>;
  return <div ref={ref} className="zl-chart">
    {w > 0 && <svg width={W} height={H} role="img" aria-label={ariaLabel}>
      {[0, .5, 1].map(f => { const v = yLo + (yHi - yLo) * f; return <g key={f}><line className="grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} /><text className="axis" x={L - 8} y={y(v) + 4} textAnchor="end">{formatY(v)}</text></g>; })}
      {yLo < 0 && <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--line2)" />}
      {[0, .5, 1].map(f => <text key={f} className="axis" x={x(xMax * f)} y={H - 22} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}>{Math.round(xMax * f).toLocaleString('en-IN')}</text>)}
      <text className="axis" x={(L + W - R) / 2} y={H - 4} textAnchor="middle">{axisNames.x}</text>
      <text className="axis" x={12} y={(T + H - B) / 2} textAnchor="middle" transform={`rotate(-90 12 ${(T + H - B) / 2})`}>{axisNames.y}</text>
      <line x1={x(ax)} x2={x(ax)} y1={T} y2={H - B} stroke="var(--faint)" strokeDasharray="4 4" />
      <line x1={L} x2={W - R} y1={y(ay)} y2={y(ay)} stroke="var(--faint)" strokeDasharray="4 4" />
            {points.map(p => { const z = zoneOf(p.x, p.y, ax, ay); return <circle key={p.id} cx={x(p.x)} cy={y(p.y)} r={hover === p.id ? 9 : 7} fill={ZONE_COLOR[z]} fillOpacity=".8" stroke="var(--card)" strokeWidth="2" tabIndex={0}
        aria-label={`${p.label}: ${p.x} ${axisNames.x}, ${formatY(p.y)} ${axisNames.y}, ${zoneName[z]}`} onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(p.id)} onBlur={() => setHover(null)} style={{cursor: 'pointer', outline: 'none'}} />; })}
      {corner('slow', L + 6, T + 14, 'start')}{corner('win', W - R - 6, T + 14, 'end')}{corner('fix', L + 6, y(ay) + 16, 'start')}{corner('popular', W - R - 6, y(ay) + 16, 'end')}
    </svg>}
    {hp && w > 0 && <div className="zl-ctip" style={{left: Math.min(Math.max(x(hp.x), 110), W - 110), top: y(hp.y)}}><b>{hp.label}</b><br />{axisNames.x}: <b>{hp.x.toLocaleString('en-IN')}</b><br />{axisNames.y}: <b>{formatY(hp.y)}</b><br /><span className="m">{zoneName[zoneOf(hp.x, hp.y, ax, ay)]}</span></div>}
    <SrTable caption={ariaLabel} head={['', axisNames.x, axisNames.y, '']} rows={points.map(p => [p.label, p.x, formatY(p.y), zoneName[zoneOf(p.x, p.y, ax, ay)]])} />
  </div>;
}

export {RankBars} from '../../admin/charts';

/** A few labelled columns, for ordered buckets such as due age. */
export function Columns({items, ariaLabel}: {items: Array<{key: string; label: string; sub: string; value: number; show: string; title?: string; color: string}>; ariaLabel: string}) {
  const top = Math.max(...items.map(i => i.value), 0) || 1;
  return <div className="ins-cols" role="img" aria-label={`${ariaLabel}: ${items.map(i => `${i.label} ${i.show}`).join(', ')}`}>{items.map(i => <div className="ins-col" key={i.key} title={i.title}>
    <div className="plot"><b>{i.show}</b><i style={{height: `${i.value / top * 78}%`, background: i.color}} /></div>
    <span>{i.label}</span><small>{i.sub}</small>
  </div>)}</div>;
}
