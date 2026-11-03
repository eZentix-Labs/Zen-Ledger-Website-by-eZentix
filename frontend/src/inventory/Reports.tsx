import React, {useState} from 'react';
import {downloadCsv, get, shiftDays, todayIso} from './api';
import {Button, Card, ErrorBox, Input, Loading, Table, errText, useLoad, useToast} from './ui';

const DATED = ['purchases', 'production', 'material-consumption', 'wastage', 'manufacturing-cost', 'stock-ledger', 'adjustments', 'count-variance'];

export function Reports() {
  const toast = useToast();
  const list = useLoad(() => get<any[]>('/api/inventory/reports'), []);
  const [key, setKey] = useState('raw-material-stock'), [range, setRange] = useState({from: shiftDays(todayIso(), -29), to: todayIso()});
  const dated = DATED.includes(key);
  const rep = useLoad(() => get<any>(`/api/inventory/reports/${key}`, dated ? range : {}), [key, dated ? range.from : '', dated ? range.to : '']);
  return <div className="inv-cols" style={{gridTemplateColumns: 'minmax(220px,280px) minmax(0,1fr)'}}>
    <Card title="Reports">{!list.data ? <Loading /> : list.data.map(r => <button key={r.key} type="button" onClick={() => setKey(r.key)} className="inv-row" style={{width: '100%', background: r.key === key ? 'var(--inv-fill)' : 'transparent', border: 0, color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer', padding: '9px 8px', borderRadius: 8}}>{r.title}</button>)}</Card>
    <Card title={rep.data?.title || 'Report'} aside={<>{dated && <><Input type="date" value={range.from} max={range.to} onChange={e => setRange({...range, from: e.target.value})} aria-label="From" style={{width: 150}} /><Input type="date" value={range.to} min={range.from} onChange={e => setRange({...range, to: e.target.value})} aria-label="To" style={{width: 150}} /></>}<Button variant="ghost" onClick={() => downloadCsv(`/api/inventory/reports/${key}`, dated ? range : {}).catch(e => toast('err', errText(e)))}>Export CSV</Button><Button variant="ghost" onClick={() => window.print()}>Print / PDF</Button></>}>
      <ErrorBox error={rep.error} retry={rep.reload} />
      {!rep.data ? <Loading /> : <><small style={{display: 'block', marginBottom: 8}}>{rep.data.rows.length} row(s) · generated {new Date(rep.data.generatedAt).toLocaleString('en-IN')} from posted records</small>
        <Table headers={rep.data.columns} empty="No records for this report.">{rep.data.rows.slice(0, 500).map((r: any[], i: number) => <tr key={i}>{r.map((c, j) => <td key={j} className={/^-?[\d,.]+$/.test(String(c)) ? 'num' : ''}>{String(c ?? '')}</td>)}</tr>)}</Table>
        {rep.data.rows.length > 500 && <small>Showing the first 500 rows — export CSV for all {rep.data.rows.length}.</small>}</>}
    </Card>
  </div>;
}
