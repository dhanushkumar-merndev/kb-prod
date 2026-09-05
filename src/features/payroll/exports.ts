import { detailRows } from "./presentation";
import type { PayrollComponentRecord, PayrollEntryRecord, PayrollPeriodRecord } from "./types";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
  );
}

export function payslipHtml(
  period: PayrollPeriodRecord,
  entries: PayrollEntryRecord[],
  components: PayrollComponentRecord[],
): string {
  const eligible = entries.filter((entry) => ["approved", "paid"].includes(entry.status));
  if (!["approved", "paid", "locked"].includes(period.status) || !eligible.length) {
    throw new Error("Approve payroll before generating payslips.");
  }
  const money = (amount: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount / 100);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Khana Banao Payslips</title>
<style>body{font:14px system-ui;color:#0b2545;background:#f5f7fa;margin:24px}article{max-width:720px;background:white;padding:32px;margin:0 auto 24px;border:1px solid #e1e6ef}h1{color:#0b2545}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #e1e6ef;text-align:left}td:last-child{text-align:right}p{line-height:1.6}.hint{text-align:center}@media print{body{margin:0;background:white}.hint{display:none}article{border:0;break-after:page;margin:0}article:last-child{break-after:auto}}</style></head><body>
<p class="hint">Use your browser’s Print command to print or save these payslips as PDF.</p>
${eligible
  .map(
    (entry) =>
      `<article><h1>Khana Banao · Payslip</h1><h2>${escapeHtml(entry.subjectName)}</h2><p>${escapeHtml(entry.subjectLabel)}<br>Period: ${escapeHtml(period.periodStart)} – ${escapeHtml(period.periodEnd)}<br>Status: ${escapeHtml(entry.status)}<br>Attendance / Payable Days: ${entry.attendanceDays ?? "Unavailable"} / ${entry.payableDays ?? "Unavailable"}</p><table><tbody>${detailRows(
        entry,
        components.filter((c) => c.payrollEntryId === entry.id),
      )
        .map(([label, value]) => `<tr><th scope="row">${label}</th><td>${money(value)}</td></tr>`)
        .join(
          "",
        )}</tbody></table><p>Payment reference: ${escapeHtml(entry.paymentReference ?? "Awaiting payment")}<br>Payslip ID: ${escapeHtml(entry.id)}</p></article>`,
  )
  .join("")}</body></html>`;
}

export function downloadFile(content: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
