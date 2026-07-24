"use client";

import { ChevronLeft, ChevronRight, ExternalLink, Search, Upload, X } from "lucide-react";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import { ActionFeedback, FieldError, SubmitButton } from "@/features/core-crud/components/shared";
import { INITIAL_CRUD_ACTION_STATE } from "@/features/core-crud/types";

import { attachPaymentProofAction, reviewPaymentAction, submitPaymentAction } from "./actions";
import type { PaymentData, PaymentRecord } from "./types";
import styles from "./payments.module.css";

const PAYMENTS_PER_PAGE = 10;
type PaymentFilter = "pending" | "verified" | "all";

function SubmitPayment({ data }: { data: PaymentData }) {
  const [state, action] = useActionState(submitPaymentAction, INITIAL_CRUD_ACTION_STATE);

  if (!data.canSubmit) {
    return null;
  }

  return (
    <section className={styles.section}>
      <h2>Submit customer payment</h2>
      {data.bookings.length === 0 ? (
        <p className={styles.empty}>Create a booking before submitting payment.</p>
      ) : (
        <form action={action} className={styles.formGrid}>
          <label className={styles.wide}>
            Booking
            <select name="bookingId" required>
              {data.bookings.map((booking) => (
                <option key={booking.id} value={booking.id}>
                  {booking.bookingCode} · {booking.clientName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payment stage
            <select name="paymentStage" required>
              <option value="advance">Advance</option>
              <option value="partial">Partial</option>
              <option value="final">Final</option>
              <option value="full">Full</option>
            </select>
          </label>
          <label>
            Amount
            <input min="0.01" name="amount" required step="0.01" type="number" />
            <FieldError field="amount" state={state} />
          </label>
          <label>
            Payment method
            <input name="paymentMethod" placeholder="UPI, cash, bank transfer…" required />
          </label>
          <label>
            Transaction reference
            <input name="transactionReference" />
          </label>
          <label className={styles.wide}>
            Payment proof
            <input
              accept="image/jpeg,image/png,image/webp,application/pdf"
              name="proof"
              required
              type="file"
            />
            <small>JPG, PNG, WebP or PDF up to 8 MB.</small>
            <FieldError field="proof" state={state} />
          </label>
          <div className={styles.actions}>
            <SubmitButton pendingLabel="Uploading…">Upload payment proof</SubmitButton>
          </div>
        </form>
      )}
      <ActionFeedback state={state} />
    </section>
  );
}

function PaymentReview({ payment }: { payment: PaymentRecord }) {
  const [state, action] = useActionState(reviewPaymentAction, INITIAL_CRUD_ACTION_STATE);

  if (payment.verificationStatus !== "pending") {
    return null;
  }

  return (
    <>
      <form action={action} className={styles.reviewForm}>
        <input name="paymentId" type="hidden" value={payment.id} />
        <label>
          Decision
          <select name="decision">
            <option value="verified">Verify</option>
            <option value="rejected">Reject</option>
          </select>
        </label>
        <label className={styles.reviewReason}>
          Rejection reason
          <input name="rejectionReason" placeholder="Required only when rejecting" />
        </label>
        <SubmitButton>Save decision</SubmitButton>
      </form>
      <ActionFeedback state={state} />
    </>
  );
}

function PaymentProofDialog({
  canSubmit,
  onClose,
  payment,
}: {
  canSubmit: boolean;
  onClose: () => void;
  payment: PaymentRecord | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action] = useActionState(attachPaymentProofAction, INITIAL_CRUD_ACTION_STATE);

  useEffect(() => {
    if (payment) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [payment]);

  if (!payment) return null;

  return (
    <dialog className={styles.proofDialog} onClose={onClose} ref={dialogRef}>
      <div className={styles.proofHeader}>
        <div>
          <h2>Payment proof</h2>
          <p>
            {payment.bookingCode} · {payment.paymentStage}
          </p>
        </div>
        <button aria-label="Close payment proof" onClick={() => dialogRef.current?.close()}>
          <X aria-hidden="true" size={20} />
        </button>
      </div>
      <div className={styles.proofBody}>
        {payment.proofUrl ? (
          <>
            <object
              aria-label={`Payment proof for ${payment.bookingCode}`}
              className={styles.proofPreview}
              data={payment.proofUrl}
            >
              <p>Preview unavailable. Use “Open original” below.</p>
            </object>
            <a href={payment.proofUrl} rel="noreferrer" target="_blank">
              Open original <ExternalLink aria-hidden="true" size={15} />
            </a>
          </>
        ) : canSubmit ? (
          <form action={action} className={styles.proofUploadForm}>
            <input name="paymentId" type="hidden" value={payment.id} />
            <input name="bookingId" type="hidden" value={payment.bookingId} />
            <p>No proof is attached to this payment. Upload the customer’s payment image or PDF.</p>
            <label>
              Payment proof
              <input
                accept="image/jpeg,image/png,image/webp,application/pdf"
                name="proof"
                required
                type="file"
              />
            </label>
            <FieldError field="proof" state={state} />
            <SubmitButton pendingLabel="Uploading…">
              <Upload aria-hidden="true" size={16} /> Upload payment proof
            </SubmitButton>
            <ActionFeedback state={state} />
          </form>
        ) : (
          <p className={styles.empty}>No proof has been uploaded for this payment.</p>
        )}
      </div>
    </dialog>
  );
}

export function PaymentWorkspace({ data }: { data: PaymentData }) {
  const [filter, setFilter] = useState<PaymentFilter>("pending");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedPayment, setSelectedPayment] = useState<PaymentRecord | null>(null);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredPayments = useMemo(
    () =>
      data.payments.filter((payment) => {
        const filterMatches = filter === "all" ? true : payment.verificationStatus === filter;
        const searchMatches =
          !normalizedSearch ||
          [
            payment.bookingCode,
            payment.paymentStage,
            payment.verificationStatus,
            payment.paymentMethod,
            payment.transactionReference,
            payment.amount,
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase()
            .includes(normalizedSearch);

        return filterMatches && searchMatches;
      }),
    [data.payments, filter, normalizedSearch],
  );
  const paymentCounts = useMemo(
    () => ({
      all: data.payments.length,
      pending: data.payments.filter((payment) => payment.verificationStatus === "pending").length,
      verified: data.payments.filter((payment) => payment.verificationStatus === "verified").length,
    }),
    [data.payments],
  );
  const pageCount = Math.max(1, Math.ceil(filteredPayments.length / PAYMENTS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const visiblePayments = filteredPayments.slice(
    (safePage - 1) * PAYMENTS_PER_PAGE,
    safePage * PAYMENTS_PER_PAGE,
  );

  return (
    <div className={styles.stack}>
      <SubmitPayment data={data} />
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Payment records</h2>
            <p>Every proof is kept as a separate auditable record.</p>
          </div>
          <span>{filteredPayments.length}</span>
        </div>
        <div className={styles.tabs} role="tablist" aria-label="Payment verification status">
          {(
            [
              ["pending", "Needs verification"],
              ["verified", "Verified"],
              ["all", "All records"],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-selected={filter === value}
              className={filter === value ? styles.activeTab : undefined}
              key={value}
              onClick={() => {
                setFilter(value);
                setPage(1);
              }}
              role="tab"
              type="button"
            >
              {label}
              <span>{paymentCounts[value]}</span>
            </button>
          ))}
        </div>
        <div className={styles.listToolbar}>
          <label className={styles.searchControl}>
            <Search aria-hidden="true" size={18} />
            <span className={styles.srOnly}>Search payment records</span>
            <input
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search booking, status, method, or reference…"
              type="search"
              value={search}
            />
          </label>
          <span className={styles.resultSummary}>
            {filteredPayments.length} payment{filteredPayments.length === 1 ? "" : "s"}
          </span>
        </div>
        {visiblePayments.length === 0 ? (
          <p className={styles.empty}>
            {filter === "pending"
              ? "No payments are waiting for verification."
              : filter === "verified"
                ? "No verified payments are visible yet."
                : "No payment proof is visible yet."}
          </p>
        ) : (
          <ul className={styles.list}>
            {visiblePayments.map((payment) => (
              <li key={payment.id}>
                <div className={styles.recordTop}>
                  <div>
                    <strong>{payment.bookingCode}</strong>
                    <span>
                      {payment.paymentStage.replaceAll("_", " ")} ·{" "}
                      {new Intl.NumberFormat("en-IN", {
                        style: "currency",
                        currency: "INR",
                      }).format(Number(payment.amount))}
                    </span>
                  </div>
                  <span className={styles.badge}>{payment.verificationStatus}</span>
                </div>
                <div className={styles.meta}>
                  <span>{payment.paymentMethod ?? "Method not entered"}</span>
                  <span>{payment.transactionReference ?? "No reference"}</span>
                  {payment.proofUrl ? (
                    <button
                      className={styles.proofLink}
                      onClick={() => setSelectedPayment(payment)}
                      type="button"
                    >
                      View proof
                    </button>
                  ) : (
                    <button
                      className={styles.proofLink}
                      onClick={() => setSelectedPayment(payment)}
                      type="button"
                    >
                      {data.canSubmit ? "Upload proof" : "Proof unavailable"}
                    </button>
                  )}
                </div>
                {payment.rejectionReason ? (
                  <p className={styles.rejection}>{payment.rejectionReason}</p>
                ) : null}
                {data.canReview ? <PaymentReview payment={payment} /> : null}
              </li>
            ))}
          </ul>
        )}
        <div className={styles.pagination}>
          <span>
            Page {safePage} of {pageCount}
          </span>
          <div className={styles.paginationActions}>
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
      <PaymentProofDialog
        canSubmit={data.canSubmit}
        onClose={() => setSelectedPayment(null)}
        payment={selectedPayment}
      />
    </div>
  );
}
