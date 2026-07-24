"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { changeJobStatusAction, endShiftAction, startShiftAction } from "./actions";
import {
  INITIAL_WORKFORCE_ACTION_STATE,
  type WorkforceActionState,
  type WorkforceJob,
  type WorkforceSelfServiceData,
} from "./types";
import styles from "./workforce.module.css";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${value}T00:00:00+05:30`));
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

function Feedback({ state }: { state: WorkforceActionState }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const visible = state.status !== "idle" && dismissed !== state.mutationId;

  useEffect(() => {
    if (state.status !== "success") {
      return;
    }

    const timer = window.setTimeout(() => setDismissed(state.mutationId), 3000);
    return () => window.clearTimeout(timer);
  }, [state.mutationId, state.status]);

  if (!visible) {
    return null;
  }

  return (
    <div
      className={[
        styles.toast,
        state.status === "success" ? styles.toastSuccess : styles.toastError,
      ].join(" ")}
      role={state.status === "error" ? "alert" : "status"}
    >
      <span>{state.message}</span>
      <button
        aria-label="Dismiss notification"
        onClick={() => setDismissed(state.mutationId)}
        type="button"
      >
        ×
      </button>
    </div>
  );
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();

  return (
    <button className={styles.action} disabled={pending} type="submit">
      {pending ? "Saving…" : children}
    </button>
  );
}

function JobAction({ job }: { job: WorkforceJob }) {
  const [state, action] = useActionState(changeJobStatusAction, INITIAL_WORKFORCE_ACTION_STATE);
  const nextStatus =
    job.serviceStatus === "preparing"
      ? "service_completed"
      : ["pending", "confirmed", "chef_assigned"].includes(job.serviceStatus)
        ? "preparing"
        : null;

  if (!nextStatus) {
    return null;
  }

  return (
    <>
      <form action={action}>
        <input name="bookingId" type="hidden" value={job.bookingId} />
        <input name="expectedVersion" type="hidden" value={job.version} />
        <input name="toStatus" type="hidden" value={nextStatus} />
        <SubmitButton>
          {nextStatus === "preparing" ? "Start preparing" : "Complete service"}
        </SubmitButton>
      </form>
      <Feedback state={state} />
    </>
  );
}

export function WorkforceWorkspace({
  data,
  mode,
}: {
  data: WorkforceSelfServiceData;
  mode: "attendance" | "jobs";
}) {
  const [startState, startAction] = useActionState(
    startShiftAction,
    INITIAL_WORKFORCE_ACTION_STATE,
  );
  const [endState, endAction] = useActionState(endShiftAction, INITIAL_WORKFORCE_ACTION_STATE);
  const attendanceJobs = data.jobs.filter((job) =>
    ["pending", "confirmed", "chef_assigned", "preparing"].includes(job.serviceStatus),
  );

  if (mode === "attendance") {
    return (
      <div className={styles.stack}>
        <section className={styles.clockCard}>
          <div>
            <span className={styles.eyebrow}>Shift clock</span>
            <h2>{data.openShift ? "Shift in progress" : "Ready to clock in"}</h2>
            <p>
              {data.openShift
                ? `Started ${formatDateTime(data.openShift.startedAt)}`
                : "Start attendance against one of your assigned jobs."}
            </p>
          </div>

          {data.openShift ? (
            <form action={endAction}>
              <input name="shiftId" type="hidden" value={data.openShift.id} />
              <SubmitButton>End shift</SubmitButton>
            </form>
          ) : attendanceJobs.length > 0 ? (
            <form action={startAction} className={styles.startForm}>
              <label htmlFor="attendance-booking">Assigned booking</label>
              <select id="attendance-booking" name="bookingId" required>
                {attendanceJobs.map((job) => (
                  <option key={job.bookingId} value={job.bookingId}>
                    {job.bookingCode} · {formatDate(job.eventDate)}
                  </option>
                ))}
              </select>
              <SubmitButton>Start shift</SubmitButton>
            </form>
          ) : (
            <p className={styles.empty}>No assigned booking is available for attendance.</p>
          )}
        </section>
        <Feedback state={data.openShift ? endState : startState} />

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>Attendance history</h2>
            <span>{data.shifts.length}</span>
          </div>
          {data.shifts.length === 0 ? (
            <p className={styles.empty}>No shifts have been recorded yet.</p>
          ) : (
            <ul className={styles.list}>
              {data.shifts.map((shift) => (
                <li key={shift.id}>
                  <div>
                    <strong>{formatDate(shift.shiftDate)}</strong>
                    <span>
                      {formatDateTime(shift.startedAt)} – {formatDateTime(shift.endedAt)}
                    </span>
                  </div>
                  <span className={styles.badge}>{shift.status.replaceAll("_", " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Assigned work</span>
          <h2>My jobs</h2>
        </div>
        <span>{data.jobs.length}</span>
      </div>

      {data.jobs.length === 0 ? (
        <p className={styles.empty}>No jobs are currently assigned to you.</p>
      ) : (
        <ul className={styles.jobList}>
          {data.jobs.map((job) => (
            <li key={job.bookingId}>
              <div className={styles.jobTop}>
                <div>
                  <strong>{job.bookingCode}</strong>
                  <span>
                    {job.eventType} · {formatDate(job.eventDate)}
                  </span>
                </div>
                <span className={styles.badge}>{job.serviceStatus.replaceAll("_", " ")}</span>
              </div>
              <dl>
                <div>
                  <dt>Venue</dt>
                  <dd>{job.venue}</dd>
                </div>
                <div>
                  <dt>Reporting</dt>
                  <dd>{job.reportingTime ?? "—"}</dd>
                </div>
                <div>
                  <dt>Guests</dt>
                  <dd>{job.guestCount.toLocaleString("en-IN")}</dd>
                </div>
                <div>
                  <dt>Menu</dt>
                  <dd>{job.menu}</dd>
                </div>
              </dl>
              {job.instructions ? <p>{job.instructions}</p> : null}
              <JobAction job={job} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
