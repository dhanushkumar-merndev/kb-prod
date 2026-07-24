"use client";

import { useFormStatus } from "react-dom";

import coreStyles from "@/features/core-crud/core-crud.module.css";

import styles from "./secondary-crud.module.css";

export function PendingToast({ message }: { message: string }) {
  const { pending } = useFormStatus();

  if (!pending) {
    return null;
  }

  return (
    <div
      className={[coreStyles.feedback, coreStyles.toast, styles.feedbackLoading].join(" ")}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span>
        <span className={styles.buttonSpinner} aria-hidden="true" />
        {message}
      </span>
    </div>
  );
}

export function localDateTimeValue(value: string): string {
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

function googleDate(value: string): string {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function googleCalendarUrl(input: {
  title: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  location: string | null;
  meetingUrl: string | null;
}): string {
  const details = [input.reason, input.meetingUrl ? `Join: ${input.meetingUrl}` : null]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
  const parameters = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${googleDate(input.startsAt)}/${googleDate(input.endsAt)}`,
  });

  if (details) {
    parameters.set("details", details);
  }

  if (input.location) {
    parameters.set("location", input.location);
  }

  return `https://calendar.google.com/calendar/render?${parameters.toString()}`;
}
