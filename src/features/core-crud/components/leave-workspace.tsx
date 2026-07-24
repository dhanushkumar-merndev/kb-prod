"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import {
  cancelLeaveRequestAction,
  createLeaveRequestAction,
  updateLeaveRequestAction,
} from "../actions";
import styles from "../core-crud.module.css";
import {
  INITIAL_CRUD_ACTION_STATE,
  LEAVE_STATUS_LABELS,
  type LeaveRequestRecord,
  type OwnLeaveCrudData,
} from "../types";
import { ActionFeedback, EmptyState, FieldError, formatDate, SubmitButton } from "./shared";

const LEAVE_REQUESTS_PER_PAGE = 10;

function CreateLeaveForm() {
  const [state, action] = useActionState(createLeaveRequestAction, INITIAL_CRUD_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state.mutationId, state.status]);

  return (
    <form action={action} className={styles.formGrid} ref={formRef} noValidate>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="leave-start-date">
          Start date
        </label>
        <input
          className={styles.input}
          id="leave-start-date"
          name="startDate"
          type="date"
          required
        />
        <FieldError field="startDate" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="leave-end-date">
          End date
        </label>
        <input className={styles.input} id="leave-end-date" name="endDate" type="date" required />
        <FieldError field="endDate" state={state} />
      </div>
      <div className={styles.fieldWide}>
        <label className={styles.label} htmlFor="leave-reason">
          Reason
        </label>
        <textarea
          className={styles.textarea}
          id="leave-reason"
          name="reason"
          maxLength={2000}
          required
        />
        <FieldError field="reason" state={state} />
      </div>
      <div className={styles.actions}>
        <SubmitButton pendingLabel="Submitting request…">Request leave</SubmitButton>
      </div>
      <div className={styles.fieldWide}>
        <ActionFeedback state={state} />
      </div>
    </form>
  );
}

function UpdateLeaveForm({ request }: { request: LeaveRequestRecord }) {
  const [state, action] = useActionState(updateLeaveRequestAction, INITIAL_CRUD_ACTION_STATE);

  return (
    <form action={action} className={`${styles.formGrid} ${styles.detailsForm}`} noValidate>
      <input name="id" type="hidden" value={request.id} />
      <input name="expectedUpdatedAt" type="hidden" value={request.updatedAt} />
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`leave-start-${request.id}`}>
          Start date
        </label>
        <input
          className={styles.input}
          defaultValue={request.startDate}
          id={`leave-start-${request.id}`}
          name="startDate"
          type="date"
          required
        />
        <FieldError field="startDate" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`leave-end-${request.id}`}>
          End date
        </label>
        <input
          className={styles.input}
          defaultValue={request.endDate}
          id={`leave-end-${request.id}`}
          name="endDate"
          type="date"
          required
        />
        <FieldError field="endDate" state={state} />
      </div>
      <div className={styles.fieldWide}>
        <label className={styles.label} htmlFor={`leave-reason-${request.id}`}>
          Reason
        </label>
        <textarea
          className={styles.textarea}
          defaultValue={request.reason}
          id={`leave-reason-${request.id}`}
          name="reason"
          required
        />
        <FieldError field="reason" state={state} />
      </div>
      <div className={styles.actions}>
        <SubmitButton pendingLabel="Saving request…">Save changes</SubmitButton>
      </div>
      <div className={styles.fieldWide}>
        <ActionFeedback state={state} />
      </div>
    </form>
  );
}

function CancelLeaveForm({ request }: { request: LeaveRequestRecord }) {
  const [state, action] = useActionState(cancelLeaveRequestAction, INITIAL_CRUD_ACTION_STATE);

  return (
    <>
      <form
        action={action}
        className={styles.inlineActions}
        onSubmit={(event) => {
          if (!window.confirm("Cancel this leave request?")) {
            event.preventDefault();
          }
        }}
      >
        <input name="id" type="hidden" value={request.id} />
        <input name="expectedUpdatedAt" type="hidden" value={request.updatedAt} />
        <SubmitButton pendingLabel="Cancelling…" tone="danger">
          Cancel request
        </SubmitButton>
      </form>
      <ActionFeedback state={state} />
    </>
  );
}

function LeaveItem({ request }: { request: LeaveRequestRecord }) {
  return (
    <li className={styles.record}>
      <div className={styles.recordTop}>
        <div>
          <h3 className={styles.recordTitle}>
            {formatDate(request.startDate)} – {formatDate(request.endDate)}
          </h3>
          <p className={styles.recordSubtitle}>Submitted {formatDate(request.createdAt)}</p>
        </div>
        <span className={styles.badge}>{LEAVE_STATUS_LABELS[request.status]}</span>
      </div>
      <p className={styles.recordText}>{request.reason}</p>
      {request.reviewNote ? (
        <p className={styles.recordText}>Review note: {request.reviewNote}</p>
      ) : null}
      {request.status === "pending" ? (
        <>
          <details className={styles.details}>
            <summary>Edit request</summary>
            <UpdateLeaveForm request={request} />
          </details>
          <div className={styles.details}>
            <CancelLeaveForm request={request} />
          </div>
        </>
      ) : null}
    </li>
  );
}

export function LeaveWorkspace({ data }: { data: OwnLeaveCrudData }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const filteredRequests = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();

    if (!needle) {
      return data.leaveRequests;
    }

    return data.leaveRequests.filter((request) =>
      [
        request.reason,
        request.status,
        LEAVE_STATUS_LABELS[request.status],
        request.startDate,
        request.endDate,
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [data.leaveRequests, search]);
  const pageCount = Math.max(1, Math.ceil(filteredRequests.length / LEAVE_REQUESTS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const visibleRequests = filteredRequests.slice(
    (safePage - 1) * LEAVE_REQUESTS_PER_PAGE,
    safePage * LEAVE_REQUESTS_PER_PAGE,
  );

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Request leave</h2>
            <p>Submit dates and a reason to the reviewer allowed for your role.</p>
          </div>
        </div>
        <CreateLeaveForm />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>My leave requests</h2>
            <p>Pending requests can be edited or cancelled.</p>
          </div>
          <span className={styles.count}>{filteredRequests.length}</span>
        </div>
        <div className={styles.tableToolbar}>
          <label className={styles.searchControl}>
            <Search aria-hidden="true" size={17} />
            <input
              aria-label="Search leave requests"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search reason, status, or date…"
              type="search"
              value={search}
            />
          </label>
          <span className={styles.resultSummary}>
            {filteredRequests.length} request{filteredRequests.length === 1 ? "" : "s"}
          </span>
        </div>
        {visibleRequests.length === 0 ? (
          <EmptyState
            title="No leave requests"
            message={
              search
                ? "No leave requests match your search."
                : "Your submitted leave requests and their decisions will appear here."
            }
          />
        ) : (
          <ul className={styles.recordList}>
            {visibleRequests.map((request) => (
              <LeaveItem key={request.id} request={request} />
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
    </div>
  );
}
