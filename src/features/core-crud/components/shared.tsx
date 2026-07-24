"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import styles from "../core-crud.module.css";
import type { CrudActionState } from "../types";

export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  tone = "primary",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  tone?: "primary" | "secondary" | "danger";
}) {
  const { pending } = useFormStatus();
  const className =
    tone === "danger"
      ? styles.buttonDanger
      : tone === "secondary"
        ? styles.buttonSecondary
        : styles.button;

  return (
    <button className={className} type="submit" disabled={pending} aria-busy={pending}>
      {pending ? (
        <>
          <span className={styles.spinner} aria-hidden="true" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function ActionFeedback({ state }: { state: CrudActionState }) {
  const [dismissedMutationId, setDismissedMutationId] = useState<string | null>(null);
  const isVisible = state.status !== "idle" && dismissedMutationId !== state.mutationId;

  useEffect(() => {
    if (state.status !== "success") {
      return;
    }

    const timeout = window.setTimeout(() => {
      setDismissedMutationId(state.mutationId);
    }, 3000);

    return () => window.clearTimeout(timeout);
  }, [state.mutationId, state.status]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className={[
        styles.feedback,
        styles.toast,
        state.status === "success" ? styles.feedbackSuccess : styles.feedbackError,
      ].join(" ")}
      role={state.status === "error" ? "alert" : "status"}
      aria-live="polite"
      aria-atomic="true"
    >
      <div>
        {state.message}
        {state.requestId ? (
          <span className={styles.supportCode}>Support code: {state.requestId}</span>
        ) : null}
      </div>
      <button
        aria-label="Dismiss notification"
        className={styles.toastClose}
        onClick={() => setDismissedMutationId(state.mutationId)}
        type="button"
      >
        ×
      </button>
    </div>
  );
}

export function FieldError({ field, state }: { field: string; state: CrudActionState }) {
  const message = state.fieldErrors?.[field];

  return message ? (
    <p className={styles.fieldError} role="alert">
      {message}
    </p>
  ) : null;
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className={styles.empty}>
      <strong>{title}</strong>
      <p>{message}</p>
    </div>
  );
}

export function CrudErrorState({ message, requestId }: { message: string; requestId: string }) {
  return (
    <div className={styles.error} role="alert">
      <strong>Unable to load</strong>
      <p>{message}</p>
      <span className={styles.supportCode}>Support code: {requestId}</span>
    </div>
  );
}

export function CoreCrudLoadingState({ label = "Loading records…" }: { label?: string }) {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      {label}
    </div>
  );
}

export function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00+05:30`)
    : new Date(value);

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

export function formatMoney(value: string | null): string {
  if (value === null) {
    return "—";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export function toIndiaDateTimeLocal(value: string | null): string {
  if (!value) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Kolkata",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}
