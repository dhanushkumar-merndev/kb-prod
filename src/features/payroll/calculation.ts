export interface PayrollAmountsInPaise {
  base: number;
  attendance: number;
  bookings: number;
  overtime: number;
  reimbursements: number;
  allowances: number;
  deductions: number;
  advances: number;
}

export function calculatePayrollNetPaise(amounts: PayrollAmountsInPaise): number {
  const values = Object.values(amounts);

  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("Payroll amounts must be non-negative integer paise.");
  }

  const earnings =
    amounts.base +
    amounts.attendance +
    amounts.bookings +
    amounts.overtime +
    amounts.reimbursements +
    amounts.allowances;
  const reductions = amounts.deductions + amounts.advances;
  const net = earnings - reductions;

  if (net < 0) {
    throw new Error("Payroll reductions cannot exceed earnings.");
  }

  return net;
}
