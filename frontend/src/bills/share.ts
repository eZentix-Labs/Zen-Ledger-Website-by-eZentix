// Print and WhatsApp helpers for bills. Client-side only: the app has no PDF or messaging service yet,
// so "Print / PDF" uses the browser's print dialog (Save as PDF) and WhatsApp opens a prefilled chat.
import type {Bill, BillDetailResponse} from './api';

const rs = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]!);
const dmy = (iso: string) => iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-IN', {day: '2-digit', month: '2-digit', year: 'numeric'}) : '';

/** wa.me link with a short bill summary (Indian numbers get the 91 prefix). */
export function whatsappLink(b: Pick<Bill, 'customerPhone' | 'customerName' | 'invoiceNumber' | 'number' | 'billDate' | 'totalPaise' | 'paidPaise' | 'duePaise'>) {
  const digits = (b.customerPhone || '').replace(/\D/g, '');
  const phone = digits.length === 10 ? `91${digits}` : digits;
  const text = [`Dear ${b.customerName},`, `Bill ${b.invoiceNumber || b.number} dated ${dmy(b.billDate)}`, `Total: ${rs(b.totalPaise)}`, `Paid: ${rs(b.paidPaise)}`, b.duePaise > 0 ? `Balance due: ${rs(b.duePaise)}` : 'Fully paid. Thank you!'].join('\n');
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

function openPrint(title: string, body: string) {
  // 'noopener' would make window.open return null, so we drop the opener link by hand instead
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  w.opener = null;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font:13px/1.45 Inter,system-ui,sans-serif;color:#111;margin:24px}h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:18px 0 6px}
    table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left}th{font-size:11px;text-transform:uppercase;color:#555}
    .r{text-align:right;font-variant-numeric:tabular-nums}.muted{color:#666}.tot td{font-weight:700;border-top:2px solid #111}.note{margin-top:14px;font-size:11px;color:#666}
  </style></head><body>${body}<script>window.onload=()=>{window.print();}</script></body></html>`);
  w.document.close();
}

/** One printable page listing several bills (Print selected / Print row). */
export function printBills(bills: Bill[], t: (s: string) => string) {
  const rows = bills.map(b => `<tr><td>${esc(b.invoiceNumber || b.number)}</td><td>${dmy(b.billDate)}</td><td>${esc(b.customerName)}</td><td class="r">${rs(b.totalPaise)}</td><td class="r">${rs(b.paidPaise)}</td><td class="r">${rs(b.duePaise)}</td></tr>`).join('');
  const sum = (k: 'totalPaise' | 'paidPaise' | 'duePaise') => rs(bills.reduce((a, b) => a + b[k], 0));
  openPrint(t('Bills'), `<h1>${esc(t('Bills'))}</h1><table><thead><tr><th>${esc(t('Bill no.'))}</th><th>${esc(t('Date'))}</th><th>${esc(t('Customer'))}</th><th class="r">${esc(t('Total'))}</th><th class="r">${esc(t('Paid'))}</th><th class="r">${esc(t('Due'))}</th></tr></thead><tbody>${rows}<tr class="tot"><td colspan="3">${bills.length} ${esc(t('bills'))}</td><td class="r">${sum('totalPaise')}</td><td class="r">${sum('paidPaise')}</td><td class="r">${sum('duePaise')}</td></tr></tbody></table>`);
}

/** Printable single bill (use the browser's "Save as PDF" for a PDF). GST split is an estimate, and says so. */
export function printBill(b: BillDetailResponse, t: (s: string) => string) {
  const lines = b.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.design || l.sku)}</td><td>${esc(l.name)}</td><td class="r">${l.qty}</td><td class="r">${rs(l.ratePaise)}</td><td class="r">${l.gstRateBps / 100}%</td><td class="r">${rs(l.totalPaise)}</td></tr>`).join('');
  openPrint(b.invoiceNumber || b.number, `
    <h1>${esc(t('Tax invoice'))} ${esc(b.invoiceNumber || b.number)}</h1><div class="muted">${esc(t('Bill date'))}: ${dmy(b.billDate)}</div>
    <h2>${esc(t('Bill to'))}</h2><div><b>${esc(b.customerName)}</b><br>${esc(b.customer?.address || '')}<br>${esc(b.customerPhone)}</div>
    <table><thead><tr><th>#</th><th>${esc(t('Design'))}</th><th>${esc(t('Item'))}</th><th class="r">${esc(t('Qty'))}</th><th class="r">${esc(t('Rate'))}</th><th class="r">GST</th><th class="r">${esc(t('Amount'))}</th></tr></thead><tbody>${lines}</tbody></table>
    <table style="width:auto;margin-left:auto"><tbody>
      <tr><td>${esc(t('Taxable value'))}</td><td class="r">${rs(b.tax.taxablePaise)}</td></tr><tr><td>CGST</td><td class="r">${rs(b.tax.cgstPaise)}</td></tr><tr><td>SGST</td><td class="r">${rs(b.tax.sgstPaise)}</td></tr>
      <tr class="tot"><td>${esc(t('Grand total'))}</td><td class="r">${rs(b.totalPaise)}</td></tr><tr><td>${esc(t('Paid'))}</td><td class="r">${rs(b.paidPaise)}</td></tr><tr><td>${esc(t('Balance due'))}</td><td class="r">${rs(b.duePaise)}</td></tr>
    </tbody></table>
    <p class="note">${esc(t('Prices include GST. The GST split is estimated from each design\'s GST rate (CGST + SGST assumed).'))}</p>`);
}
