import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PayrollWorkspace } from "@/features/payroll/payroll-workspace";
import { workspace, employee, period } from "./fixtures";

vi.mock("@/features/payroll/actions", () => {
  const action = vi.fn(async () => ({ status: "success", message: "Saved", mutationId: "test" }));
  return Object.fromEntries(
    [
      "generatePayrollAction",
      "adjustPayrollEntryAction",
      "approvePayrollAction",
      "lockPayrollAction",
      "markPayrollPaidAction",
      "preparePayrollAction",
      "reversePayrollEntryAction",
      "reviewPayrollAction",
      "saveSalaryStructureAction",
    ].map((key) => [key, action]),
  );
});
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(cleanup);

describe("simple payroll workspace", () => {
  it("shows the summary and compact table, opening employee details only on demand", () => {
    render(<PayrollWorkspace data={workspace} />);
    expect(screen.getByRole("heading", { name: "Payroll Summary" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Payable Days" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View details for Anita" }));
    const dialog = screen.getByRole("dialog");
    for (const label of [
      "Basic Salary",
      "HRA / Allowances",
      "PF",
      "ESIC",
      "Professional Tax",
      "TDS",
      "Net Salary",
    ])
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close employee details" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("changes the date range when a payroll month is selected", () => {
    render(<PayrollWorkspace data={workspace} />);
    fireEvent.change(screen.getByLabelText("Payroll Month"), { target: { value: "2028-02" } });
    expect(screen.getByLabelText("Start Date")).toHaveValue("2028-02-01");
    expect(screen.getByLabelText("End Date")).toHaveValue("2028-02-29");
  });
  it("switches periods through history and prevents draft payslips", () => {
    const old = {
      ...period,
      id: "old",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      status: "draft" as const,
    };
    render(
      <PayrollWorkspace
        data={{
          ...workspace,
          periods: [period, old],
          entries: [
            employee,
            {
              ...employee,
              id: "old-entry",
              payrollPeriodId: old.id,
              subjectName: "Bala",
              status: "draft",
            },
          ],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "View payroll 2026-08-01 to 2026-08-31" }));
    expect(screen.getByRole("button", { name: "View details for Bala" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "View details for Anita" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate Payslips" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Review Payroll" })).toBeInTheDocument();
  });
  it("does not expose generation or salary setup to Managers", () => {
    render(<PayrollWorkspace data={{ ...workspace, viewerRole: "manager" }} />);
    expect(
      screen.queryByRole("button", { name: "Generate Payroll Draft" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Salary setup")).not.toBeInTheDocument();
  });
});
