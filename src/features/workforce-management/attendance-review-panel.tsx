"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import { ActionFeedback, SubmitButton } from "@/features/core-crud/components/shared";
import { INITIAL_CRUD_ACTION_STATE } from "@/features/core-crud/types";

import {
  bulkApproveAttendanceAction,
  recordMissedAttendanceAction,
  reviewAttendanceAction,
} from "./actions";
import styles from "./workforce-management.module.css";

interface Shift {
  id: string;
  profile_id: string | null;
  temporary_worker_id: string | null;
  booking_id: string | null;
  booking_code: string | null;
  shift_date: string;
  started_at: string | null;
  ended_at: string | null;
  status: string;
  overtime_minutes: number;
  payroll_eligible: boolean;
  worker_name: string;
  worker_type: "chef" | "part_time_chef" | "temporary_worker";
}

interface AttendanceReviewData {
  shifts: Shift[];
  workers: Array<{
    value: string;
    name: string;
    type: "chef" | "part_time_chef" | "temporary_worker";
  }>;
  bookings: Array<{ id: string; code: string }>;
}

const ATTENDANCE_RECORDS_PER_PAGE = 10;

function indiaDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function toIndiaLocalDateTime(value: string | null): string {
  if (!value) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const map = new Map(parts.map((part) => [part.type, part.value]));

  return `${map.get("year")}-${map.get("month")}-${map.get("day")}T${map.get("hour")}:${map.get("minute")}`;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function ReviewForm({ shift }: { shift: Shift }) {
  const [state, action] = useActionState(reviewAttendanceAction, INITIAL_CRUD_ACTION_STATE);

  if (!["pending_approval", "approved", "corrected", "rejected"].includes(shift.status)) {
    return null;
  }

  return (
    <>
      <form action={action} className={styles.reviewForm}>
        <input name="shiftId" type="hidden" value={shift.id} />
        <label>
          Decision
          <select defaultValue="approved" name="decision">
            <option value="approved">Approve</option>
            <option value="corrected">Correct times/overtime</option>
            <option value="rejected">Reject</option>
          </select>
        </label>
        <label>
          Start
          <input
            defaultValue={toIndiaLocalDateTime(shift.started_at)}
            name="startedAt"
            type="datetime-local"
          />
        </label>
        <label>
          End
          <input
            defaultValue={toIndiaLocalDateTime(shift.ended_at)}
            name="endedAt"
            type="datetime-local"
          />
        </label>
        <label>
          Overtime minutes
          <input
            defaultValue={shift.overtime_minutes}
            min="0"
            name="overtimeMinutes"
            type="number"
          />
        </label>
        <label className={styles.wide}>
          Reason
          <input name="reason" placeholder="Required for correction/rejection" />
        </label>
        <SubmitButton>Save decision</SubmitButton>
      </form>
      <ActionFeedback state={state} />
    </>
  );
}

function ManualAttendanceForm({ data }: { data: AttendanceReviewData }) {
  const [state, action] = useActionState(recordMissedAttendanceAction, INITIAL_CRUD_ACTION_STATE);

  return (
    <details className={styles.manual}>
      <summary>Record missed attendance or absence</summary>
      <form action={action} className={styles.formGrid}>
        <label>
          Worker
          <select name="subject" required>
            {data.workers.map((worker) => (
              <option key={worker.value} value={worker.value}>
                {worker.name} · {worker.type.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Booking
          <select name="bookingId">
            <option value="">No booking</option>
            {data.bookings.map((booking) => (
              <option key={booking.id} value={booking.id}>
                {booking.code}
              </option>
            ))}
          </select>
        </label>
        <label>
          Shift date
          <input defaultValue={indiaDate()} name="shiftDate" required type="date" />
        </label>
        <label>
          Record type
          <select defaultValue="pending_approval" name="status">
            <option value="pending_approval">Missed completed shift</option>
            <option value="absent">Absent</option>
          </select>
        </label>
        <label>
          Start
          <input name="startedAt" type="datetime-local" />
        </label>
        <label>
          End
          <input name="endedAt" type="datetime-local" />
        </label>
        <label>
          Overtime minutes
          <input defaultValue="0" min="0" name="overtimeMinutes" type="number" />
        </label>
        <label className={styles.wide}>
          Reason
          <input name="reason" required />
        </label>
        <div className={styles.actions}>
          <SubmitButton pendingLabel="Creating attendance…">Create attendance</SubmitButton>
        </div>
      </form>
      <ActionFeedback state={state} />
    </details>
  );
}

export function AttendanceReviewPanel({ data }: { data: AttendanceReviewData }) {
  const [fromDate, setFromDate] = useState(indiaDate());
  const [toDate, setToDate] = useState(indiaDate());
  const [status, setStatus] = useState("all");
  const [workerType, setWorkerType] = useState("all");
  const [worker, setWorker] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkState, bulkAction] = useActionState(
    bulkApproveAttendanceAction,
    INITIAL_CRUD_ACTION_STATE,
  );
  const filtered = useMemo(
    () =>
      data.shifts.filter((shift) => {
        const subjectValue = shift.profile_id
          ? `profile:${shift.profile_id}`
          : `temporary:${shift.temporary_worker_id}`;

        return (
          shift.shift_date >= fromDate &&
          shift.shift_date <= toDate &&
          (status === "all" || shift.status === status) &&
          (workerType === "all" || shift.worker_type === workerType) &&
          (worker === "all" || subjectValue === worker)
        );
      }),
    [data.shifts, fromDate, status, toDate, worker, workerType],
  );
  const pendingIds = filtered
    .filter((shift) => shift.status === "pending_approval")
    .map((shift) => shift.id);
  const pageCount = Math.max(1, Math.ceil(filtered.length / ATTENDANCE_RECORDS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const visibleShifts = filtered.slice(
    (safePage - 1) * ATTENDANCE_RECORDS_PER_PAGE,
    safePage * ATTENDANCE_RECORDS_PER_PAGE,
  );

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div>
          <h2>Attendance review</h2>
          <p>Review live shifts, corrections, absences, and payroll eligibility.</p>
        </div>
        <span>{filtered.length}</span>
      </div>

      <div className={styles.filters}>
        <label>
          From
          <input
            onChange={(event) => {
              setFromDate(event.target.value);
              setPage(1);
            }}
            type="date"
            value={fromDate}
          />
        </label>
        <label>
          To
          <input
            onChange={(event) => {
              setToDate(event.target.value);
              setPage(1);
            }}
            type="date"
            value={toDate}
          />
        </label>
        <label>
          Status
          <select
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            value={status}
          >
            <option value="all">All statuses</option>
            <option value="working">Working now</option>
            <option value="pending_approval">Pending approval</option>
            <option value="approved">Approved</option>
            <option value="corrected">Corrected</option>
            <option value="rejected">Rejected</option>
            <option value="absent">Absent</option>
          </select>
        </label>
        <label>
          Worker type
          <select
            onChange={(event) => {
              setWorkerType(event.target.value);
              setPage(1);
            }}
            value={workerType}
          >
            <option value="all">All worker types</option>
            <option value="chef">Chef</option>
            <option value="part_time_chef">Part-time Chef</option>
            <option value="temporary_worker">Temporary worker</option>
          </select>
        </label>
        <label>
          Employee
          <select
            onChange={(event) => {
              setWorker(event.target.value);
              setPage(1);
            }}
            value={worker}
          >
            <option value="all">All employees</option>
            {data.workers.map((option) => (
              <option key={option.value} value={option.value}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ManualAttendanceForm data={data} />

      {pendingIds.length > 0 ? (
        <>
          <form action={bulkAction} className={styles.bulkForm}>
            {selected.map((shiftId) => (
              <input key={shiftId} name="shiftIds" type="hidden" value={shiftId} />
            ))}
            <button
              onClick={() =>
                setSelected((current) =>
                  pendingIds.every((id) => current.includes(id))
                    ? current.filter((id) => !pendingIds.includes(id))
                    : [...new Set([...current, ...pendingIds])],
                )
              }
              type="button"
            >
              {pendingIds.every((id) => selected.includes(id))
                ? "Clear pending selection"
                : "Select all pending"}
            </button>
            <SubmitButton pendingLabel="Approving selected…">
              Approve selected ({selected.length})
            </SubmitButton>
          </form>
          <ActionFeedback state={bulkState} />
        </>
      ) : null}

      {visibleShifts.length === 0 ? (
        <p className={styles.empty}>No attendance shifts match these filters.</p>
      ) : (
        <ul className={styles.list}>
          {visibleShifts.map((shift) => (
            <li key={shift.id}>
              <div className={styles.shiftTop}>
                <div className={styles.shiftIdentity}>
                  {shift.status === "pending_approval" ? (
                    <input
                      aria-label={`Select ${shift.worker_name} attendance`}
                      checked={selected.includes(shift.id)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...new Set([...current, shift.id])]
                            : current.filter((id) => id !== shift.id),
                        )
                      }
                      type="checkbox"
                    />
                  ) : null}
                  <span>
                    <strong>{shift.worker_name}</strong>
                    <span>
                      {shift.worker_type.replaceAll("_", " ")} · {shift.shift_date}
                    </span>
                  </span>
                </div>
                <span className={styles.badge}>{shift.status.replaceAll("_", " ")}</span>
              </div>
              <p>
                {formatDateTime(shift.started_at)} –{" "}
                {shift.ended_at ? formatDateTime(shift.ended_at) : "In progress"}
                {shift.booking_code ? ` · ${shift.booking_code}` : ""}
                {shift.overtime_minutes > 0 ? ` · ${shift.overtime_minutes}m overtime` : ""}
              </p>
              <ReviewForm shift={shift} />
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
