"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import {
  ActionFeedback,
  EmptyState,
  FieldError,
  formatDateTime,
  SubmitButton,
} from "@/features/core-crud/components/shared";
import coreStyles from "@/features/core-crud/core-crud.module.css";
import { INITIAL_CRUD_ACTION_STATE } from "@/features/core-crud/types";
import { ROLE_LABELS } from "@/lib/constants/roles";

import {
  createMeetingAction,
  deleteMeetingAction,
  updateMeetingAction,
  updateMeetingStatusAction,
} from "./actions";
import styles from "./secondary-crud.module.css";
import { googleCalendarUrl, localDateTimeValue, PendingToast } from "./shared";
import {
  MEETING_STATUSES,
  MEETING_STATUS_LABELS,
  type MeetingCrudData,
  type MeetingDirectoryProfile,
  type MeetingRecord,
} from "./types";

const MEETINGS_PER_PAGE = 10;

function AttendeeChoices({
  directory,
  idPrefix,
  selectedIds = new Set<string>(),
}: {
  directory: MeetingDirectoryProfile[];
  idPrefix: string;
  selectedIds?: ReadonlySet<string>;
}) {
  if (directory.length === 0) {
    return <p className={styles.helper}>No eligible active team members are available.</p>;
  }

  return (
    <div className={styles.attendeeGrid}>
      {directory.map((profile) => (
        <label
          className={styles.attendeeOption}
          htmlFor={`${idPrefix}-${profile.id}`}
          key={profile.id}
        >
          <input
            defaultChecked={selectedIds.has(profile.id)}
            id={`${idPrefix}-${profile.id}`}
            name="attendeeProfileIds"
            type="checkbox"
            value={profile.id}
          />
          <span className={styles.attendeeName}>
            {profile.fullName}
            <span className={styles.attendeeRole}>{ROLE_LABELS[profile.role]}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function CreateMeetingForm({ directory }: { directory: MeetingDirectoryProfile[] }) {
  const [state, action] = useActionState(createMeetingAction, INITIAL_CRUD_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state.mutationId, state.status]);

  return (
    <form action={action} className={coreStyles.formGrid} ref={formRef} noValidate>
      <div className={coreStyles.field}>
        <label className={coreStyles.label} htmlFor="meeting-title">
          Meeting title
        </label>
        <input
          className={coreStyles.input}
          id="meeting-title"
          maxLength={200}
          name="title"
          required
        />
        <FieldError field="title" state={state} />
      </div>
      <div className={coreStyles.field}>
        <label className={coreStyles.label} htmlFor="meeting-location">
          Location
        </label>
        <input className={coreStyles.input} id="meeting-location" maxLength={300} name="location" />
        <FieldError field="location" state={state} />
      </div>
      <div className={coreStyles.field}>
        <label className={coreStyles.label} htmlFor="meeting-start">
          Starts
        </label>
        <input
          className={coreStyles.input}
          id="meeting-start"
          name="startsAt"
          required
          type="datetime-local"
        />
        <FieldError field="startsAt" state={state} />
      </div>
      <div className={coreStyles.field}>
        <label className={coreStyles.label} htmlFor="meeting-end">
          Ends
        </label>
        <input
          className={coreStyles.input}
          id="meeting-end"
          name="endsAt"
          required
          type="datetime-local"
        />
        <FieldError field="endsAt" state={state} />
      </div>
      <div className={coreStyles.fieldWide}>
        <label className={coreStyles.label} htmlFor="meeting-url">
          Meeting link
        </label>
        <input
          className={coreStyles.input}
          id="meeting-url"
          name="meetingUrl"
          placeholder="https://"
          type="url"
        />
        <FieldError field="meetingUrl" state={state} />
      </div>
      <div className={coreStyles.fieldWide}>
        <label className={coreStyles.label} htmlFor="meeting-reason">
          Agenda
        </label>
        <textarea
          className={coreStyles.textarea}
          id="meeting-reason"
          maxLength={4000}
          name="reason"
        />
        <FieldError field="reason" state={state} />
      </div>
      <fieldset className={styles.attendeeFieldset}>
        <legend className={styles.attendeeLegend}>Attendees</legend>
        <AttendeeChoices directory={directory} idPrefix="meeting-attendee" />
        <FieldError field="attendeeProfileIds" state={state} />
      </fieldset>
      <div className={coreStyles.actions}>
        <SubmitButton pendingLabel="Scheduling…">Schedule meeting</SubmitButton>
      </div>
      <PendingToast message="Scheduling meeting…" />
      <ActionFeedback state={state} />
    </form>
  );
}

function UpdateMeetingForm({
  directory,
  meeting,
}: {
  directory: MeetingDirectoryProfile[];
  meeting: MeetingRecord;
}) {
  const [state, action] = useActionState(updateMeetingAction, INITIAL_CRUD_ACTION_STATE);
  const selectedIds = new Set(meeting.attendees.map((attendee) => attendee.profileId));

  return (
    <form action={action} className={`${coreStyles.formGrid} ${coreStyles.detailsForm}`} noValidate>
      <input name="id" type="hidden" value={meeting.id} />
      <input name="expectedUpdatedAt" type="hidden" value={meeting.updatedAt} />
      <div className={coreStyles.field}>
        <label className={coreStyles.label} htmlFor={`meeting-title-${meeting.id}`}>
          Meeting title
        </label>
        <input
          className={coreStyles.input}
          defaultValue={meeting.title}
          id={`meeting-title-${meeting.id}`}
          maxLength={200}
          name="title"
          required
        />
        <FieldError field="title" state={state} />
      </div>
      <div className={coreStyles.field}>
        <label className={coreStyles.label} htmlFor={`meeting-location-${meeting.id}`}>
          Location
        </label>
        <input
          className={coreStyles.input}
          defaultValue={meeting.location ?? ""}
          id={`meeting-location-${meeting.id}`}
          maxLength={300}
          name="location"
        />
        <FieldError field="location" state={state} />
      </div>
      <div className={coreStyles.field}>
        <label className={coreStyles.label} htmlFor={`meeting-start-${meeting.id}`}>
          Starts
        </label>
        <input
          className={coreStyles.input}
          defaultValue={localDateTimeValue(meeting.startsAt)}
          id={`meeting-start-${meeting.id}`}
          name="startsAt"
          required
          type="datetime-local"
        />
        <FieldError field="startsAt" state={state} />
      </div>
      <div className={coreStyles.field}>
        <label className={coreStyles.label} htmlFor={`meeting-end-${meeting.id}`}>
          Ends
        </label>
        <input
          className={coreStyles.input}
          defaultValue={localDateTimeValue(meeting.endsAt)}
          id={`meeting-end-${meeting.id}`}
          name="endsAt"
          required
          type="datetime-local"
        />
        <FieldError field="endsAt" state={state} />
      </div>
      <div className={coreStyles.fieldWide}>
        <label className={coreStyles.label} htmlFor={`meeting-url-${meeting.id}`}>
          Meeting link
        </label>
        <input
          className={coreStyles.input}
          defaultValue={meeting.meetingUrl ?? ""}
          id={`meeting-url-${meeting.id}`}
          name="meetingUrl"
          placeholder="https://"
          type="url"
        />
        <FieldError field="meetingUrl" state={state} />
      </div>
      <div className={coreStyles.fieldWide}>
        <label className={coreStyles.label} htmlFor={`meeting-reason-${meeting.id}`}>
          Agenda
        </label>
        <textarea
          className={coreStyles.textarea}
          defaultValue={meeting.reason ?? ""}
          id={`meeting-reason-${meeting.id}`}
          maxLength={4000}
          name="reason"
        />
        <FieldError field="reason" state={state} />
      </div>
      <fieldset className={styles.attendeeFieldset}>
        <legend className={styles.attendeeLegend}>Attendees</legend>
        <AttendeeChoices
          directory={directory}
          idPrefix={`meeting-attendee-${meeting.id}`}
          selectedIds={selectedIds}
        />
        <FieldError field="attendeeProfileIds" state={state} />
      </fieldset>
      <div className={coreStyles.actions}>
        <SubmitButton pendingLabel="Saving meeting…">Save changes</SubmitButton>
      </div>
      <PendingToast message="Saving meeting…" />
      <ActionFeedback state={state} />
    </form>
  );
}

function MeetingStatusForm({ meeting }: { meeting: MeetingRecord }) {
  const [state, action] = useActionState(updateMeetingStatusAction, INITIAL_CRUD_ACTION_STATE);

  return (
    <>
      <form
        action={action}
        className={coreStyles.statusForm}
        onSubmit={(event) => {
          const status = new FormData(event.currentTarget).get("status");

          if (status === "cancelled" && !window.confirm("Cancel this meeting?")) {
            event.preventDefault();
          }
        }}
      >
        <input name="id" type="hidden" value={meeting.id} />
        <input name="expectedUpdatedAt" type="hidden" value={meeting.updatedAt} />
        <div className={coreStyles.field}>
          <label className={coreStyles.label} htmlFor={`meeting-status-${meeting.id}`}>
            Status
          </label>
          <select
            className={coreStyles.select}
            defaultValue={meeting.status}
            id={`meeting-status-${meeting.id}`}
            name="status"
          >
            {MEETING_STATUSES.map((status) => (
              <option key={status} value={status}>
                {MEETING_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton pendingLabel="Updating…" tone="secondary">
          Update status
        </SubmitButton>
        <PendingToast message="Updating meeting status…" />
      </form>
      <ActionFeedback state={state} />
    </>
  );
}

function DeleteMeetingForm({ meeting }: { meeting: MeetingRecord }) {
  const [state, action] = useActionState(deleteMeetingAction, INITIAL_CRUD_ACTION_STATE);

  return (
    <>
      <form
        action={action}
        className={coreStyles.inlineActions}
        onSubmit={(event) => {
          if (!window.confirm("Delete this meeting from the CRM?")) {
            event.preventDefault();
          }
        }}
      >
        <input name="id" type="hidden" value={meeting.id} />
        <input name="expectedUpdatedAt" type="hidden" value={meeting.updatedAt} />
        <SubmitButton pendingLabel="Deleting…" tone="danger">
          Delete meeting
        </SubmitButton>
        <PendingToast message="Deleting meeting…" />
      </form>
      <ActionFeedback state={state} />
    </>
  );
}

function MeetingItem({
  canEdit,
  data,
  meeting,
}: {
  canEdit: boolean;
  data: MeetingCrudData;
  meeting: MeetingRecord;
}) {
  return (
    <li className={coreStyles.record}>
      <div className={coreStyles.recordTop}>
        <div>
          <h3 className={coreStyles.recordTitle}>{meeting.title}</h3>
          <p className={coreStyles.recordSubtitle}>
            {formatDateTime(meeting.startsAt)}–{formatDateTime(meeting.endsAt)}
          </p>
        </div>
        <span className={coreStyles.badge}>{MEETING_STATUS_LABELS[meeting.status]}</span>
      </div>
      <dl className={coreStyles.metadata}>
        <div>
          <dt>Location</dt>
          <dd>{meeting.location ?? "Online / not specified"}</dd>
        </div>
        <div>
          <dt>Attendees</dt>
          <dd>{meeting.attendees.length}</dd>
        </div>
        <div>
          <dt>Your invitation</dt>
          <dd>
            {meeting.attendees.find((attendee) => attendee.profileId === data.viewerId)
              ?.attendanceStatus ??
              (meeting.createdByProfileId === data.viewerId ? "Organizer" : "—")}
          </dd>
        </div>
      </dl>
      {meeting.reason ? <p className={coreStyles.recordText}>{meeting.reason}</p> : null}
      <div className={styles.linkRow}>
        {meeting.meetingUrl ? (
          <a
            className={styles.meetingLink}
            href={meeting.meetingUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open meeting link
          </a>
        ) : null}
        <a
          className={styles.calendarLink}
          href={googleCalendarUrl(meeting)}
          rel="noreferrer"
          target="_blank"
        >
          Add to Google Calendar
        </a>
      </div>
      <p className={styles.helper}>
        Google Calendar creates a separate event; later CRM changes do not update that saved
        calendar event.
      </p>
      {canEdit ? (
        <>
          <MeetingStatusForm meeting={meeting} />
          <details className={coreStyles.details}>
            <summary>Edit meeting and attendees</summary>
            <UpdateMeetingForm directory={data.directory} meeting={meeting} />
          </details>
          <details className={coreStyles.details}>
            <summary>Delete meeting</summary>
            <DeleteMeetingForm meeting={meeting} />
          </details>
        </>
      ) : (
        <p className={styles.readOnlyNote}>
          You are an attendee. Only the organizer or an authorized manager can change this meeting.
        </p>
      )}
    </li>
  );
}

export function MeetingWorkspace({ data }: { data: MeetingCrudData }) {
  const isUpperAdmin = data.viewerRole === "director" || data.viewerRole === "manager";
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const filteredMeetings = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();

    if (!needle) {
      return data.meetings;
    }

    return data.meetings.filter((meeting) =>
      [meeting.title, meeting.reason, meeting.location, meeting.status, meeting.startsAt]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [data.meetings, search]);
  const pageCount = Math.max(1, Math.ceil(filteredMeetings.length / MEETINGS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const visibleMeetings = filteredMeetings.slice(
    (safePage - 1) * MEETINGS_PER_PAGE,
    safePage * MEETINGS_PER_PAGE,
  );

  return (
    <div className={coreStyles.panel}>
      {data.canCreate ? (
        <section className={coreStyles.section}>
          <div className={coreStyles.sectionHeader}>
            <div>
              <h2>Schedule meeting</h2>
              <p>Create a meeting and invite active team members within your branch.</p>
            </div>
          </div>
          <CreateMeetingForm directory={data.directory} />
        </section>
      ) : null}

      <section className={coreStyles.section}>
        <div className={coreStyles.sectionHeader}>
          <div>
            <h2>Meetings</h2>
            <p>Upcoming scheduled meetings visible to you through Supabase RLS.</p>
          </div>
          <span className={coreStyles.count}>{filteredMeetings.length}</span>
        </div>
        <div className={coreStyles.tableToolbar}>
          <label className={coreStyles.searchControl}>
            <Search aria-hidden="true" size={17} />
            <input
              aria-label="Search upcoming meetings"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search title, location, or agenda…"
              type="search"
              value={search}
            />
          </label>
          <span className={coreStyles.resultSummary}>{filteredMeetings.length} upcoming</span>
        </div>
        {visibleMeetings.length === 0 ? (
          <EmptyState
            title="No upcoming meetings"
            message={
              search
                ? "No upcoming meetings match your search."
                : "New meetings you organize or are invited to will appear here."
            }
          />
        ) : (
          <ul className={coreStyles.recordList}>
            {visibleMeetings.map((meeting) => (
              <MeetingItem
                canEdit={isUpperAdmin || meeting.createdByProfileId === data.viewerId}
                data={data}
                key={meeting.id}
                meeting={meeting}
              />
            ))}
          </ul>
        )}
        <div className={coreStyles.pagination}>
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
