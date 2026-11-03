import React, {useEffect, useState} from 'react';
import {get, label, send} from './api';
import {Button, Dialog, ErrorBox, Field, Input, Loading, Select, useAction, useLoad, useToast} from './ui';

const GRANT_LABEL: Record<string, string> = {'item.manage': 'Add & edit stock items and products', 'purchase.approve': 'Approve purchase orders', 'bom.manage': 'Create & edit BOMs', 'production.manage': 'Run production orders', 'production.approve': 'Approve BOMs & production', 'wastage.approve': 'Approve wastage', 'adjustment.approve': 'Approve stock adjustments', 'count.approve': 'Approve stock counts', 'salesman.deactivate': 'Activate / deactivate salesmen', 'salesman.resetPassword': 'Reset salesman passwords', 'target.manage': 'Assign & revise sales targets', 'payment.void': 'Void customer payments'};

export function SettingsDialog({onClose, onSaved}: {onClose: () => void; onSaved: () => void}) {
  const toast = useToast(); const d = useLoad(() => get<any>('/api/inventory/settings'), []); const {busy, run} = useAction();
  const [f, setF] = useState<any>(null), [stages, setStages] = useState<string[]>([]);
  useEffect(() => { if (d.data) { setF({purchase: String(d.data.purchaseApprovalLimitPaise / 100), adjustment: String(d.data.adjustmentApprovalLimitPaise / 100), self: d.data.selfApprovalAllowed, tolerance: String(d.data.overReceiptToleranceBps / 100), state: d.data.companyStateCode, grants: d.data.accountantGrants || [], salesCountAt: d.data.salesCountAt || 'APPROVED'}); setStages(d.data.stages.map((s: any) => s.name)); } }, [d.data]);
  const save = async () => {
    if (!stages.filter(s => s.trim()).length) return toast('err', 'Keep at least one production stage');
    if (await run(() => send('PUT', '/api/inventory/settings', {revision: d.data.revision, purchaseApprovalLimitRupees: Number(f.purchase || 0), adjustmentApprovalLimitRupees: Number(f.adjustment || 0), selfApprovalAllowed: f.self, overReceiptTolerancePct: Number(f.tolerance || 0), companyStateCode: f.state, stages: stages.filter(s => s.trim()).map(name => ({name: name.trim()})), accountantGrants: f.grants, salesCountAt: f.salesCountAt}), 'Settings saved')) onSaved();
  };
  return <Dialog title="Inventory & business settings" onClose={onClose} busy={busy} wide footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={save} disabled={busy || !f}>Save settings</Button></>}>
    <ErrorBox error={d.error} retry={d.reload} />
    {!f ? <Loading /> : <div className="inv-form">
      <div className="inv-section-title" style={{borderTop: 0, marginTop: 0}}>Approvals</div>
      <Field label="Auto-approve purchase orders up to (₹)" hint="0 = every purchase order needs Admin approval"><Input type="number" min="0" value={f.purchase} onChange={e => setF({...f, purchase: e.target.value})} /></Field>
      <Field label="Auto-post adjustments up to (₹)" hint="0 = every adjustment by non-approvers needs approval; missing/damaged always do"><Input type="number" min="0" value={f.adjustment} onChange={e => setF({...f, adjustment: e.target.value})} /></Field>
      <label className="inv-check"><input type="checkbox" checked={f.self} onChange={e => setF({...f, self: e.target.checked})} /> Allow people to approve records they created</label>
      <Field label="Over-receipt tolerance (%)" hint="0 = cannot accept more than ordered"><Input type="number" min="0" max="20" value={f.tolerance} onChange={e => setF({...f, tolerance: e.target.value})} /></Field>
      <Field label="Company GST state code" hint="e.g. 19 for West Bengal — decides CGST+SGST vs IGST"><Input value={f.state} maxLength={2} onChange={e => setF({...f, state: e.target.value.replace(/\D/g, '')})} /></Field>
      <Field label="A sale counts towards targets when the order is" hint="Pending, rejected and cancelled orders never count"><Select value={f.salesCountAt} onChange={e => setF({...f, salesCountAt: e.target.value})} options={[['APPROVED', 'Approved (or later)'], ['DISPATCHED', 'Dispatched (or delivered)']]} /></Field>
      <div className="inv-section-title">Manufacturing stages (in order)</div>
      <div className="inv-field wide">{stages.map((s, i) => <div key={i} className="inv-actions" style={{marginBottom: 6}}><span style={{width: 22, color: 'var(--faint)'}}>{i + 1}.</span><Input value={s} onChange={e => setStages(stages.map((x, j) => j === i ? e.target.value : x))} /><Button small variant="ghost" disabled={i === 0} onClick={() => { const n = [...stages]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setStages(n); }}>↑</Button><Button small variant="ghost" onClick={() => setStages(stages.filter((_, j) => j !== i))}>Remove</Button></div>)}<Button small variant="subtle" onClick={() => setStages([...stages, ''])}>+ Add stage</Button><small>Changes apply to production orders approved from now on; running orders keep their stages.</small></div>
      <div className="inv-section-title">Extra permissions for Accountants</div>
      <div className="inv-field wide"><small style={{marginBottom: 6}}>Accountants can always view inventory, manage suppliers, create purchases, receive goods, record bills and payments, report wastage, count stock and create salesmen. Grant more below. System settings, permissions and ledger reversals stay Admin-only.</small>
        {d.data.delegable.map((g: string) => <label className="inv-check" key={g}><input type="checkbox" checked={f.grants.includes(g)} onChange={e => setF({...f, grants: e.target.checked ? [...f.grants, g] : f.grants.filter((x: string) => x !== g)})} /> {GRANT_LABEL[g] || label(g)}</label>)}</div>
    </div>}
  </Dialog>;
}
