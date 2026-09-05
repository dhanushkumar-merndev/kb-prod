import { describe, expect, it } from "vitest";
import {
  csvCell,
  detailRows,
  payrollBreakdown,
  payrollCsv,
  payrollSummary,
} from "@/features/payroll/presentation";
import { payslipHtml } from "@/features/payroll/exports";
import { components, employee, period } from "./fixtures";

describe("payroll presentation and downloads", () => {
  it("keeps contributions out of take-home pay and reimbursements out of gross salary", () => {
    expect(payrollBreakdown(employee, components)).toMatchObject({
      gross: 3100000,
      deductions: 300000,
      employer: 210000,
      net: 2820000,
      companyCost: 3330000,
      allowances: 300000,
      incentives: 50000,
      otherDeductions: 70000,
    });
    expect(detailRows(employee, components).find(([name]) => name === "Net Salary")?.[1]).toBe(
      2820000,
    );
  });
  it("excludes reversed payments from summary totals but preserves their export record", () => {
    const reversed = { ...employee, id: "reversed", status: "reversed" as const };
    expect(payrollSummary([employee, reversed], components).employees).toBe(1);
    expect(payrollCsv([employee, reversed], components)).toContain('"reversed"');
    expect(payrollSummary([], [])).toEqual({
      employees: 0,
      gross: 0,
      deductions: 0,
      net: 0,
      employer: 0,
      companyCost: 0,
    });
  });
  it("escapes CSV formulas, delimiters and quoted names", () => {
    expect(csvCell('=HYPERLINK("url")')).toBe('"\'=HYPERLINK(""url"")"');
    expect(csvCell("  +1")).toBe('"\'  +1"');
    expect(
      payrollCsv([{ ...employee, subjectName: 'Anita, "Chef"', payableDays: null }], components),
    ).toContain('"Anita, ""Chef""","Chef","Unavailable"');
  });
  it("generates printable Unicode payslips with safe HTML and no draft or reversed slips", () => {
    const html = payslipHtml(
      period,
      [{ ...employee, subjectName: "अनिता <script>alert(1)</script>" }],
      components,
    );
    expect(html).toContain("अनिता &lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("28,200.00");
    expect(() => payslipHtml({ ...period, status: "draft" }, [employee], components)).toThrow(
      "Approve payroll",
    );
    expect(() => payslipHtml(period, [{ ...employee, status: "reversed" }], components)).toThrow(
      "Approve payroll",
    );
  });
});
