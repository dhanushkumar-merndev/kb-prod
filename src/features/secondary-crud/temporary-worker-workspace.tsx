"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  ActionFeedback,
  EmptyState,
  FieldError,
  formatDate,
  formatMoney,
  SubmitButton,
} from "@/features/core-crud/components/shared";
import coreStyles from "@/features/core-crud/core-crud.module.css";
import { INITIAL_CRUD_ACTION_STATE } from "@/features/core-crud/types";

import {
  assignTemporaryWorkerAction,
  createTemporaryWorkerAction,
  updateTemporaryWorkerAction,
  updateTemporaryWorkerStatusAction,
} from "./actions";
import { PendingToast } from "./shared";
import {
  TEMPORARY_WORKER_PAYMENT_TYPES,
  TEMPORARY_WORKER_PAYMENT_TYPE_LABELS,
  TEMPORARY_WORKER_TYPES,
  TEMPORARY_WORKER_TYPE_LABELS,
  type TemporaryWorkerCrudData,
  type TemporaryWorkerRecord,
} from "./types";

function WorkerFields({
  idPrefix,
  state,
  worker,
}: {
  idPrefix: string;
  state: typeof INITIAL_CRUD_ACTION_STATE;
  worker?: TemporaryWorkerRecord;
}) {
  return (
    <>
      <div className={coreStyles.field}>
        <label className={coreStyles.label} htmlFor={`${idPrefix}-name`}>
          Full name
        </label>
        <input
          className={coreStyles.input}
          defaultValue={worker?.fullName ?? ""}
          id={`${idPrefix}-name`}
          maxLength={160}
          name="fullName"
          required
        />
        <FieldError field="fullName" state={state} />
      </div>
      <div className={coreStyles.field}>
        <label className={coreStyles.label} htmlFor={`${idPrefix}-phone`}>
          Phone
        </label>
        <input
          className={coreStyles.input}
          defaultValue={worker?.phoneE164 ?? ""}
          id={`${idPrefix}-phone`}
          inputMode="tel"
          maxLength={32}
          name="phone"
          placeholder="98765 43210"
          type="tel"
        />
        <FieldError field="phone" state={state} />
      </div>
      <div className={coreStyles.field}>
        <label className={coreStyles.label} htmlFor={`${idPrefix}-type`}>
          Worker type
        </label>
        <select
          className={coreStyles.select}
          defaultValue={worker?.workerType ?? "helper"}
          id={`${idPrefix}-type`}
          name="workerType"
        >
          {TEMPORARY_WORKER_TYPES.map((workerType) => (
            <option key={workerType} value={workerType}>
              {TEMPORARY_WORKER_TYPE_LABELS[workerType]}
            </option>
          ))}
        </select>
        <FieldError field="workerType" state={state} />
      </div>
      <div className={coreStyles.field}>
        <label className={coreStyles.label} htmlFor={`${idPrefix}-payment-type`}>
          Payment type
        </label>
        <select
          className={coreStyles.select}
          defaultValue={worker?.paymentType ?? "daily"}
          id={`${idPrefix}-payment-type`}
          name="paymentType"
        >
          {TEMPORARY_WORKER_PAYMENT_TYPES.map((paymentType) => (
            <option key={paymentType} value={paymentType}>
              {TEMPORARY_WORKER_PAYMENT_TYPE_LABELS[paymentType]}
            </option>
          ))}
        </select>
        <FieldError field="paymentType" state={state} />
      </div>
      <div className={coreStyles.field}>
        <label className={coreStyles.label} htmlFor={`${idPrefix}-payment-amount`}>
          Agreed amount
        </label>
        <input
          className={coreStyles.input}
          defaultValue={worker?.paymentAmount ?? ""}
          id={`${idPrefix}-payment-amount`}
          min="0"
          name="paymentAmount"
          required
          step="0.01"
          type="number"
        />
        <FieldError field="paymentAmount" state={state} />
      </div>
      <div className={coreStyles.fieldWide}>
        <label className={coreStyles.label} htmlFor={`${idPrefix}-notes`}>
          Notes
        </label>
        <textarea
          className={coreStyles.textarea}
          defaultValue={worker?.notes ?? ""}
          id={`${idPrefix}-notes`}
          maxLength={2000}
          name="notes"
        />
        <FieldError field="notes" state={state} />
      </div>
    </>
  );
}

function CreateTemporaryWorkerForm() {
  const [state, action] = useActionState(createTemporaryWorkerAction, INITIAL_CRUD_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state.mutationId, state.status]);

  return (
    <form action={action} className={coreStyles.formGrid} ref={formRef} noValidate>
      <WorkerFields idPrefix="temporary-worker-create" state={state} />
      <div className={coreStyles.actions}>
        <SubmitButton pendingLabel="Adding worker…">Add temporary worker</SubmitButton>
      </div>
      <PendingToast message="Adding temporary worker…" />
      <ActionFeedback state={state} />
    </form>
  );
}

function UpdateTemporaryWorkerForm({ worker }: { worker: TemporaryWorkerRecord }) {
  const [state, action] = useActionState(updateTemporaryWorkerAction, INITIAL_CRUD_ACTION_STATE);

  return (
    <form action={action} className={`${coreStyles.formGrid} ${coreStyles.detailsForm}`} noValidate>
      <input name="id" type="hidden" value={worker.id} />
      <input name="expectedUpdatedAt" type="hidden" value={worker.updatedAt} />
      <WorkerFields idPrefix={`temporary-worker-${worker.id}`} state={state} worker={worker} />
      <div className={coreStyles.actions}>
        <SubmitButton pendingLabel="Saving worker…">Save changes</SubmitButton>
      </div>
      <PendingToast message="Saving temporary worker…" />
      <ActionFeedback state={state} />
    </form>
  );
}

function TemporaryWorkerStatusForm({ worker }: { worker: TemporaryWorkerRecord }) {
  const [state, action] = useActionState(
    updateTemporaryWorkerStatusAction,
    INITIAL_CRUD_ACTION_STATE,
  );
  const nextIsActive = !worker.isActive;

  return (
    <>
      <form
        action={action}
        className={coreStyles.inlineActions}
        onSubmit={(event) => {
          if (
            !nextIsActive &&
            !window.confirm("Deactivate this temporary worker? Existing history will be kept.")
          ) {
            event.preventDefault();
          }
        }}
      >
        <input name="id" type="hidden" value={worker.id} />
        <input name="expectedUpdatedAt" type="hidden" value={worker.updatedAt} />
        <input name="isActive" type="hidden" value={String(nextIsActive)} />
        <SubmitButton
          pendingLabel={nextIsActive ? "Activating…" : "Deactivating…"}
          tone={nextIsActive ? "secondary" : "danger"}
        >
          {nextIsActive ? "Activate worker" : "Deactivate worker"}
        </SubmitButton>
        <PendingToast
          message={nextIsActive ? "Activating temporary worker…" : "Deactivating temporary worker…"}
        />
      </form>
      <ActionFeedback state={state} />
    </>
  );
}

function TemporaryWorkerItem({ worker }: { worker: TemporaryWorkerRecord }) {
  return (
    <li className={coreStyles.record}>
      <div className={coreStyles.recordTop}>
        <div>
          <h3 className={coreStyles.recordTitle}>{worker.fullName}</h3>
          <p className={coreStyles.recordSubtitle}>
            {TEMPORARY_WORKER_TYPE_LABELS[worker.workerType]}
            {worker.phoneE164 ? ` · ${worker.phoneE164}` : ""}
          </p>
        </div>
        <span className={coreStyles.badge}>{worker.isActive ? "Active" : "Inactive"}</span>
      </div>
      <dl className={coreStyles.metadata}>
        <div>
          <dt>Pay basis</dt>
          <dd>{TEMPORARY_WORKER_PAYMENT_TYPE_LABELS[worker.paymentType]}</dd>
        </div>
        <div>
          <dt>Agreed amount</dt>
          <dd className={coreStyles.mono}>{formatMoney(worker.paymentAmount)}</dd>
        </div>
        <div>
          <dt>Added</dt>
          <dd>{formatDate(worker.createdAt)}</dd>
        </div>
      </dl>
      {worker.notes ? <p className={coreStyles.recordText}>{worker.notes}</p> : null}
      <TemporaryWorkerStatusForm worker={worker} />
      <details className={coreStyles.details}>
        <summary>Edit worker</summary>
        <UpdateTemporaryWorkerForm worker={worker} />
      </details>
    </li>
  );
}

function TemporaryWorkerAssignmentForm({ data }: { data: TemporaryWorkerCrudData }) {
  const [state, action] = useActionState(
    assignTemporaryWorkerAction,
    INITIAL_CRUD_ACTION_STATE,
  );
  const [bookingId, setBookingId] = useState(data.bookings[0]?.id ?? "");
  const selectedBooking = data.bookings.find((booking) => booking.id === bookingId);
  const activeWorkers = data.workers.filter((worker) => worker.isActive);

  if (activeWorkers.length === 0 || data.bookings.length === 0) {
    return (
      <EmptyState
        title="Assignment needs workers and bookings"
        message="Add an active temporary worker and a non-cancelled booking before scheduling work."
      />
    );
  }

  return (
    <form action={action} className={coreStyles.formGrid}>
      <div className={coreStyles.field}>
        <label className={coreStyles.label} htmlFor="temporary-assignment-worker">
          Worker
        </label>
        <select
          className={coreStyles.select}
          id="temporary-assignment-worker"
          name="temporaryWorkerId"
        >
          {activeWorkers.map((worker) => (
            <option key={worker.id} value={worker.id}>
              {worker.fullName} · {TEMPORARY_WORKER_TYPE_LABELS[worker.workerType]}
            </option>
          ))}
        </select>
      </div>
      <div className={coreStyles.field}>
        <label className={coreStyles.label} htmlFor="temporary-assignment-booking">
          Booking
        </label>
        <select
          className={coreStyles.select}
          id="temporary-assignment-booking"
          name="bookingId"
          onChange={(event) => setBookingId(event.target.value)}
          value={bookingId}
        >
          {data.bookings.map((booking) => (
            <option key={booking.id} value={booking.id}>
              {booking.bookingCode} · {formatDate(booking.eventDate)}
            </option>
          ))}
        </select>
      </div>
      <div className={coreStyles.field}>
        <label className={coreStyles.label} htmlFor="temporary-assignment-date">
          Work date
        </label>
        <input
          className={coreStyles.input}
          id="temporary-assignment-date"
          key={selectedBooking?.eventDate}
          name="workDate"
          readOnly
          required
          type="date"
          value={selectedBooking?.eventDate ?? ""}
        />
      </div>
      <div className={coreStyles.field}>
        <label className={coreStyles.label} htmlFor="temporary-assignment-reporting">
          Reporting time
        </label>
        <input
          className={coreStyles.input}
          id="temporary-assignment-reporting"
          name="reportingTime"
          type="time"
        />
      </div>
      <div className={coreStyles.field}>
        <label className={coreStyles.label} htmlFor="temporary-assignment-pay">
          Agreed payment
        </label>
        <input
          className={coreStyles.input}
          id="temporary-assignment-pay"
          min="0"
          name="agreedPayment"
          required
          step="0.01"
          type="number"
        />
      </div>
      <div className={coreStyles.fieldWide}>
        <label className={coreStyles.label} htmlFor="temporary-assignment-notes">
          Notes
        </label>
        <textarea
          className={coreStyles.textarea}
          id="temporary-assignment-notes"
          name="notes"
        />
      </div>
      <div className={coreStyles.actions}>
        <SubmitButton pendingLabel="Assigning worker…">Assign worker</SubmitButton>
      </div>
      <PendingToast message="Assigning temporary worker…" />
      <ActionFeedback state={state} />
    </form>
  );
}

export function TemporaryWorkerWorkspace({ data }: { data: TemporaryWorkerCrudData }) {
  const workersById = new Map(data.workers.map((worker) => [worker.id, worker]));
  const bookingsById = new Map(data.bookings.map((booking) => [booking.id, booking]));

  return (
    <div className={coreStyles.panel}>
      <section className={coreStyles.section}>
        <div className={coreStyles.sectionHeader}>
          <div>
            <h2>Add temporary worker</h2>
            <p>Create a workforce record without creating a CRM login.</p>
          </div>
        </div>
        <CreateTemporaryWorkerForm />
      </section>

      <section className={coreStyles.section}>
        <div className={coreStyles.sectionHeader}>
          <div>
            <h2>Schedule temporary worker</h2>
            <p>Assign an agreed wage to a booking date before recording attendance.</p>
          </div>
        </div>
        <TemporaryWorkerAssignmentForm data={data} />
      </section>

      <section className={coreStyles.section}>
        <div className={coreStyles.sectionHeader}>
          <div>
            <h2>Scheduled temporary work</h2>
            <p>Assignments remain in history for payroll and wage verification.</p>
          </div>
          <span className={coreStyles.count}>{data.assignments.length}</span>
        </div>
        {data.assignments.length === 0 ? (
          <EmptyState
            title="No temporary work scheduled"
            message="Use the assignment form above to schedule a worker against a booking."
          />
        ) : (
          <ul className={coreStyles.recordList}>
            {data.assignments.map((assignment) => {
              const worker = workersById.get(assignment.temporaryWorkerId);
              const booking = bookingsById.get(assignment.bookingId);

              return (
                <li className={coreStyles.record} key={assignment.id}>
                  <div className={coreStyles.recordTop}>
                    <div>
                      <h3 className={coreStyles.recordTitle}>
                        {worker?.fullName ?? "Temporary worker"}
                      </h3>
                      <p className={coreStyles.recordSubtitle}>
                        {booking?.bookingCode ?? "Booking"} · {formatDate(assignment.workDate)}
                      </p>
                    </div>
                    <span className={coreStyles.badge}>
                      {formatMoney(assignment.agreedPayment)}
                    </span>
                  </div>
                  {assignment.reportingTime ? (
                    <p className={coreStyles.recordText}>
                      Reporting time: {assignment.reportingTime}
                    </p>
                  ) : null}
                  {assignment.notes ? (
                    <p className={coreStyles.recordText}>{assignment.notes}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={coreStyles.section}>
        <div className={coreStyles.sectionHeader}>
          <div>
            <h2>Temporary workers</h2>
            <p>Worker details and status are stored in the normalized Supabase table.</p>
          </div>
          <span className={coreStyles.count}>{data.workers.length}</span>
        </div>
        {data.workers.length === 0 ? (
          <EmptyState
            title="No temporary workers"
            message="Add a helper, server, cleaner, driver, or other temporary worker above."
          />
        ) : (
          <ul className={coreStyles.recordList}>
            {data.workers.map((worker) => (
              <TemporaryWorkerItem key={worker.id} worker={worker} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
