import type { PayrollComponentRecord, PayrollEntryRecord } from "./types";

export function paise(value: string): number {
  const result = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(result)) throw new Error("Invalid payroll amount.");
  return result;
}

export function payrollBreakdown(entry: PayrollEntryRecord, components: PayrollComponentRecord[]) {
  const sum = (...types: string[]) =>
    components
      .filter((c) => types.includes(c.componentType))
      .reduce((total, c) => total + paise(c.amount), 0);
  const incentives = sum("incentive");
  const pf = sum("pf"),
    esic = sum("esic"),
    professionalTax = sum("professional_tax"),
    tds = sum("tds");
  const gross =
    paise(entry.baseAmount) +
    paise(entry.attendanceAmount) +
    paise(entry.bookingEarnings) +
    paise(entry.overtimeAmount) +
    paise(entry.allowances);
  const deductions = paise(entry.deductions) + paise(entry.advances);
  const employer = sum("employer_pf", "employer_esic");
  return {
    gross,
    deductions,
    employer,
    net: paise(entry.netPayable),
    companyCost: gross + paise(entry.expenseReimbursement) + employer,
    incentives,
    pf,
    esic,
    professionalTax,
    tds,
    otherDeductions: deductions - pf - esic - professionalTax - tds,
    allowances: paise(entry.allowances) - incentives,
  };
}

export function payrollSummary(
  entries: PayrollEntryRecord[],
  components: PayrollComponentRecord[],
) {
  return entries
    .filter((entry) => entry.status !== "reversed")
    .reduce(
      (total, entry) => {
        const amounts = payrollBreakdown(
          entry,
          components.filter((c) => c.payrollEntryId === entry.id),
        );
        return {
          employees: total.employees + 1,
          gross: total.gross + amounts.gross,
          deductions: total.deductions + amounts.deductions,
          net: total.net + amounts.net,
          employer: total.employer + amounts.employer,
          companyCost: total.companyCost + amounts.companyCost,
        };
      },
      { employees: 0, gross: 0, deductions: 0, net: 0, employer: 0, companyCost: 0 },
    );
}

export function detailRows(
  entry: PayrollEntryRecord,
  components: PayrollComponentRecord[],
): [string, number][] {
  const b = payrollBreakdown(entry, components);
  return [
    ["Basic Salary", paise(entry.baseAmount)],
    ["Attendance Earnings", paise(entry.attendanceAmount)],
    ["Booking Earnings", paise(entry.bookingEarnings)],
    ["Overtime", paise(entry.overtimeAmount)],
    ["HRA / Allowances", b.allowances],
    ["Incentives", b.incentives],
    ["Reimbursements", paise(entry.expenseReimbursement)],
    ["PF", b.pf],
    ["ESIC", b.esic],
    ["Professional Tax", b.professionalTax],
    ["TDS", b.tds],
    ["Other Deductions", b.otherDeductions],
    ["Gross Salary", b.gross],
    ["Net Salary", b.net],
  ];
}

// Quoting alone does not prevent spreadsheet formulas in employee names.
export function csvCell(value: string): string {
  const safe = /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function payrollCsv(
  entries: PayrollEntryRecord[],
  components: PayrollComponentRecord[],
): string {
  const rows = [
    [
      "Employee Name",
      "Designation",
      "Payable Days",
      "Gross Salary",
      "Deductions",
      "Net Salary",
      "Status",
      "Employer Contributions",
      "Total Company Cost",
    ],
  ];
  for (const entry of entries) {
    const b = payrollBreakdown(
      entry,
      components.filter((c) => c.payrollEntryId === entry.id),
    );
    rows.push([
      entry.subjectName,
      entry.subjectLabel,
      entry.payableDays?.toString() ?? "Unavailable",
      (b.gross / 100).toFixed(2),
      (b.deductions / 100).toFixed(2),
      (b.net / 100).toFixed(2),
      entry.status,
      (b.employer / 100).toFixed(2),
      (b.companyCost / 100).toFixed(2),
    ]);
  }
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
