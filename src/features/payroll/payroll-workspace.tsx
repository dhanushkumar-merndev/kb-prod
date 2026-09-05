"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useActionState, useMemo, useState, useRef, useEffect, startTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { detailRows, payrollBreakdown, payrollSummary, payrollCsv } from "./presentation";
import { downloadFile, payslipHtml } from "./exports";
import { generatePayrollSchema } from "./schemas";
import { SalarySetup } from "./salary-setup";

import {
  ActionFeedback,
  FieldError,
  SubmitButton,
  formatDate,
  formatDateTime,
  formatMoney,
} from "@/features/core-crud/components/shared";
import { INITIAL_CRUD_ACTION_STATE } from "@/features/core-crud/types";

import {
  adjustPayrollEntryAction,
  approvePayrollAction,
  generatePayrollAction,
  lockPayrollAction,
  markPayrollPaidAction,
  preparePayrollAction,
  reversePayrollEntryAction,
  reviewPayrollAction,
} from "./actions";
import styles from "./payroll.module.css";
import {
  PAYROLL_ENTRY_STATUS_LABELS,
  PAYROLL_PERIOD_STATUS_LABELS,
  type PayrollComponentRecord,
  type PayrollEntryRecord,
  type PayrollPeriodRecord,
  type PayrollWorkspaceData,
} from "./types";

const PAYROLL_RECORDS_PER_PAGE = 10;

function currentMonthRange(): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    start: `${values.year}-${values.month}-01`,
    end: `${values.year}-${values.month}-${String(lastDay).padStart(2, "0")}`,
  };
}

function GeneratePayrollForm({ franchises }: { franchises: PayrollWorkspaceData["franchises"] }) {
  const [state, action, pending] = useActionState(generatePayrollAction, INITIAL_CRUD_ACTION_STATE);
  const range = currentMonthRange();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(generatePayrollSchema),
    defaultValues: {
      franchiseId: franchises.length === 1 ? franchises[0]!.id : "",
      payrollMonth: range.start.slice(0, 7),
      periodStart: range.start,
      periodEnd: range.end,
    },
  });
  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <h2>Generate Payroll</h2>
          <p>
            Monthly staff are paid for the full calendar month, less days marked absent and
            unpaid approved leave. Daily, hourly and temporary workers are paid from approved
            attendance. Salary structure, incentives, deductions and approved expenses are applied
            automatically.
          </p>
        </div>
      </div>
      <form
        className={styles.generateForm}
        onSubmit={handleSubmit((values) => {
          if (pending) return;
          const form = new FormData();
          Object.entries(values).forEach(([key, value]) => {
            if (value) form.set(key, value);
          });
          startTransition(() => action(form));
        })}
      >
        {franchises.length > 1 ? (
          <label>
            Franchise
            <select {...register("franchiseId")} required>
              <option value="">Select franchise</option>
              {franchises.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <FieldError field="franchiseId" state={state} />
          </label>
        ) : (
          <input type="hidden" {...register("franchiseId")} />
        )}
        <label>
          Payroll Month
          <input
            type="month"
            {...register("payrollMonth", {
              onChange: (event) => {
                const month = event.target.value as string;
                if (!/^\d{4}-\d{2}$/.test(month)) return;
                const [year, number] = month.split("-").map(Number);
                const lastDay = new Date(Date.UTC(year!, number!, 0)).getUTCDate();
                setValue("periodStart", `${month}-01`);
                setValue("periodEnd", `${month}-${lastDay}`);
              },
            })}
            required
          />
          {errors.payrollMonth ? <span role="alert">{errors.payrollMonth.message}</span> : null}
          <FieldError field="payrollMonth" state={state} />
        </label>
        <label>
          Start Date
          <input type="date" {...register("periodStart")} required />
          {errors.periodStart ? <span role="alert">{errors.periodStart.message}</span> : null}
          <FieldError field="periodStart" state={state} />
        </label>
        <label>
          End Date
          <input type="date" {...register("periodEnd")} required />
          {errors.periodEnd ? <span role="alert">{errors.periodEnd.message}</span> : null}
          <FieldError field="periodEnd" state={state} />
        </label>
        <button
          className={styles.actionButton}
          type="submit"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? "Calculating…" : "Generate Payroll Draft"}
        </button>
      </form>
      <ActionFeedback state={state} />
    </section>
  );
}

function PeriodTransition({
  period,
  viewerRole,
}: {
  period: PayrollPeriodRecord;
  viewerRole: PayrollWorkspaceData["viewerRole"];
}) {
  const [prepareState, prepareAction] = useActionState(
    preparePayrollAction,
    INITIAL_CRUD_ACTION_STATE,
  );
  const [reviewState, reviewAction] = useActionState(
    reviewPayrollAction,
    INITIAL_CRUD_ACTION_STATE,
  );
  const [approveState, approveAction] = useActionState(
    approvePayrollAction,
    INITIAL_CRUD_ACTION_STATE,
  );
  const [paidState, paidAction] = useActionState(markPayrollPaidAction, INITIAL_CRUD_ACTION_STATE);
  const [lockState, lockAction] = useActionState(lockPayrollAction, INITIAL_CRUD_ACTION_STATE);
  const hiddenId = <input name="payrollPeriodId" type="hidden" value={period.id} />;

  if (period.status === "draft" && ["director", "hr"].includes(viewerRole)) {
    return (
      <>
        <form action={prepareAction} className={styles.inlineAction}>
          {hiddenId}
          <SubmitButton pendingLabel="Submitting…">Review Payroll</SubmitButton>
        </form>
        <ActionFeedback state={prepareState} />
      </>
    );
  }

  if (period.status === "prepared" && ["director", "franchise", "manager"].includes(viewerRole)) {
    return (
      <>
        <form action={reviewAction} className={styles.inlineAction}>
          {hiddenId}
          <SubmitButton pendingLabel="Reviewing…">Complete Review</SubmitButton>
        </form>
        <ActionFeedback state={reviewState} />
      </>
    );
  }

  if (period.status === "reviewed" && viewerRole === "director") {
    return (
      <>
        <form action={approveAction} className={styles.inlineAction}>
          {hiddenId}
          <SubmitButton pendingLabel="Approving…">Approve Payroll</SubmitButton>
        </form>
        <ActionFeedback state={approveState} />
      </>
    );
  }

  if (period.status === "approved" && viewerRole === "director") {
    return (
      <>
        <form action={paidAction} className={styles.paymentForm}>
          {hiddenId}
          <label>
            Payment reference
            <input
              autoComplete="off"
              maxLength={160}
              name="paymentReference"
              placeholder="Bank transfer / UTR reference"
              required
            />
            <FieldError field="paymentReference" state={paidState} />
          </label>
          <SubmitButton pendingLabel="Recording…">Mark paid</SubmitButton>
        </form>
        <ActionFeedback state={paidState} />
      </>
    );
  }

  if (period.status === "paid" && viewerRole === "director") {
    return (
      <>
        <form action={lockAction} className={styles.confirmAction}>
          {hiddenId}
          <label className={styles.confirmLabel}>
            <input name="confirmation" required type="checkbox" value="yes" />I confirm this paid
            period is final and should be locked permanently.
          </label>
          <SubmitButton pendingLabel="Locking…" tone="danger">
            Lock paid period
          </SubmitButton>
        </form>
        <ActionFeedback state={lockState} />
      </>
    );
  }

  const message =
    period.status === "prepared"
      ? "Awaiting Manager review."
      : period.status === "reviewed"
        ? "Awaiting Director approval."
        : period.status === "approved"
          ? "Awaiting payment."
          : period.status === "paid"
            ? "Paid and awaiting final lock."
            : period.status === "locked"
              ? "This period is permanently locked."
              : null;

  return message ? <p className={styles.workflowNote}>{message}</p> : null;
}

function ComponentBreakdown({ components }: { components: PayrollComponentRecord[] }) {
  return (
    <details className={styles.details}>
      <summary>Component breakdown ({components.length})</summary>
      {components.length === 0 ? (
        <p className={styles.emptyInline}>No payable components in this entry.</p>
      ) : (
        <ul className={styles.componentList}>
          {components.map((component) => (
            <li key={component.id}>
              <div>
                <strong>{component.componentType.replaceAll("_", " ")}</strong>
                <span>{component.description}</span>
              </div>
              <span className={Number(component.amount) < 0 ? styles.negativeAmount : undefined}>
                {formatMoney(component.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

function DraftCorrectionForm({ entry }: { entry: PayrollEntryRecord }) {
  const [state, action] = useActionState(adjustPayrollEntryAction, INITIAL_CRUD_ACTION_STATE);

  return (
    <>
      <details className={styles.details}>
        <summary>Correct allowances or deductions</summary>
        <form action={action} className={styles.adjustmentForm}>
          <input name="payrollEntryId" type="hidden" value={entry.id} />
          <label>
            Allowances
            <input
              defaultValue={entry.allowances}
              min="0"
              name="allowances"
              required
              step="0.01"
              type="number"
            />
            <FieldError field="allowances" state={state} />
          </label>
          <label>
            Deductions
            <input
              defaultValue={entry.deductions}
              min="0"
              name="deductions"
              required
              step="0.01"
              type="number"
            />
            <FieldError field="deductions" state={state} />
          </label>
          <label>
            Advances
            <input
              defaultValue={entry.advances}
              min="0"
              name="advances"
              required
              step="0.01"
              type="number"
            />
            <FieldError field="advances" state={state} />
          </label>
          <label className={styles.wide}>
            Correction reason
            <input
              maxLength={1000}
              name="reason"
              placeholder="Required for the audit trail"
              required
            />
            <FieldError field="reason" state={state} />
          </label>
          <div className={styles.wide}>
            <SubmitButton pendingLabel="Saving…">Save correction</SubmitButton>
          </div>
        </form>
      </details>
      <ActionFeedback state={state} />
    </>
  );
}

function ReverseEntryForm({ entry }: { entry: PayrollEntryRecord }) {
  const [state, action] = useActionState(reversePayrollEntryAction, INITIAL_CRUD_ACTION_STATE);

  return (
    <>
      <details className={styles.dangerDetails}>
        <summary>Reverse paid entry</summary>
        <form action={action} className={styles.reverseForm}>
          <input name="payrollEntryId" type="hidden" value={entry.id} />
          <label>
            Reversal reason
            <input maxLength={1000} name="reason" placeholder="Required audit reason" required />
            <FieldError field="reason" state={state} />
          </label>
          <label className={styles.confirmLabel}>
            <input name="confirmation" required type="checkbox" value="yes" />I understand this
            creates a permanent audited reversal.
          </label>
          <SubmitButton pendingLabel="Reversing…" tone="danger">
            Confirm reversal
          </SubmitButton>
        </form>
      </details>
      <ActionFeedback state={state} />
    </>
  );
}

function EntryCard({
  entry,
  components,
  canAdjust,
  canReverse,
}: {
  entry: PayrollEntryRecord;
  components: PayrollComponentRecord[];
  canAdjust: boolean;
  canReverse: boolean;
}) {
  return (
    <article className={styles.entry}>
      <div className={styles.entryHeader}>
        <div>
          <strong>{entry.subjectName}</strong>
          <span>{entry.subjectLabel}</span>
        </div>
        <div className={styles.entryAmount}>
          <strong>{formatMoney(entry.netPayable)}</strong>
          <span className={styles.statusBadge} data-status={entry.status}>
            {PAYROLL_ENTRY_STATUS_LABELS[entry.status]}
          </span>
        </div>
      </div>
      <p className={styles.paymentMeta}>
        Attendance / Payable Days: {entry.attendanceDays ?? "Unavailable"} /{" "}
        {entry.payableDays ?? "Unavailable"}
      </p>
      <dl className={styles.amountGrid}>
        {detailRows(entry, components).map(([label, amount]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{formatMoney((amount / 100).toFixed(2))}</dd>
          </div>
        ))}
      </dl>
      {entry.paymentReference ? (
        <p className={styles.paymentMeta}>
          Payment reference: <strong>{entry.paymentReference}</strong>
          {entry.paidAt ? ` · ${formatDateTime(entry.paidAt)}` : ""}
        </p>
      ) : null}
      {entry.status === "reversed" ? (
        <p className={styles.reversal}>
          Reversed {formatDateTime(entry.reversedAt)} · {entry.reversalReason}
        </p>
      ) : null}
      <ComponentBreakdown components={components} />
      {canAdjust ? <DraftCorrectionForm entry={entry} /> : null}
      {canReverse ? <ReverseEntryForm entry={entry} /> : null}
    </article>
  );
}

function EmployeeTable({
  entries,
  components,
  onView,
}: {
  entries: PayrollEntryRecord[];
  components: PayrollComponentRecord[];
  onView: (entry: PayrollEntryRecord) => void;
}) {
  const columns: ColumnDef<PayrollEntryRecord>[] = [
    { accessorKey: "subjectName", header: "Employee Name" },
    { accessorKey: "subjectLabel", header: "Designation" },
    {
      accessorKey: "payableDays",
      header: "Payable Days",
      cell: ({ row }) => row.original.payableDays ?? "—",
    },
    ...(
      [
        ["Gross Salary", "gross"],
        ["Reimbursements", "reimbursement"],
        ["Deductions", "deductions"],
        ["Net Salary", "net"],
      ] as const
    ).map(([header, key]) => ({
      id: key,
      header,
      cell: ({ row }: { row: { original: PayrollEntryRecord } }) =>
        formatMoney(
          (
            payrollBreakdown(
              row.original,
              components.filter((c) => c.payrollEntryId === row.original.id),
            )[key] / 100
          ).toFixed(2),
        ),
    })),
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <span className={styles.statusBadge} data-status={row.original.status}>
          {PAYROLL_ENTRY_STATUS_LABELS[row.original.status]}
        </span>
      ),
    },
    {
      id: "view",
      header: "View Details",
      cell: ({ row }) => (
        <button
          type="button"
          className={styles.textButton}
          onClick={() => onView(row.original)}
          id={`payroll-entry-${row.original.id}`}
          aria-label={`View details for ${row.original.subjectName}`}
        >
          View Details
        </button>
      ),
    },
  ];
  // Totals mirror the Summary and History cards, which also exclude reversed entries,
  // so the three views reconcile even though reversed rows stay visible for audit.
  const totals = payrollSummary(entries, components);
  const reversedCount = entries.filter((entry) => entry.status === "reversed").length;
  // TanStack owns pagination state; rows still contain the full selected payroll for totals and export.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: entries,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });
  return (
    <>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id} scope="col">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} data-reversed={row.original.status === "reversed" || undefined}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {entries.length ? (
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  {reversedCount
                    ? `Period totals (excludes ${reversedCount} reversed)`
                    : "Period totals"}
                </th>
                {(["gross", "reimbursement", "deductions", "net"] as const).map((key) => (
                  <td key={key}>{formatMoney((totals[key] / 100).toFixed(2))}</td>
                ))}
                <td colSpan={2} />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {!entries.length ? (
        <p className={styles.empty}>No eligible employee records in this period.</p>
      ) : null}
      <Pagination
        page={table.getState().pagination.pageIndex + 1}
        pageCount={Math.max(1, table.getPageCount())}
        setPage={(page) => table.setPageIndex(page - 1)}
      />
    </>
  );
}

function EmployeeDetails({
  entry,
  period,
  data,
  onClose,
}: {
  entry: PayrollEntryRecord;
  period: PayrollPeriodRecord;
  data: PayrollWorkspaceData;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      requestAnimationFrame(() => document.getElementById(`payroll-entry-${entry.id}`)?.focus());
    };
  }, [entry.id]);
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      onClose={onClose}
      aria-labelledby="payroll-details-title"
    >
      <div className={styles.cardHeader}>
        <h2 id="payroll-details-title">Employee Details</h2>
        <button
          type="button"
          className={styles.textButton}
          onClick={() => dialog.current?.close()}
          aria-label="Close employee details"
        >
          Close
        </button>
      </div>
      <EntryCard
        entry={entry}
        components={data.components.filter((c) => c.payrollEntryId === entry.id)}
        canAdjust={period.status === "draft" && ["director", "hr"].includes(data.viewerRole)}
        canReverse={
          data.viewerRole === "director" &&
          entry.status === "paid" &&
          period.status !== "locked"
        }
      />
    </dialog>
  );
}

function AdminPayroll({ data }: { data: PayrollWorkspaceData }) {
  const canGenerate = ["director", "hr"].includes(data.viewerRole);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const period = data.periods.find((p) => p.id === selectedId) ?? data.periods[0];
  const [entryId, setEntryId] = useState<string | null>(null);
  const entry = data.entries.find((e) => e.id === entryId && e.payrollPeriodId === period?.id);
  const entries = data.entries.filter((e) => e.payrollPeriodId === period?.id);
  const totals = payrollSummary(entries, data.components);
  const [feedback, setFeedback] = useState(INITIAL_CRUD_ACTION_STATE);
  const [downloading, setDownloading] = useState(false);
  const downloadLock = useRef(false);
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(data.periods.length / PAYROLL_RECORDS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const activeStep = period
    ? { draft: 0, prepared: 1, reviewed: 1, approved: 2, paid: 3, locked: 3 }[period.status]
    : 0;
  async function download(kind: "csv" | "payslips") {
    if (!period || downloadLock.current) return;
    downloadLock.current = true;
    setDownloading(true);
    try {
      if (kind === "csv")
        downloadFile(
          payrollCsv(entries, data.components),
          `payroll-${period.periodStart}-${period.id.slice(0, 8)}.csv`,
          "text/csv;charset=utf-8",
        );
      else
        downloadFile(
          payslipHtml(period, entries, data.components),
          `payslips-${period.periodStart}-${period.id.slice(0, 8)}.html`,
          "text/html;charset=utf-8",
        );
      setFeedback({
        status: "success",
        mutationId: crypto.randomUUID(),
        message:
          kind === "csv"
            ? "Payroll exported."
            : "Payslips downloaded. Open the file to print or save as PDF.",
      });
    } catch {
      setFeedback({
        status: "error",
        mutationId: crypto.randomUUID(),
        message: "Download failed. Try again.",
      });
    } finally {
      downloadLock.current = false;
      setDownloading(false);
    }
  }
  return (
    <div className={styles.stack}>
      {canGenerate ? <GeneratePayrollForm franchises={data.franchises} /> : null}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Payroll Summary</h2>
            {period ? (
              <p>
                {formatDate(period.periodStart)} – {formatDate(period.periodEnd)}
                {data.franchises.length > 1
                  ? ` · ${data.franchises.find((f) => f.id === period.franchiseId)?.name ?? "Organization"}`
                  : ""}
              </p>
            ) : null}
          </div>
          {period ? (
            <span className={styles.statusBadge} data-status={period.status}>
              {PAYROLL_PERIOD_STATUS_LABELS[period.status]}
            </span>
          ) : null}
        </div>
        <div
          className={`${styles.summaryGrid} ${styles.payrollSummary}`}
          aria-label="Payroll summary"
        >
          <article>
            <span>Total Employees</span>
            <strong>{totals.employees}</strong>
          </article>
          {(
            [
              ["Gross Payroll", totals.gross],
              ["Reimbursements", totals.reimbursement],
              ["Total Deductions", totals.deductions],
              ["Net Payable", totals.net],
              ["Employer Contributions", totals.employer],
              ["Total Company Cost", totals.companyCost],
            ] as const
          ).map(([label, amount]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{formatMoney((amount / 100).toFixed(2))}</strong>
            </article>
          ))}
        </div>
        <ol className={styles.workflow} aria-label="Payroll workflow">
          {["Draft", "Review", "Approved", "Paid"].map((step, index) => (
            <li
              key={step}
              aria-current={period && index === activeStep ? "step" : undefined}
              data-complete={!!period && index <= activeStep}
            >
              {step}
            </li>
          ))}
        </ol>
        {period ? (
          <>
            <div className={styles.actions}>
              <PeriodTransition
                key={`${period.id}-${period.status}`}
                period={period}
                viewerRole={data.viewerRole}
              />
              <button
                type="button"
                className={styles.outlineButton}
                disabled={
                  downloading ||
                  !entries.some((e) => ["approved", "paid"].includes(e.status)) ||
                  !["approved", "paid", "locked"].includes(period.status)
                }
                onClick={() => void download("payslips")}
              >
                Generate Payslips
              </button>
              <button
                type="button"
                className={styles.outlineButton}
                disabled={downloading || !entries.length}
                onClick={() => void download("csv")}
              >
                Export Payroll
              </button>
            </div>
            {period.paymentReference ? (
              <p className={styles.paymentMeta}>Payment reference: {period.paymentReference}</p>
            ) : null}
          </>
        ) : (
          <p className={styles.empty}>Generate a payroll draft to get started.</p>
        )}
      </section>
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2>Employee Payroll</h2>
        </div>
        <EmployeeTable
          key={period?.id ?? "empty"}
          entries={entries}
          components={data.components}
          onView={(e) => setEntryId(e.id)}
        />
      </section>
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2>Payroll History</h2>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                {["Payroll Period", "Employees", "Total Payroll", "Status", "View"].map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.periods
                .slice(
                  (safePage - 1) * PAYROLL_RECORDS_PER_PAGE,
                  safePage * PAYROLL_RECORDS_PER_PAGE,
                )
                .map((p) => {
                  const summary = payrollSummary(
                    data.entries.filter((e) => e.payrollPeriodId === p.id),
                    data.components,
                  );
                  return (
                    <tr key={p.id} aria-selected={p.id === period?.id}>
                      <td>
                        {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                        {data.franchises.length > 1 ? (
                          <small className={styles.franchiseName}>
                            {data.franchises.find((f) => f.id === p.franchiseId)?.name ??
                              "Organization"}
                          </small>
                        ) : null}
                      </td>
                      <td>{summary.employees}</td>
                      <td>{formatMoney((summary.net / 100).toFixed(2))}</td>
                      <td>
                        <span className={styles.statusBadge} data-status={p.status}>
                          {PAYROLL_PERIOD_STATUS_LABELS[p.status]}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={styles.textButton}
                          onClick={() => {
                            setSelectedId(p.id);
                            setEntryId(null);
                          }}
                          aria-label={`View payroll ${p.periodStart} to ${p.periodEnd}`}
                        >
                          {p.id === period?.id ? "Viewing" : "View"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {!data.periods.length ? <p className={styles.empty}>No payroll history yet.</p> : null}
        <Pagination page={safePage} pageCount={pageCount} setPage={setPage} />
      </section>
      {canGenerate ? <SalarySetup data={data} /> : null}
      {entry && period ? (
        <EmployeeDetails
          entry={entry}
          period={period}
          data={data}
          onClose={() => setEntryId(null)}
        />
      ) : null}
      <ActionFeedback state={feedback} />
    </div>
  );
}

function EarningsDashboard({ data }: { data: PayrollWorkspaceData }) {
  const summary = data.earningsSummary;
  const periodById = useMemo(
    () => new Map(data.periods.map((period) => [period.id, period])),
    [data.periods],
  );
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(data.entries.length / PAYROLL_RECORDS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const visibleEntries = data.entries.slice(
    (safePage - 1) * PAYROLL_RECORDS_PER_PAGE,
    safePage * PAYROLL_RECORDS_PER_PAGE,
  );

  return (
    <div className={styles.stack}>
      <section className={styles.summaryGrid} aria-label="Earnings summary">
        <article>
          <span>Current unpaid</span>
          <strong>{formatMoney(summary?.currentUnpaid ?? "0")}</strong>
        </article>
        <article>
          <span>Paid this month</span>
          <strong>{formatMoney(summary?.paidThisMonth ?? "0")}</strong>
        </article>
        <article>
          <span>Lifetime paid</span>
          <strong>{formatMoney(summary?.lifetimePaid ?? "0")}</strong>
        </article>
        <article>
          <span>Last payment</span>
          <strong>{formatMoney(summary?.lastPaymentAmount ?? "0")}</strong>
          <small>{formatDateTime(summary?.lastPaymentAt ?? null)}</small>
        </article>
      </section>
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <span className={styles.eyebrow}>Your permanent record</span>
            <h2>Payment history</h2>
            <p>Paid balances remain available after each period is locked.</p>
          </div>
        </div>
        {data.entries.length === 0 ? (
          <div className={styles.empty}>
            <strong>No earnings records yet</strong>
            <p>Approved work will appear after HR generates a payroll period.</p>
          </div>
        ) : (
          <div className={styles.entryList}>
            {visibleEntries.map((entry) => {
              const period = periodById.get(entry.payrollPeriodId);

              return (
                <div key={entry.id}>
                  {period ? (
                    <p className={styles.workerPeriod}>
                      {formatDate(period.periodStart)} – {formatDate(period.periodEnd)}
                    </p>
                  ) : null}
                  <EntryCard
                    canAdjust={false}
                    canReverse={false}
                    components={data.components.filter(
                      (component) => component.payrollEntryId === entry.id,
                    )}
                    entry={entry}
                  />
                </div>
              );
            })}
          </div>
        )}
        <Pagination page={safePage} pageCount={pageCount} setPage={setPage} />
      </section>
    </div>
  );
}

function Pagination({
  page,
  pageCount,
  setPage,
}: {
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
}) {
  return (
    <div className={styles.pagination}>
      <span>
        Page {page} of {pageCount}
      </span>
      <div>
        <button disabled={page <= 1} onClick={() => setPage(page - 1)} type="button">
          <ChevronLeft aria-hidden="true" size={16} />
          Previous
        </button>
        <button disabled={page >= pageCount} onClick={() => setPage(page + 1)} type="button">
          Next
          <ChevronRight aria-hidden="true" size={16} />
        </button>
      </div>
    </div>
  );
}

export function PayrollWorkspace({ data }: { data: PayrollWorkspaceData }) {
  return ["chef", "part_time_chef"].includes(data.viewerRole) ? (
    <EarningsDashboard data={data} />
  ) : (
    <AdminPayroll data={data} />
  );
}
