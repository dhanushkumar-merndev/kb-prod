"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

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

function amountTotal(entries: PayrollEntryRecord[]): string {
  return entries.reduce((total, entry) => total + Number(entry.netPayable), 0).toFixed(2);
}

function GeneratePayrollForm() {
  const [state, action] = useActionState(generatePayrollAction, INITIAL_CRUD_ACTION_STATE);
  const range = currentMonthRange();

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <span className={styles.eyebrow}>New pay cycle</span>
          <h2>Generate payroll draft</h2>
          <p>
            Uses approved attendance, completed assigned jobs, approved expenses and stored pay
            structures.
          </p>
        </div>
      </div>
      <form action={action} className={styles.generateForm}>
        <label>
          Period start
          <input defaultValue={range.start} name="periodStart" required type="date" />
          <FieldError field="periodStart" state={state} />
        </label>
        <label>
          Period end
          <input defaultValue={range.end} name="periodEnd" required type="date" />
          <FieldError field="periodEnd" state={state} />
        </label>
        <div className={styles.formAction}>
          <SubmitButton pendingLabel="Calculating…">Generate draft</SubmitButton>
        </div>
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
          <SubmitButton pendingLabel="Submitting…">Submit for review</SubmitButton>
        </form>
        <ActionFeedback state={prepareState} />
      </>
    );
  }

  if (period.status === "prepared" && ["director", "manager"].includes(viewerRole)) {
    return (
      <>
        <form action={reviewAction} className={styles.inlineAction}>
          {hiddenId}
          <SubmitButton pendingLabel="Reviewing…">Complete review</SubmitButton>
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
          <SubmitButton pendingLabel="Approving…">Approve payroll</SubmitButton>
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
      <dl className={styles.amountGrid}>
        <div>
          <dt>Base</dt>
          <dd>{formatMoney(entry.baseAmount)}</dd>
        </div>
        <div>
          <dt>Attendance</dt>
          <dd>{formatMoney(entry.attendanceAmount)}</dd>
        </div>
        <div>
          <dt>Bookings</dt>
          <dd>{formatMoney(entry.bookingEarnings)}</dd>
        </div>
        <div>
          <dt>Overtime</dt>
          <dd>{formatMoney(entry.overtimeAmount)}</dd>
        </div>
        <div>
          <dt>Reimbursements</dt>
          <dd>{formatMoney(entry.expenseReimbursement)}</dd>
        </div>
        <div>
          <dt>Allowances</dt>
          <dd>{formatMoney(entry.allowances)}</dd>
        </div>
        <div>
          <dt>Deductions</dt>
          <dd>{formatMoney(entry.deductions)}</dd>
        </div>
        <div>
          <dt>Advances</dt>
          <dd>{formatMoney(entry.advances)}</dd>
        </div>
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

function AdminPayroll({ data }: { data: PayrollWorkspaceData }) {
  const canGenerate = ["director", "hr"].includes(data.viewerRole);
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(data.periods.length / PAYROLL_RECORDS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const visiblePeriods = data.periods.slice(
    (safePage - 1) * PAYROLL_RECORDS_PER_PAGE,
    safePage * PAYROLL_RECORDS_PER_PAGE,
  );

  return (
    <div className={styles.stack}>
      {canGenerate ? <GeneratePayrollForm /> : null}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <span className={styles.eyebrow}>Permanent ledger</span>
            <h2>Payroll periods</h2>
            <p>Every lifecycle decision and correction is retained in the audit trail.</p>
          </div>
          <span className={styles.count}>{data.periods.length}</span>
        </div>
        {data.periods.length === 0 ? (
          <div className={styles.empty}>
            <strong>No payroll periods yet</strong>
            <p>Generate the first period after attendance and expenses are approved.</p>
          </div>
        ) : (
          <ul className={styles.periodList}>
            {visiblePeriods.map((period) => {
              const entries = data.entries.filter((entry) => entry.payrollPeriodId === period.id);

              return (
                <li className={styles.period} key={period.id}>
                  <div className={styles.periodHeader}>
                    <div>
                      <span className={styles.periodDates}>
                        {formatDate(period.periodStart)} – {formatDate(period.periodEnd)}
                      </span>
                      <strong>{formatMoney(amountTotal(entries))}</strong>
                      <small>
                        {entries.length} {entries.length === 1 ? "entry" : "entries"}
                      </small>
                    </div>
                    <span className={styles.statusBadge} data-status={period.status}>
                      {PAYROLL_PERIOD_STATUS_LABELS[period.status]}
                    </span>
                  </div>
                  {period.paymentReference ? (
                    <p className={styles.paymentMeta}>
                      Payment reference: <strong>{period.paymentReference}</strong>
                      {period.paidAt ? ` · ${formatDateTime(period.paidAt)}` : ""}
                    </p>
                  ) : null}
                  <PeriodTransition period={period} viewerRole={data.viewerRole} />
                  {entries.length === 0 ? (
                    <p className={styles.emptyInline}>No eligible workforce records.</p>
                  ) : (
                    <div className={styles.entryList}>
                      {entries.map((entry) => (
                        <EntryCard
                          canAdjust={
                            period.status === "draft" &&
                            ["director", "hr"].includes(data.viewerRole)
                          }
                          canReverse={data.viewerRole === "director" && entry.status === "paid"}
                          components={data.components.filter(
                            (component) => component.payrollEntryId === entry.id,
                          )}
                          entry={entry}
                          key={entry.id}
                        />
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <Pagination page={safePage} pageCount={pageCount} setPage={setPage} />
      </section>
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
