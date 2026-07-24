"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import {
  ActionFeedback,
  FieldError,
  SubmitButton,
  formatDateTime,
  toIndiaDateTimeLocal,
} from "@/features/core-crud/components/shared";
import { INITIAL_CRUD_ACTION_STATE } from "@/features/core-crud/types";

import {
  addLeadNoteAction,
  assignLeadAction,
  createFollowUpAction,
  logSalesCallAction,
  updateFollowUpAction,
} from "./actions";
import styles from "./sales-operations.module.css";
import {
  CALL_DIRECTIONS,
  CALL_STATUSES,
  FOLLOW_UP_STATUSES,
  type FollowUpRecord,
  type SalesLeadSummary,
  type SalesOperationsData,
  type SalesOperationsMode,
} from "./types";

const STATUS_LABELS: Record<(typeof FOLLOW_UP_STATUSES)[number], string> = {
  open: "Open",
  completed: "Completed",
  cancelled: "Cancelled",
  overdue: "Overdue",
};

const CALL_STATUS_LABELS: Record<(typeof CALL_STATUSES)[number], string> = {
  completed: "Completed",
  no_answer: "No answer",
  busy: "Busy",
  failed: "Failed",
  missed: "Missed",
};

const RECORDS_PER_PAGE = 10;

function useRecordPagination<T>(records: T[], searchText: (record: T) => string) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredRecords = useMemo(
    () =>
      normalizedSearch
        ? records.filter((record) =>
            searchText(record).toLocaleLowerCase().includes(normalizedSearch),
          )
        : records,
    [normalizedSearch, records, searchText],
  );
  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / RECORDS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const pageRecords = filteredRecords.slice(
    (safePage - 1) * RECORDS_PER_PAGE,
    safePage * RECORDS_PER_PAGE,
  );

  return {
    filteredTotal: filteredRecords.length,
    page: safePage,
    pageCount,
    pageRecords,
    search,
    setPage,
    setSearch: (value: string) => {
      setSearch(value);
      setPage(1);
    },
  };
}

function RecordListToolbar({
  noun,
  search,
  setSearch,
  total,
}: {
  noun: string;
  search: string;
  setSearch: (search: string) => void;
  total: number;
}) {
  return (
    <div className={styles.listToolbar}>
      <label className={styles.searchControl}>
        <Search aria-hidden="true" size={18} />
        <span className={styles.srOnly}>Search {noun}</span>
        <input
          onChange={(event) => setSearch(event.target.value)}
          placeholder={`Search ${noun}…`}
          type="search"
          value={search}
        />
      </label>
      <span className={styles.resultSummary}>
        {total} {noun}
      </span>
    </div>
  );
}

function RecordPagination({
  page,
  pageCount,
  setPage,
}: {
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
}) {
  return (
    <div className={styles.pagination}>
      <span>
        Page {page} of {pageCount}
      </span>
      <div className={styles.paginationActions}>
        <button disabled={page <= 1} onClick={() => setPage(page - 1)} type="button">
          <ChevronLeft aria-hidden="true" size={16} />
          Previous
        </button>
        <button disabled={page >= pageCount} onClick={() => setPage(page + 1)} type="button">
          Next
          <ChevronRight aria-hidden="true" size={16} />
        </button>
      </div>
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div className={styles.empty}>
      <strong>No records yet</strong>
      <p>{message}</p>
    </div>
  );
}

function ResettableForm({
  action,
  children,
  className,
}: {
  action: (
    previousState: typeof INITIAL_CRUD_ACTION_STATE,
    formData: FormData,
  ) => Promise<typeof INITIAL_CRUD_ACTION_STATE>;
  children: (state: typeof INITIAL_CRUD_ACTION_STATE) => React.ReactNode;
  className: string;
}) {
  const [state, formAction] = useActionState(action, INITIAL_CRUD_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state.mutationId, state.status]);

  return (
    <form action={formAction} className={className} ref={formRef} noValidate>
      {children(state)}
    </form>
  );
}

function AssignmentForm({ data, lead }: { data: SalesOperationsData; lead: SalesLeadSummary }) {
  const [state, action] = useActionState(assignLeadAction, INITIAL_CRUD_ACTION_STATE);

  return (
    <form action={action} className={styles.compactForm} noValidate>
      <input name="leadId" type="hidden" value={lead.id} />
      <input name="expectedVersion" type="hidden" value={lead.version} />
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`assign-profile-${lead.id}`}>
          Sales Member
        </label>
        <select
          className={styles.select}
          defaultValue={lead.assignedSalesProfileId ?? ""}
          id={`assign-profile-${lead.id}`}
          name="assignedSalesProfileId"
        >
          <option value="">Unassigned queue</option>
          {data.salesProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.fullName}
            </option>
          ))}
        </select>
        <FieldError field="assignedSalesProfileId" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`assign-reason-${lead.id}`}>
          Reason
        </label>
        <input
          className={styles.input}
          id={`assign-reason-${lead.id}`}
          maxLength={500}
          name="reason"
          placeholder="Queue allocation or reassignment reason"
          required
        />
        <FieldError field="reason" state={state} />
      </div>
      <div className={styles.actions}>
        <SubmitButton pendingLabel="Assigning…">Save assignment</SubmitButton>
      </div>
      <ActionFeedback state={state} />
    </form>
  );
}

function AssignmentWorkspace({ data }: { data: SalesOperationsData }) {
  const profileNames = new Map(data.salesProfiles.map((profile) => [profile.id, profile.fullName]));
  const pagination = useRecordPagination(
    data.leads,
    (lead) =>
      `${lead.clientName} ${lead.phoneE164} ${lead.status} ${
        lead.assignedSalesProfileId
          ? (profileNames.get(lead.assignedSalesProfileId) ?? "sales member")
          : "unassigned"
      }`,
  );

  return (
    <section className={styles.card}>
      <div className={styles.header}>
        <div>
          <h2>Lead assignment queue</h2>
          <p>Assignments update the lead, linked conversations, history, and notifications once.</p>
        </div>
        <span className={styles.count}>{pagination.filteredTotal}</span>
      </div>
      <RecordListToolbar
        noun="leads"
        search={pagination.search}
        setSearch={pagination.setSearch}
        total={pagination.filteredTotal}
      />
      {pagination.pageRecords.length === 0 ? (
        <Empty message="New manual or provider leads will appear here." />
      ) : (
        <ul className={styles.records}>
          {pagination.pageRecords.map((lead) => (
            <li className={styles.record} key={lead.id}>
              <div className={styles.recordHeader}>
                <div>
                  <h3>{lead.clientName}</h3>
                  <p>{lead.phoneE164}</p>
                </div>
                <span className={styles.badge}>{lead.status.replaceAll("_", " ")}</span>
              </div>
              <dl className={styles.meta}>
                <div>
                  <dt>Current owner</dt>
                  <dd>
                    {lead.assignedSalesProfileId
                      ? (profileNames.get(lead.assignedSalesProfileId) ?? "Sales Member")
                      : "Unassigned"}
                  </dd>
                </div>
                <div>
                  <dt>Record version</dt>
                  <dd>{lead.version}</dd>
                </div>
              </dl>
              <AssignmentForm data={data} lead={lead} />
            </li>
          ))}
        </ul>
      )}
      <RecordPagination
        page={pagination.page}
        pageCount={pagination.pageCount}
        setPage={pagination.setPage}
      />
    </section>
  );
}

function CreateFollowUpForm({ data }: { data: SalesOperationsData }) {
  const assignedLeads = data.leads.filter((lead) => lead.assignedSalesProfileId);

  if (assignedLeads.length === 0) {
    return (
      <Empty message="Assign a lead to an active Sales Member before scheduling a follow-up." />
    );
  }

  return (
    <ResettableForm action={createFollowUpAction} className={styles.form!}>
      {(state) => (
        <>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="follow-up-lead">
              Lead
            </label>
            <select className={styles.select} id="follow-up-lead" name="leadId" required>
              <option value="">Choose a lead</option>
              {assignedLeads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.clientName} · {lead.phoneE164}
                </option>
              ))}
            </select>
            <FieldError field="leadId" state={state} />
          </div>
          <input name="assignedProfileId" type="hidden" value="" />
          <div className={styles.field}>
            <label className={styles.label} htmlFor="follow-up-due">
              Due date and time
            </label>
            <input
              className={styles.input}
              id="follow-up-due"
              name="dueAt"
              type="datetime-local"
              required
            />
            <FieldError field="dueAt" state={state} />
          </div>
          <div className={styles.actions}>
            <SubmitButton pendingLabel="Scheduling…">Schedule follow-up</SubmitButton>
          </div>
          <ActionFeedback state={state} />
        </>
      )}
    </ResettableForm>
  );
}

function FollowUpForm({ followUp, leadName }: { followUp: FollowUpRecord; leadName: string }) {
  const [state, action] = useActionState(updateFollowUpAction, INITIAL_CRUD_ACTION_STATE);
  const overdue = followUp.isOverdue;

  return (
    <li className={styles.record}>
      <div className={styles.recordHeader}>
        <div>
          <h3>{leadName}</h3>
          <p>Due {formatDateTime(followUp.dueAt)}</p>
        </div>
        <span className={overdue ? styles.overdueBadge : styles.badge}>
          {overdue ? "Overdue" : STATUS_LABELS[followUp.status]}
        </span>
      </div>
      <form action={action} className={styles.compactForm} noValidate>
        <input name="followUpId" type="hidden" value={followUp.id} />
        <input name="expectedUpdatedAt" type="hidden" value={followUp.updatedAt} />
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`follow-up-due-${followUp.id}`}>
            Due
          </label>
          <input
            className={styles.input}
            defaultValue={toIndiaDateTimeLocal(followUp.dueAt)}
            id={`follow-up-due-${followUp.id}`}
            name="dueAt"
            type="datetime-local"
          />
          <FieldError field="dueAt" state={state} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`follow-up-status-${followUp.id}`}>
            Status
          </label>
          <select
            className={styles.select}
            defaultValue={followUp.status}
            id={`follow-up-status-${followUp.id}`}
            name="status"
          >
            {FOLLOW_UP_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          <FieldError field="status" state={state} />
        </div>
        <div className={styles.wide}>
          <label className={styles.label} htmlFor={`follow-up-outcome-${followUp.id}`}>
            Outcome / cancellation reason
          </label>
          <textarea
            className={styles.textarea}
            defaultValue={followUp.outcome ?? ""}
            id={`follow-up-outcome-${followUp.id}`}
            name="outcome"
          />
          <FieldError field="outcome" state={state} />
        </div>
        <div className={styles.actions}>
          <SubmitButton pendingLabel="Saving…">Save follow-up</SubmitButton>
        </div>
        <ActionFeedback state={state} />
      </form>
    </li>
  );
}

function FollowUpWorkspace({ data }: { data: SalesOperationsData }) {
  const leadNames = new Map(data.leads.map((lead) => [lead.id, lead.clientName]));
  const pagination = useRecordPagination(
    data.followUps,
    (followUp) =>
      `${leadNames.get(followUp.leadId) ?? "lead"} ${followUp.status} ${followUp.outcome ?? ""} ${
        followUp.dueAt
      }`,
  );
  return (
    <div className={styles.workspace}>
      <section className={styles.card}>
        <div className={styles.header}>
          <div>
            <h2>Schedule follow-up</h2>
            <p>The assigned Sales Member receives the due item in their own queue.</p>
          </div>
        </div>
        <CreateFollowUpForm data={data} />
      </section>
      <section className={styles.card}>
        <div className={styles.header}>
          <div>
            <h2>Follow-up queue</h2>
            <p>Complete, reschedule, or cancel follow-ups with a retained outcome.</p>
          </div>
          <span className={styles.count}>{pagination.filteredTotal}</span>
        </div>
        <RecordListToolbar
          noun="follow-ups"
          search={pagination.search}
          setSearch={pagination.setSearch}
          total={pagination.filteredTotal}
        />
        {pagination.pageRecords.length === 0 ? (
          <Empty message="Schedule the first follow-up above." />
        ) : (
          <ul className={styles.records}>
            {pagination.pageRecords.map((followUp) => (
              <FollowUpForm
                followUp={followUp}
                key={followUp.id}
                leadName={leadNames.get(followUp.leadId) ?? "Lead"}
              />
            ))}
          </ul>
        )}
        <RecordPagination
          page={pagination.page}
          pageCount={pagination.pageCount}
          setPage={pagination.setPage}
        />
      </section>
    </div>
  );
}

function CallForm({
  compact = false,
  data,
  selectedLeadId,
}: {
  compact?: boolean;
  data: SalesOperationsData;
  selectedLeadId?: string;
}) {
  return (
    <ResettableForm
      action={logSalesCallAction}
      className={compact ? styles.compactForm! : styles.form!}
    >
      {(state) => (
        <>
          {selectedLeadId ? (
            <input name="leadId" type="hidden" value={selectedLeadId} />
          ) : (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="call-lead">
                Lead
              </label>
              <select className={styles.select} id="call-lead" name="leadId" required>
                <option value="">Choose a lead</option>
                {data.leads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.clientName} · {lead.phoneE164}
                  </option>
                ))}
              </select>
              <FieldError field="leadId" state={state} />
            </div>
          )}
          <input name="conversationId" type="hidden" value="" />
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`call-direction-${selectedLeadId ?? "new"}`}>
              Direction
            </label>
            <select
              className={styles.select}
              id={`call-direction-${selectedLeadId ?? "new"}`}
              name="direction"
            >
              {CALL_DIRECTIONS.map((direction) => (
                <option key={direction} value={direction}>
                  {direction === "outbound" ? "Outbound" : "Inbound"}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`call-status-${selectedLeadId ?? "new"}`}>
              Outcome status
            </label>
            <select
              className={styles.select}
              id={`call-status-${selectedLeadId ?? "new"}`}
              name="status"
            >
              {CALL_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {CALL_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`call-start-${selectedLeadId ?? "new"}`}>
              Started
            </label>
            <input
              className={styles.input}
              defaultValue={toIndiaDateTimeLocal(new Date().toISOString())}
              id={`call-start-${selectedLeadId ?? "new"}`}
              name="startedAt"
              type="datetime-local"
            />
            <FieldError field="startedAt" state={state} />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`call-duration-${selectedLeadId ?? "new"}`}>
              Duration seconds
            </label>
            <input
              className={styles.input}
              defaultValue="0"
              id={`call-duration-${selectedLeadId ?? "new"}`}
              min={0}
              name="durationSeconds"
              type="number"
            />
            <FieldError field="durationSeconds" state={state} />
          </div>
          <div className={styles.wide}>
            <label className={styles.label} htmlFor={`call-outcome-${selectedLeadId ?? "new"}`}>
              Outcome notes
            </label>
            <textarea
              className={styles.textarea}
              id={`call-outcome-${selectedLeadId ?? "new"}`}
              name="outcome"
            />
            <FieldError field="outcome" state={state} />
          </div>
          <div className={styles.actions}>
            <SubmitButton pendingLabel="Logging call…">Log call</SubmitButton>
          </div>
          <ActionFeedback state={state} />
        </>
      )}
    </ResettableForm>
  );
}

function CallWorkspace({ data }: { data: SalesOperationsData }) {
  const leadNames = new Map(data.leads.map((lead) => [lead.id, lead.clientName]));
  const pagination = useRecordPagination(
    data.calls,
    (call) =>
      `${leadNames.get(call.leadId) ?? "lead"} ${call.direction} ${call.status} ${call.startedAt}`,
  );
  return (
    <div className={styles.workspace}>
      <section className={styles.card}>
        <div className={styles.header}>
          <div>
            <h2>Log customer call</h2>
            <p>Use this for calls completed outside provider-backed click-to-call.</p>
          </div>
        </div>
        <CallForm data={data} />
      </section>
      <section className={styles.card}>
        <div className={styles.header}>
          <div>
            <h2>Call history</h2>
            <p>Manual and provider-ingested call records visible to your role.</p>
          </div>
          <span className={styles.count}>{pagination.filteredTotal}</span>
        </div>
        <RecordListToolbar
          noun="calls"
          search={pagination.search}
          setSearch={pagination.setSearch}
          total={pagination.filteredTotal}
        />
        {pagination.pageRecords.length === 0 ? (
          <Empty message="Log a completed customer call above." />
        ) : (
          <ul className={styles.records}>
            {pagination.pageRecords.map((call) => (
              <li className={styles.record} key={call.id}>
                <div className={styles.recordHeader}>
                  <div>
                    <h3>{leadNames.get(call.leadId) ?? "Lead"}</h3>
                    <p>{formatDateTime(call.startedAt)}</p>
                  </div>
                  <span className={styles.badge}>{call.status.replaceAll("_", " ")}</span>
                </div>
                <dl className={styles.meta}>
                  <div>
                    <dt>Direction</dt>
                    <dd>{call.direction}</dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>{call.durationSeconds ?? 0} sec</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
        <RecordPagination
          page={pagination.page}
          pageCount={pagination.pageCount}
          setPage={pagination.setPage}
        />
      </section>
    </div>
  );
}

function LeadNoteForm({ leadId }: { leadId: string }) {
  return (
    <ResettableForm action={addLeadNoteAction} className={styles.compactForm!}>
      {(state) => (
        <>
          <input name="leadId" type="hidden" value={leadId} />
          <div className={styles.wide}>
            <label className={styles.label} htmlFor={`lead-note-${leadId}`}>
              Internal note
            </label>
            <textarea className={styles.textarea} id={`lead-note-${leadId}`} name="note" required />
            <FieldError field="note" state={state} />
          </div>
          <div className={styles.actions}>
            <SubmitButton pendingLabel="Adding note…">Add internal note</SubmitButton>
          </div>
          <ActionFeedback state={state} />
        </>
      )}
    </ResettableForm>
  );
}

function ActivityWorkspace({ data }: { data: SalesOperationsData }) {
  const pagination = useRecordPagination(
    data.leads,
    (lead) => `${lead.clientName} ${lead.phoneE164} ${lead.status}`,
  );

  return (
    <section className={styles.card}>
      <div className={styles.header}>
        <div>
          <h2>Lead activity tools</h2>
          <p>Internal notes and manual call outcomes append to the immutable lead timeline.</p>
        </div>
        <span className={styles.count}>{pagination.filteredTotal}</span>
      </div>
      <RecordListToolbar
        noun="leads"
        search={pagination.search}
        setSearch={pagination.setSearch}
        total={pagination.filteredTotal}
      />
      {pagination.pageRecords.length === 0 ? (
        <Empty message="Assigned leads will appear here." />
      ) : (
        <ul className={styles.records}>
          {pagination.pageRecords.map((lead) => (
            <li className={styles.record} key={lead.id}>
              <div className={styles.recordHeader}>
                <div>
                  <h3>{lead.clientName}</h3>
                  <p>{lead.phoneE164}</p>
                </div>
                <span className={styles.badge}>{lead.status.replaceAll("_", " ")}</span>
              </div>
              <details>
                <summary className={styles.summary}>Add internal note</summary>
                <LeadNoteForm leadId={lead.id} />
              </details>
              <details>
                <summary className={styles.summary}>Log call outcome</summary>
                <CallForm compact data={data} selectedLeadId={lead.id} />
              </details>
            </li>
          ))}
        </ul>
      )}
      <RecordPagination
        page={pagination.page}
        pageCount={pagination.pageCount}
        setPage={pagination.setPage}
      />
    </section>
  );
}

export function SalesOperationsWorkspace({
  data,
  mode,
}: {
  data: SalesOperationsData;
  mode: SalesOperationsMode;
}) {
  switch (mode) {
    case "assignment":
      return <AssignmentWorkspace data={data} />;
    case "follow_ups":
      return <FollowUpWorkspace data={data} />;
    case "calls":
      return <CallWorkspace data={data} />;
    case "activity":
      return <ActivityWorkspace data={data} />;
    case "overview":
      return <OverviewWorkspace data={data} />;
  }
}

const OVERVIEW_TABS = [
  { id: "assignment", label: "Assignment" },
  { id: "follow_ups", label: "Follow-ups" },
  { id: "calls", label: "Calls" },
  { id: "activity", label: "Activity" },
] as const;

type OverviewTab = (typeof OVERVIEW_TABS)[number]["id"];

function OverviewWorkspace({ data }: { data: SalesOperationsData }) {
  const [activeTab, setActiveTab] = useState<OverviewTab>("assignment");

  return (
    <div className={styles.tabbedWorkspace}>
      <div aria-label="Lead workflow sections" className={styles.tabs} role="tablist">
        {OVERVIEW_TABS.map((tab) => (
          <button
            aria-controls={`lead-panel-${tab.id}`}
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? styles.activeTab : styles.tab}
            id={`lead-tab-${tab.id}`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div aria-labelledby={`lead-tab-${activeTab}`} id={`lead-panel-${activeTab}`} role="tabpanel">
        {activeTab === "assignment" ? <AssignmentWorkspace data={data} /> : null}
        {activeTab === "follow_ups" ? <FollowUpWorkspace data={data} /> : null}
        {activeTab === "calls" ? <CallWorkspace data={data} /> : null}
        {activeTab === "activity" ? <ActivityWorkspace data={data} /> : null}
      </div>
    </div>
  );
}
