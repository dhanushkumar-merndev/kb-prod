"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import {
  ActionFeedback,
  EmptyState,
  SubmitButton,
  formatDate,
  formatMoney,
} from "@/features/core-crud/components/shared";
import { INITIAL_CRUD_ACTION_STATE } from "@/features/core-crud/types";
import { ROLE_LABELS, type Role } from "@/lib/constants/roles";

import { reviewExpenseClaimAction, reviewLeaveRequestAction } from "./actions";
import styles from "./reviews.module.css";
import type { ExpenseReviewRecord, LeaveReviewRecord } from "./types";

const REVIEW_RECORDS_PER_PAGE = 10;

function ExpenseDecision({
  expense,
  viewerRole,
}: {
  expense: ExpenseReviewRecord;
  viewerRole: Role;
}) {
  const [state, action] = useActionState(reviewExpenseClaimAction, INITIAL_CRUD_ACTION_STATE);
  const statuses =
    viewerRole === "hr"
      ? (["verified", "rejected"] as const)
      : viewerRole === "director" && expense.status === "approved"
        ? (["paid"] as const)
        : (["verified", "approved", "rejected"] as const);

  if (
    !["pending", "verified"].includes(expense.status) &&
    !(viewerRole === "director" && expense.status === "approved")
  ) {
    return null;
  }

  return (
    <>
      <form action={action} className={styles.decisionForm}>
        <input name="id" type="hidden" value={expense.id} />
        <input name="expectedUpdatedAt" type="hidden" value={expense.updatedAt} />
        <label>
          Decision
          <select defaultValue={statuses[0]} name="status">
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reason
          <input name="reason" placeholder="Required when rejecting" />
        </label>
        <SubmitButton pendingLabel="Saving decision…">Save decision</SubmitButton>
      </form>
      <ActionFeedback state={state} />
    </>
  );
}

function ExpenseCard({ expense, viewerRole }: { expense: ExpenseReviewRecord; viewerRole: Role }) {
  return (
    <li className={styles.card}>
      <div className={styles.cardTop}>
        <div>
          <h3>{expense.submitterName}</h3>
          <p>
            {ROLE_LABELS[expense.submitterRole]} · {expense.category}
          </p>
        </div>
        <span className={styles.badge}>{expense.status.replaceAll("_", " ")}</span>
      </div>
      <dl className={styles.meta}>
        <div>
          <dt>Amount</dt>
          <dd>{formatMoney(expense.amount)}</dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{formatDate(expense.createdAt)}</dd>
        </div>
        <div>
          <dt>Booking</dt>
          <dd>{expense.bookingId ?? "General"}</dd>
        </div>
      </dl>
      <p>{expense.reason}</p>
      <div className={styles.fileLinks}>
        {expense.attachments.map((attachment) => (
          <a href={attachment.signedUrl} key={attachment.id} rel="noreferrer" target="_blank">
            View {attachment.fileName}
          </a>
        ))}
      </div>
      {expense.rejectionReason ? (
        <p className={styles.rejected}>Rejection reason: {expense.rejectionReason}</p>
      ) : null}
      <ExpenseDecision expense={expense} viewerRole={viewerRole} />
    </li>
  );
}

export function ExpenseReviewWorkspace({
  records,
  viewerRole,
}: {
  records: ExpenseReviewRecord[];
  viewerRole: Role;
}) {
  const [status, setStatus] = useState("actionable");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return records.filter((record) => {
      const statusMatches =
        status === "all"
          ? true
          : status === "actionable"
            ? ["pending", "verified"].includes(record.status) ||
              (viewerRole === "director" && record.status === "approved")
            : record.status === status;
      const searchMatches =
        !needle ||
        [
          record.submitterName,
          record.submitterRole,
          record.category,
          record.reason,
          record.status,
          record.amount,
          record.bookingId,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(needle);

      return statusMatches && searchMatches;
    });
  }, [records, search, status, viewerRole]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / REVIEW_RECORDS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const visibleRecords = filtered.slice(
    (safePage - 1) * REVIEW_RECORDS_PER_PAGE,
    safePage * REVIEW_RECORDS_PER_PAGE,
  );

  return (
    <section className={styles.workspace}>
      <div className={styles.toolbar}>
        <label>
          Status
          <select
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            value={status}
          >
            <option value="actionable">Needs action</option>
            <option value="all">All records</option>
            <option value="pending">Pending</option>
            <option value="verified">Verified</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="paid">Paid</option>
          </select>
        </label>
        <label className={styles.searchControl}>
          Search
          <span>
            <Search aria-hidden="true" size={17} />
            <input
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Name, category, reason…"
              type="search"
              value={search}
            />
          </span>
        </label>
        <span>{filtered.length} claims</span>
      </div>
      {visibleRecords.length === 0 ? (
        <EmptyState title="No expense claims" message="No claims match the selected status." />
      ) : (
        <ul className={styles.list}>
          {visibleRecords.map((expense) => (
            <ExpenseCard expense={expense} key={expense.id} viewerRole={viewerRole} />
          ))}
        </ul>
      )}
      <div className={styles.pagination}>
        <span>
          Page {safePage} of {pageCount}
        </span>
        <div>
          <button disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} type="button">
            <ChevronLeft aria-hidden="true" size={16} />
            Previous
          </button>
          <button
            disabled={safePage >= pageCount}
            onClick={() => setPage(safePage + 1)}
            type="button"
          >
            Next
            <ChevronRight aria-hidden="true" size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}

function LeaveDecision({ request }: { request: LeaveReviewRecord }) {
  const [state, action] = useActionState(reviewLeaveRequestAction, INITIAL_CRUD_ACTION_STATE);

  if (request.status !== "pending") {
    return null;
  }

  return (
    <>
      <form action={action} className={styles.decisionForm}>
        <input name="id" type="hidden" value={request.id} />
        <input name="expectedUpdatedAt" type="hidden" value={request.updatedAt} />
        <label>
          Decision
          <select defaultValue="approved" name="status">
            <option value="approved">Approve</option>
            <option value="rejected">Reject</option>
          </select>
        </label>
        <label>
          Review note
          <input name="reviewNote" placeholder="Required when rejecting" />
        </label>
        <SubmitButton pendingLabel="Saving decision…">Save decision</SubmitButton>
      </form>
      <ActionFeedback state={state} />
    </>
  );
}

export function LeaveReviewWorkspace({ records }: { records: LeaveReviewRecord[] }) {
  const [status, setStatus] = useState("pending");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();

    return records.filter(
      (record) =>
        (status === "all" || record.status === status) &&
        (!needle ||
          [
            record.profileName,
            record.profileRole,
            record.reason,
            record.status,
            record.startDate,
            record.endDate,
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(needle)),
    );
  }, [records, search, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / REVIEW_RECORDS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const visibleRecords = filtered.slice(
    (safePage - 1) * REVIEW_RECORDS_PER_PAGE,
    safePage * REVIEW_RECORDS_PER_PAGE,
  );

  return (
    <section className={styles.workspace}>
      <div className={styles.toolbar}>
        <label>
          Status
          <select
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            value={status}
          >
            <option value="pending">Pending</option>
            <option value="all">All records</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className={styles.searchControl}>
          Search
          <span>
            <Search aria-hidden="true" size={17} />
            <input
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Employee, reason, date…"
              type="search"
              value={search}
            />
          </span>
        </label>
        <span>{filtered.length} requests</span>
      </div>
      {visibleRecords.length === 0 ? (
        <EmptyState title="No leave requests" message="No requests match the selected status." />
      ) : (
        <ul className={styles.list}>
          {visibleRecords.map((request) => (
            <li className={styles.card} key={request.id}>
              <div className={styles.cardTop}>
                <div>
                  <h3>{request.profileName}</h3>
                  <p>{ROLE_LABELS[request.profileRole]}</p>
                </div>
                <span className={styles.badge}>{request.status}</span>
              </div>
              <dl className={styles.meta}>
                <div>
                  <dt>From</dt>
                  <dd>{formatDate(request.startDate)}</dd>
                </div>
                <div>
                  <dt>To</dt>
                  <dd>{formatDate(request.endDate)}</dd>
                </div>
              </dl>
              <p>{request.reason}</p>
              {request.conflictMessages.length > 0 ? (
                <div className={styles.warning} role="alert">
                  <strong>Schedule conflicts</strong>
                  <ul>
                    {request.conflictMessages.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {request.reviewNote ? <p>Review note: {request.reviewNote}</p> : null}
              <LeaveDecision request={request} />
            </li>
          ))}
        </ul>
      )}
      <div className={styles.pagination}>
        <span>
          Page {safePage} of {pageCount}
        </span>
        <div>
          <button disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} type="button">
            <ChevronLeft aria-hidden="true" size={16} />
            Previous
          </button>
          <button
            disabled={safePage >= pageCount}
            onClick={() => setPage(safePage + 1)}
            type="button"
          >
            Next
            <ChevronRight aria-hidden="true" size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}
