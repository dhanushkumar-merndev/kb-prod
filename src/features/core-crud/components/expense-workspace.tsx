"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import { createExpenseAction, updateExpenseAction } from "../actions";
import styles from "../core-crud.module.css";
import {
  EXPENSE_STATUS_LABELS,
  INITIAL_CRUD_ACTION_STATE,
  type ExpenseRecord,
  type OwnExpenseCrudData,
} from "../types";
import {
  ActionFeedback,
  EmptyState,
  FieldError,
  formatDate,
  formatMoney,
  SubmitButton,
} from "./shared";

const EXPENSES_PER_PAGE = 10;

function CreateExpenseForm({ data }: { data: OwnExpenseCrudData }) {
  const [state, action] = useActionState(createExpenseAction, INITIAL_CRUD_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state.mutationId, state.status]);

  return (
    <form action={action} className={styles.formGrid} ref={formRef} noValidate>
      <div className={styles.fieldWide}>
        <label className={styles.label} htmlFor="expense-booking">
          Related booking
        </label>
        <select className={styles.select} id="expense-booking" name="bookingId">
          <option value="">General expense</option>
          {data.bookings.map((booking) => (
            <option key={booking.id} value={booking.id}>
              {booking.bookingCode} · {booking.clientName} · {formatDate(booking.eventDate)}
            </option>
          ))}
        </select>
        <FieldError field="bookingId" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="expense-category">
          Category
        </label>
        <input
          className={styles.input}
          id="expense-category"
          name="category"
          maxLength={120}
          placeholder="Travel, ingredients, supplies…"
          required
        />
        <FieldError field="category" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="expense-amount">
          Amount
        </label>
        <input
          className={styles.input}
          id="expense-amount"
          name="amount"
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          required
        />
        <FieldError field="amount" state={state} />
      </div>
      <div className={styles.fieldWide}>
        <label className={styles.label} htmlFor="expense-reason">
          Reason
        </label>
        <textarea
          className={styles.textarea}
          id="expense-reason"
          name="reason"
          maxLength={2000}
          required
        />
        <FieldError field="reason" state={state} />
      </div>
      <div className={styles.fieldWide}>
        <label className={styles.label} htmlFor="expense-bill">
          Bill
        </label>
        <input
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className={styles.input}
          id="expense-bill"
          name="bill"
          required
          type="file"
        />
        <p className={styles.help}>JPG, PNG, WebP, or PDF. Maximum 8 MB.</p>
      </div>
      <div className={styles.actions}>
        <SubmitButton pendingLabel="Submitting expense…">Submit expense</SubmitButton>
      </div>
      <div className={styles.fieldWide}>
        <ActionFeedback state={state} />
      </div>
    </form>
  );
}

function UpdateExpenseForm({ expense }: { expense: ExpenseRecord }) {
  const [state, action] = useActionState(updateExpenseAction, INITIAL_CRUD_ACTION_STATE);

  return (
    <form action={action} className={`${styles.formGrid} ${styles.detailsForm}`} noValidate>
      <input name="id" type="hidden" value={expense.id} />
      <input name="expectedUpdatedAt" type="hidden" value={expense.updatedAt} />
      <input name="bookingId" type="hidden" value={expense.bookingId ?? ""} />
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`expense-category-${expense.id}`}>
          Category
        </label>
        <input
          className={styles.input}
          defaultValue={expense.category}
          id={`expense-category-${expense.id}`}
          name="category"
          required
        />
        <FieldError field="category" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`expense-amount-${expense.id}`}>
          Amount
        </label>
        <input
          className={styles.input}
          defaultValue={expense.amount}
          id={`expense-amount-${expense.id}`}
          name="amount"
          type="number"
          min="0.01"
          step="0.01"
          required
        />
        <FieldError field="amount" state={state} />
      </div>
      <div className={styles.fieldWide}>
        <label className={styles.label} htmlFor={`expense-reason-${expense.id}`}>
          Reason
        </label>
        <textarea
          className={styles.textarea}
          defaultValue={expense.reason}
          id={`expense-reason-${expense.id}`}
          name="reason"
          required
        />
        <FieldError field="reason" state={state} />
      </div>
      <div className={styles.actions}>
        <SubmitButton pendingLabel="Saving expense…">Save changes</SubmitButton>
      </div>
      <div className={styles.fieldWide}>
        <ActionFeedback state={state} />
      </div>
    </form>
  );
}

function ExpenseItem({ expense }: { expense: ExpenseRecord }) {
  return (
    <li className={styles.record}>
      <div className={styles.recordTop}>
        <div>
          <h3 className={styles.recordTitle}>{expense.category}</h3>
          <p className={`${styles.recordSubtitle} ${styles.mono}`}>{formatMoney(expense.amount)}</p>
        </div>
        <span className={styles.badge}>{EXPENSE_STATUS_LABELS[expense.status]}</span>
      </div>
      <dl className={styles.metadata}>
        <div>
          <dt>Submitted</dt>
          <dd>{formatDate(expense.createdAt)}</dd>
        </div>
        <div>
          <dt>Related booking</dt>
          <dd className={styles.mono}>{expense.bookingId ?? "General expense"}</dd>
        </div>
      </dl>
      <p className={styles.recordText}>{expense.reason}</p>
      {expense.attachments.length > 0 ? (
        <div className={styles.inlineActions}>
          {expense.attachments.map((attachment) => (
            <a
              className={styles.buttonSecondary}
              href={attachment.signedUrl}
              key={attachment.id}
              rel="noreferrer"
              target="_blank"
            >
              View {attachment.fileName}
            </a>
          ))}
        </div>
      ) : null}
      {expense.rejectionReason ? (
        <p className={styles.feedbackError}>Reason: {expense.rejectionReason}</p>
      ) : null}
      {expense.status === "pending" ? (
        <details className={styles.details}>
          <summary>Edit pending expense</summary>
          <UpdateExpenseForm expense={expense} />
        </details>
      ) : null}
    </li>
  );
}

export function ExpenseWorkspace({ data }: { data: OwnExpenseCrudData }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredExpenses = useMemo(
    () =>
      normalizedSearch
        ? data.expenses.filter((expense) =>
            [expense.category, expense.reason, expense.status, expense.amount, expense.bookingId]
              .filter(Boolean)
              .join(" ")
              .toLocaleLowerCase()
              .includes(normalizedSearch),
          )
        : data.expenses,
    [data.expenses, normalizedSearch],
  );
  const pageCount = Math.max(1, Math.ceil(filteredExpenses.length / EXPENSES_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const visibleExpenses = filteredExpenses.slice(
    (safePage - 1) * EXPENSES_PER_PAGE,
    safePage * EXPENSES_PER_PAGE,
  );

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Submit expense</h2>
            <p>New claims are stored in Supabase and sent for the permitted review flow.</p>
          </div>
        </div>
        <CreateExpenseForm data={data} />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>My expense claims</h2>
            <p>Pending claims can be corrected before a reviewer acts.</p>
          </div>
          <span className={styles.count}>{filteredExpenses.length}</span>
        </div>
        <div className={styles.tableToolbar}>
          <label className={styles.searchControl}>
            <Search aria-hidden="true" size={18} />
            <span className={styles.srOnly}>Search expense claims</span>
            <input
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search category, reason, status, or booking…"
              type="search"
              value={search}
            />
          </label>
          <span className={styles.resultSummary}>
            {filteredExpenses.length} claim{filteredExpenses.length === 1 ? "" : "s"}
          </span>
        </div>
        {visibleExpenses.length === 0 ? (
          <EmptyState
            title="No expense claims"
            message="Use the form above when you need to submit a reimbursable expense."
          />
        ) : (
          <ul className={styles.recordList}>
            {visibleExpenses.map((expense) => (
              <ExpenseItem expense={expense} key={expense.id} />
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
