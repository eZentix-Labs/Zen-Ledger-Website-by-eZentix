import {rupees} from '../inventory/api';

type Part = {label: string; value: number};
/** Thin two/three-part bar. Each part is also written out as text, so colour is never the only signal. */
export function SplitBar({label, a, b, c, money, empty}: {label: string; a: Part; b: Part; c?: Part; money?: boolean; empty?: string}) {
  const parts = [a, b, ...(c ? [c] : [])], total = parts.reduce((x, p) => x + p.value, 0);
  const fmt = (v: number) => money ? rupees(v) : String(v);
  return <div className="ins-split">
    {label && <div className="ins-split-head"><span>{label}</span></div>}
    {total ? <>
      <div className="ins-split-bar" aria-hidden="true">{parts.map((p, i) => <i key={p.label} className={`p${i}`} style={{width: `${p.value / total * 100}%`}} />)}</div>
      <div className="ins-split-legend">{parts.map((p, i) => <span key={p.label}><i className={`p${i}`} />{p.label} <b className="ins-num">{fmt(p.value)}</b> <small className="ins-num">{Math.round(p.value / total * 100)}%</small></span>)}</div>
    </> : <small>{empty}</small>}
  </div>;
}
