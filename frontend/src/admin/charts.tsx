// Lightweight SVG charts (no chart library). Colours come from theme tokens (--s1… in fixed order, never cycled).
// Every chart: aria-label + a screen-reader table, hover/focus tooltip, resizes with its container.
import React, {useEffect, useId, useRef, useState} from 'react';

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];
export const OTHER = 'var(--s-other)';
/** Fold anything past `max` categories into "Other" so a 7th series never gets a generated colour. */
export function foldOther<T extends {label: string; value: number}>(items: T[], max = 5, otherLabel = 'Other') {
  if (items.length <= max + 1) return items.map((x, i) => ({...x, color: SERIES[i]}));
  const head = items.slice(0, max).map((x, i) => ({...x, color: SERIES[i]}));
  return [...head, {label: otherLabel, value: items.slice(max).reduce((a, x) => a + x.value, 0), color: OTHER} as T & {color: string}];
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null); const [w, setW] = useState(0);
  useEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width))); ro.observe(el); setW(el.clientWidth); return () => ro.disconnect(); }, []);
  return [ref, w] as const;
}
const niceMax = (v: number) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; };
function SrTable({caption, head, rows}: {caption: string; head: string[]; rows: Array<Array<string | number>>}) {
  return <table className="zl-sr"><caption>{caption}</caption><thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>;
}

export function Sparkline({data, color = 'var(--accent2)', label}: {data: number[]; color?: string; label: string}) {
  const W = 84, H = 28, max = Math.max(...data, 0), min = Math.min(...data, 0), span = max - min || 1;
  const pts = data.map((v, i) => `${(i / Math.max(1, data.length - 1)) * W},${H - 2 - ((v - min) / span) * (H - 4)}`).join(' ');
  return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} trend`} style={{flex: 'none'}}><polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

/** Area/line trend: current period filled, previous period dashed. */
export function TrendChart({labels, current, previous, format, ariaLabel, curName, prevName, height = 230}: {labels: string[]; current: number[]; previous?: number[]; format: (n: number) => string; ariaLabel: string; curName: string; prevName: string; height?: number}) {
  const [ref, w] = useWidth<HTMLDivElement>(); const gid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const W = Math.max(w, 280), H = height, L = 56, R = 12, T = 12, B = 26;
  const max = niceMax(Math.max(...current, ...(previous || []), 0));
  const x = (i: number) => L + (labels.length <= 1 ? (W - L - R) / 2 : (i / (labels.length - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const line = (d: number[]) => d.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
  const every = Math.ceil(labels.length / Math.max(2, Math.floor((W - L) / 64)));
  const pick = (cx: number) => { const i = Math.round(((cx - L) / (W - L - R)) * (labels.length - 1)); return Math.max(0, Math.min(labels.length - 1, i)); };
  return <div ref={ref} className="zl-chart">
    {w > 0 && <svg width={W} height={H} role="img" aria-label={ariaLabel} tabIndex={0}
      onMouseMove={e => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); setHover(pick(e.clientX - r.left)); }} onMouseLeave={() => setHover(null)}
      onKeyDown={e => { if (e.key === 'ArrowRight') setHover(h => Math.min(labels.length - 1, (h ?? -1) + 1)); if (e.key === 'ArrowLeft') setHover(h => Math.max(0, (h ?? labels.length) - 1)); }} onBlur={() => setHover(null)}>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent2)" stopOpacity=".38" /><stop offset="1" stopColor="var(--accent2)" stopOpacity="0" /></linearGradient></defs>
      {[0, .25, .5, .75, 1].map(f => <g key={f}><line className="grid" x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} /><text className="axis" x={L - 8} y={y(max * f) + 4} textAnchor="end">{format(max * f)}</text></g>)}
      {labels.map((l, i) => i % every === 0 || i === labels.length - 1 ? <text key={i} className="axis" x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}>{l}</text> : null)}
      {previous && <path d={line(previous)} fill="none" stroke="var(--faint)" strokeWidth="2" strokeDasharray="5 5" />}
      <path d={`${line(current)}L${x(current.length - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill={`url(#${gid})`} />
      <path d={line(current)} fill="none" stroke="var(--accent2)" strokeWidth="2" strokeLinejoin="round" />
      {hover != null && <g><line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--line2)" /><circle cx={x(hover)} cy={y(current[hover])} r="5" fill="var(--accent2)" stroke="var(--card)" strokeWidth="2" />{previous && <circle cx={x(hover)} cy={y(previous[hover] || 0)} r="4" fill="var(--faint)" stroke="var(--card)" strokeWidth="2" />}</g>}
    </svg>}
    {hover != null && w > 0 && <div className="zl-ctip" style={{left: Math.min(Math.max(x(hover), 90), W - 90), top: y(Math.max(current[hover], previous?.[hover] || 0))}}><b>{labels[hover]}</b><br />{curName}: <b>{format(current[hover])}</b>{previous && <><br /><span className="m">{prevName}: {format(previous[hover] || 0)}</span></>}</div>}
    <SrTable caption={ariaLabel} head={['', curName, ...(previous ? [prevName] : [])]} rows={labels.map((l, i) => [l, format(current[i]), ...(previous ? [format(previous[i] || 0)] : [])])} />
  </div>;
}

/** Vertical bars (e.g. orders by hour). */
export function BarChart({labels, values, format, ariaLabel, height = 160, color = 'var(--accent2)'}: {labels: string[]; values: number[]; format: (n: number) => string; ariaLabel: string; height?: number; color?: string}) {
  const [ref, w] = useWidth<HTMLDivElement>(); const [hover, setHover] = useState<number | null>(null);
  const W = Math.max(w, 240), H = height, L = 28, B = 22, T = 8, max = niceMax(Math.max(...values, 0));
  const bw = (W - L) / values.length, gap = Math.min(4, bw * .25);
  const every = Math.ceil(values.length / Math.max(2, Math.floor((W - L) / 34)));
  return <div ref={ref} className="zl-chart">
    {w > 0 && <svg width={W} height={H} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
      {[0, .5, 1].map(f => <g key={f}><line className="grid" x1={L} x2={W} y1={T + (1 - f) * (H - T - B)} y2={T + (1 - f) * (H - T - B)} /><text className="axis" x={L - 6} y={T + (1 - f) * (H - T - B) + 4} textAnchor="end">{format(max * f)}</text></g>)}
      {values.map((v, i) => { const h = (v / max) * (H - T - B); return <g key={i} onMouseEnter={() => setHover(i)}>
        <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill="transparent" />
        {v > 0 && <path d={`M${L + i * bw + gap / 2},${H - B}V${H - B - h + Math.min(4, h)}q0,-${Math.min(4, h)} ${Math.min(4, h)},-${Math.min(4, h)}H${L + (i + 1) * bw - gap / 2 - Math.min(4, h)}q${Math.min(4, h)},0 ${Math.min(4, h)},${Math.min(4, h)}V${H - B}Z`} fill={color} opacity={hover == null || hover === i ? 1 : .55} />}
        {i % every === 0 && <text className="axis" x={L + i * bw + bw / 2} y={H - 6} textAnchor="middle">{labels[i]}</text>}
      </g>; })}
    </svg>}
    {hover != null && w > 0 && <div className="zl-ctip" style={{left: Math.min(Math.max(L + hover * bw + bw / 2, 60), W - 60), top: H - B - (values[hover] / max) * (H - T - B)}}><b>{labels[hover]}</b>: {format(values[hover])}</div>}
    <SrTable caption={ariaLabel} head={['', 'Value']} rows={labels.map((l, i) => [l, format(values[i])])} />
  </div>;
}

export type Slice = {label: string; value: number; color: string};
export function Donut({items, format, centerLabel, ariaLabel, size = 160}: {items: Slice[]; format: (n: number) => string; centerLabel: string; ariaLabel: string; size?: number}) {
  const total = items.reduce((a, x) => a + x.value, 0); const [hover, setHover] = useState<number | null>(null);
  const r = size / 2 - 10, c = 2 * Math.PI * r, gapLen = items.length > 1 ? 2 : 0;
  let acc = 0;
  return <div className="zl-donut-wrap">
    <div className="zl-chart" style={{width: size}}>
      <svg width={size} height={size} role="img" aria-label={ariaLabel}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="16" opacity=".5" />
        {total > 0 && items.map((s, i) => { const len = (s.value / total) * c, off = acc; acc += len; return <circle key={s.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={hover === i ? 20 : 16} strokeDasharray={`${Math.max(0, len - gapLen)} ${c}`} strokeDashoffset={-off} transform={`rotate(-90 ${size / 2} ${size / 2})`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{transition: 'stroke-width .12s'}} />; })}
        <text x={size / 2} y={size / 2 - 4} textAnchor="middle" style={{fill: 'var(--text)', font: '700 17px var(--head)', fontVariantNumeric: 'tabular-nums'}}>{hover != null ? format(items[hover].value) : format(total)}</text>
        <text x={size / 2} y={size / 2 + 15} textAnchor="middle" className="axis">{hover != null ? items[hover].label : centerLabel}</text>
      </svg>
    </div>
    <div className="zl-donut-legend">{items.map((s, i) => <div key={s.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}><i style={{background: s.color}} /><span>{s.label}</span><b>{format(s.value)}</b><small>{total ? Math.round(s.value / total * 100) : 0}%</small></div>)}</div>
    <SrTable caption={ariaLabel} head={['', 'Value', 'Share']} rows={items.map(s => [s.label, format(s.value), `${total ? Math.round(s.value / total * 100) : 0}%`])} />
  </div>;
}

export function HBars({items, format, ariaLabel, color = 'var(--accent2)'}: {items: Array<{label: string; value: number; color?: string}>; format: (n: number) => string; ariaLabel: string; color?: string}) {
  const max = Math.max(...items.map(i => i.value), 0) || 1, total = items.reduce((a, x) => a + x.value, 0);
  return <div className="zl-hbar" role="img" aria-label={ariaLabel}>
    {items.map(i => <React.Fragment key={i.label}><span className="nm" title={i.label}>{i.label}</span><span className="tr"><i style={{width: `${(i.value / max) * 100}%`, background: i.color || color}} /></span><span className="vv">{format(i.value)}<small>{total ? Math.round(i.value / total * 100) : 0}%</small></span></React.Fragment>)}
  </div>;
}

/** One horizontal stacked bar + legend (status funnel, payment split). */
export function StackBar({items, format, ariaLabel}: {items: Slice[]; format: (n: number) => string; ariaLabel: string}) {
  const total = items.reduce((a, x) => a + x.value, 0);
  return <div role="img" aria-label={ariaLabel}>
    <div className="zl-stack">{items.filter(s => s.value > 0).map(s => <i key={s.label} title={`${s.label}: ${format(s.value)}`} style={{flex: s.value, background: s.color}} />)}</div>
    <div className="zl-legend" style={{marginTop: 10}}>{items.map(s => <span key={s.label}><i style={{background: s.color}} />{s.label} <b className="num">{format(s.value)}</b>{total ? <small className="num" style={{color: 'var(--faint)'}}>{Math.round(s.value / total * 100)}%</small> : null}</span>)}</div>
  </div>;
}

export function Heatmap({days, cells, ariaLabel, hourLabel}: {days: string[]; cells: number[][]; ariaLabel: string; hourLabel: (h: number) => string}) {
  const max = Math.max(...cells.flat(), 0); const [tip, setTip] = useState<string>('');
  return <div className="zl-chart">
    <div className="zl-heat" role="img" aria-label={ariaLabel} onMouseLeave={() => setTip('')}>
      <span />{Array.from({length: 24}, (_, h) => <span key={h} style={{textAlign: 'center'}}>{h % 3 === 0 ? h : ''}</span>)}
      {days.map((d, w) => <React.Fragment key={d}><span style={{alignSelf: 'center'}}>{d}</span>{cells[w].map((v, h) => <span key={h} className={`c${v ? '' : ' z'}`} style={v ? {opacity: .18 + .82 * (v / max)} : undefined} onMouseEnter={() => setTip(`${d} ${hourLabel(h)}: ${v}`)} />)}</React.Fragment>)}
    </div>
    <p className="zl-note" aria-live="polite" style={{minHeight: 18}}>{tip}</p>
  </div>;
}

/** Radial gauge, 0..1 (can exceed 1). */
export function Gauge({value, label, sub, ariaLabel}: {value: number; label: string; sub?: string; ariaLabel: string}) {
  const S = 180, r = 70, c = Math.PI * r, v = Math.max(0, Math.min(1, value));
  return <svg width="100%" viewBox={`0 0 ${S} ${S / 2 + 34}`} role="img" aria-label={ariaLabel} style={{maxWidth: 260, display: 'block', margin: '0 auto'}}>
    <path d={`M${S / 2 - r},${S / 2 + 10} A${r},${r} 0 0 1 ${S / 2 + r},${S / 2 + 10}`} fill="none" stroke="var(--line)" strokeWidth="14" strokeLinecap="round" />
    <path d={`M${S / 2 - r},${S / 2 + 10} A${r},${r} 0 0 1 ${S / 2 + r},${S / 2 + 10}`} fill="none" stroke={value >= 1 ? 'var(--green)' : 'var(--accent2)'} strokeWidth="14" strokeLinecap="round" strokeDasharray={`${v * c} ${c}`} />
    <text x={S / 2} y={S / 2 + 2} textAnchor="middle" style={{fill: 'var(--text)', font: '700 24px var(--head)', fontVariantNumeric: 'tabular-nums'}}>{label}</text>
    {sub && <text x={S / 2} y={S / 2 + 24} textAnchor="middle" className="axis">{sub}</text>}
  </svg>;
}
