"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Plus, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { createLeadAction, updateLeadAction, updateLeadStatusAction } from "../actions";
import styles from "../core-crud.module.css";
import {
  INITIAL_CRUD_ACTION_STATE,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  type LeadCrudData,
  type LeadRecord,
} from "../types";
import {
  ActionFeedback,
  EmptyState,
  FieldError,
  formatDate,
  formatDateTime,
  formatMoney,
  SubmitButton,
} from "./shared";

function CreateLeadForm({ data, onCreated }: { data: LeadCrudData; onCreated: () => void }) {
  const [state, action] = useActionState(createLeadAction, INITIAL_CRUD_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      onCreated();
    }
  }, [onCreated, state.mutationId, state.status]);

  return (
    <form action={action} className={styles.formGrid} ref={formRef} noValidate>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="lead-client-name">
          Customer name
        </label>
        <input
          className={styles.input}
          id="lead-client-name"
          name="clientName"
          maxLength={160}
          required
        />
        <FieldError field="clientName" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="lead-phone">
          Phone
        </label>
        <input
          className={styles.input}
          id="lead-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          placeholder="+91 98765 43210"
          required
        />
        <FieldError field="phone" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="lead-source">
          Source
        </label>
        <input
          className={styles.input}
          id="lead-source"
          name="source"
          maxLength={120}
          placeholder="Manual, referral, website…"
        />
        <FieldError field="source" state={state} />
      </div>
      {data.viewerRole !== "sales" ? (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="lead-assignee">
            Assign to
          </label>
          <select className={styles.select} id="lead-assignee" name="assignedSalesProfileId">
            <option value="">Unassigned</option>
            {data.salesAssignees.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.fullName}
              </option>
            ))}
          </select>
          <FieldError field="assignedSalesProfileId" state={state} />
        </div>
      ) : null}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="lead-event-date">
          Event date
        </label>
        <input className={styles.input} id="lead-event-date" name="eventDate" type="date" />
        <FieldError field="eventDate" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="lead-guests">
          Guest count
        </label>
        <input
          className={styles.input}
          id="lead-guests"
          name="guestCount"
          type="number"
          min={1}
          inputMode="numeric"
        />
        <FieldError field="guestCount" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="lead-quote">
          Quote amount
        </label>
        <input
          className={styles.input}
          id="lead-quote"
          name="quoteAmount"
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
        />
        <FieldError field="quoteAmount" state={state} />
      </div>
      <div className={styles.fieldWide}>
        <label className={styles.label} htmlFor="lead-requirement">
          Requirement
        </label>
        <textarea
          className={styles.textarea}
          id="lead-requirement"
          name="requirement"
          maxLength={4000}
        />
        <FieldError field="requirement" state={state} />
      </div>
      <div className={styles.fieldWide}>
        <label className={styles.label} htmlFor="lead-notes">
          Internal notes
        </label>
        <textarea className={styles.textarea} id="lead-notes" name="notes" maxLength={4000} />
        <FieldError field="notes" state={state} />
      </div>
      <div className={styles.actions}>
        <SubmitButton pendingLabel="Creating lead…">Create lead</SubmitButton>
      </div>
      <div className={styles.fieldWide}>
        <ActionFeedback state={state} />
      </div>
    </form>
  );
}

function LeadStatusForm({ lead }: { lead: LeadRecord }) {
  const [state, action] = useActionState(updateLeadStatusAction, INITIAL_CRUD_ACTION_STATE);

  return (
    <>
      <form action={action} className={styles.statusForm}>
        <input name="id" type="hidden" value={lead.id} />
        <input name="expectedVersion" type="hidden" value={lead.version} />
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`lead-status-${lead.id}`}>
            Status
          </label>
          <select
            className={styles.select}
            defaultValue={lead.status}
            id={`lead-status-${lead.id}`}
            name="status"
          >
            {LEAD_STATUSES.map((status) => (
              <option key={status} value={status}>
                {LEAD_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton pendingLabel="Updating…" tone="secondary">
          Update status
        </SubmitButton>
      </form>
      <ActionFeedback state={state} />
    </>
  );
}

function UpdateLeadForm({ lead }: { lead: LeadRecord }) {
  const [state, action] = useActionState(updateLeadAction, INITIAL_CRUD_ACTION_STATE);

  return (
    <form action={action} className={`${styles.formGrid} ${styles.detailsForm}`} noValidate>
      <input name="id" type="hidden" value={lead.id} />
      <input name="expectedVersion" type="hidden" value={lead.version} />
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`lead-name-${lead.id}`}>
          Customer name
        </label>
        <input
          className={styles.input}
          defaultValue={lead.clientName}
          id={`lead-name-${lead.id}`}
          name="clientName"
          required
        />
        <FieldError field="clientName" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`lead-phone-${lead.id}`}>
          Phone
        </label>
        <input
          className={styles.input}
          defaultValue={lead.phoneE164}
          id={`lead-phone-${lead.id}`}
          name="phone"
          type="tel"
          required
        />
        <FieldError field="phone" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`lead-date-${lead.id}`}>
          Event date
        </label>
        <input
          className={styles.input}
          defaultValue={lead.eventDate ?? ""}
          id={`lead-date-${lead.id}`}
          name="eventDate"
          type="date"
        />
        <FieldError field="eventDate" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`lead-guests-${lead.id}`}>
          Guest count
        </label>
        <input
          className={styles.input}
          defaultValue={lead.guestCount ?? ""}
          id={`lead-guests-${lead.id}`}
          name="guestCount"
          type="number"
          min={1}
        />
        <FieldError field="guestCount" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`lead-quote-${lead.id}`}>
          Quote amount
        </label>
        <input
          className={styles.input}
          defaultValue={lead.quoteAmount ?? ""}
          id={`lead-quote-${lead.id}`}
          name="quoteAmount"
          type="number"
          min={0}
          step="0.01"
        />
        <FieldError field="quoteAmount" state={state} />
      </div>
      <div className={styles.fieldWide}>
        <label className={styles.label} htmlFor={`lead-requirement-${lead.id}`}>
          Requirement
        </label>
        <textarea
          className={styles.textarea}
          defaultValue={lead.requirement ?? ""}
          id={`lead-requirement-${lead.id}`}
          name="requirement"
        />
        <FieldError field="requirement" state={state} />
      </div>
      <div className={styles.fieldWide}>
        <label className={styles.label} htmlFor={`lead-notes-${lead.id}`}>
          Internal notes
        </label>
        <textarea
          className={styles.textarea}
          defaultValue={lead.notes ?? ""}
          id={`lead-notes-${lead.id}`}
          name="notes"
        />
        <FieldError field="notes" state={state} />
      </div>
      <div className={styles.actions}>
        <SubmitButton pendingLabel="Saving lead…">Save changes</SubmitButton>
      </div>
      <div className={styles.fieldWide}>
        <ActionFeedback state={state} />
      </div>
    </form>
  );
}

function LeadItem({ assigneeName, lead }: { assigneeName: string; lead: LeadRecord }) {
  return (
    <div className={styles.record}>
      <div className={styles.recordTop}>
        <div>
          <h3 className={styles.recordTitle}>{lead.clientName}</h3>
          <p className={styles.recordSubtitle}>{lead.phoneE164}</p>
        </div>
        <span className={styles.badge}>{LEAD_STATUS_LABELS[lead.status]}</span>
      </div>
      <dl className={styles.metadata}>
        <div>
          <dt>Event</dt>
          <dd>{formatDate(lead.eventDate)}</dd>
        </div>
        <div>
          <dt>Quote</dt>
          <dd className={styles.mono}>{formatMoney(lead.quoteAmount)}</dd>
        </div>
        <div>
          <dt>Assigned to</dt>
          <dd>{assigneeName}</dd>
        </div>
        <div>
          <dt>Guests</dt>
          <dd className={styles.mono}>{lead.guestCount ?? "—"}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{lead.source ?? "Manual"}</dd>
        </div>
        <div>
          <dt>Follow-up</dt>
          <dd>{formatDateTime(lead.nextFollowUpAt)}</dd>
        </div>
      </dl>
      {lead.requirement ? <p className={styles.recordText}>{lead.requirement}</p> : null}
      <LeadStatusForm lead={lead} />
      <details className={styles.details}>
        <summary>Edit lead details</summary>
        <UpdateLeadForm lead={lead} />
      </details>
    </div>
  );
}

export function LeadWorkspace({ data }: { data: LeadCrudData }) {
  const pathname = usePathname();
  const router = useRouter();
  const currentSearchParams = useSearchParams();
  const createDialogRef = useRef<HTMLDialogElement>(null);
  const detailsDialogRef = useRef<HTMLDialogElement>(null);
  const [searchInput, setSearchInput] = useState(data.search);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [selectedLead, setSelectedLead] = useState<LeadRecord | null>(null);
  const [isNavigating, startNavigation] = useTransition();
  const assigneeNames = useMemo(
    () => new Map(data.salesAssignees.map((profile) => [profile.id, profile.fullName])),
    [data.salesAssignees],
  );
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));

  const navigate = (updates: { page?: number; search?: string }) => {
    const params = new URLSearchParams(currentSearchParams.toString());
    if (updates.search !== undefined) {
      const value = updates.search.trim();
      if (value) {
        params.set("leadSearch", value);
      } else {
        params.delete("leadSearch");
      }
      params.delete("leadPage");
    }
    if (updates.page !== undefined) {
      if (updates.page > 1) {
        params.set("leadPage", String(updates.page));
      } else {
        params.delete("leadPage");
      }
    }
    startNavigation(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  };

  useEffect(() => {
    if (searchInput.trim() === data.search) {
      return;
    }
    const timer = window.setTimeout(() => navigate({ search: searchInput }), 350);
    return () => window.clearTimeout(timer);
    // Navigation helpers intentionally track the current URL through the values below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.search, pathname, searchInput]);

  useEffect(() => {
    if (selectedLead) {
      detailsDialogRef.current?.showModal();
    }
  }, [selectedLead]);

  const columns = useMemo<ColumnDef<LeadRecord>[]>(
    () => [
      {
        accessorKey: "clientName",
        header: "Customer",
        cell: ({ row }) => (
          <div>
            <strong>{row.original.clientName}</strong>
            <small>{row.original.phoneE164}</small>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <span className={styles.badge}>{LEAD_STATUS_LABELS[row.original.status]}</span>
        ),
      },
      {
        accessorKey: "eventDate",
        header: "Event",
        cell: ({ row }) => formatDate(row.original.eventDate),
      },
      {
        accessorKey: "quoteAmount",
        header: "Quote",
        cell: ({ row }) => (
          <span className={styles.mono}>{formatMoney(row.original.quoteAmount)}</span>
        ),
      },
      {
        id: "owner",
        header: "Owner",
        cell: ({ row }) =>
          row.original.assignedSalesProfileId
            ? (assigneeNames.get(row.original.assignedSalesProfileId) ?? "Sales Member")
            : "Unassigned",
      },
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        cell: ({ row }) => (
          <button
            className={styles.tableAction}
            onClick={() => setSelectedLead(row.original)}
            type="button"
          >
            View / edit
          </button>
        ),
      },
    ],
    [assigneeNames],
  );
  // TanStack Table intentionally returns stateful functions from this hook.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    columns,
    data: data.leads,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Leads</h2>
            <p>Search, review, and update RLS-scoped lead records.</p>
          </div>
          <button
            className={styles.button}
            onClick={() => createDialogRef.current?.showModal()}
            type="button"
          >
            <Plus aria-hidden="true" size={17} />
            Create lead
          </button>
        </div>
        <div className={styles.tableToolbar}>
          <label className={styles.searchControl}>
            <Search aria-hidden="true" size={18} />
            <span className={styles.srOnly}>Search leads</span>
            <input
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search name, phone, or source…"
              type="search"
              value={searchInput}
            />
          </label>
          <span className={styles.resultSummary} aria-live="polite">
            {isNavigating ? "Searching…" : `${data.total} lead${data.total === 1 ? "" : "s"}`}
          </span>
        </div>
        {data.leads.length === 0 ? (
          <EmptyState
            title="No leads yet"
            message={
              data.search
                ? "No leads match this search. Try a different name, phone, or source."
                : "Create the first lead. It will be available to the permitted sales team."
            }
          />
        ) : (
          <div className={styles.leadTableWrap}>
            <table className={styles.leadTable}>
              <thead>
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => (
                      <th key={header.id}>
                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                          <button onClick={header.column.getToggleSortingHandler()} type="button">
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <span aria-hidden="true">
                              {header.column.getIsSorted() === "asc"
                                ? " ↑"
                                : header.column.getIsSorted() === "desc"
                                  ? " ↓"
                                  : " ↕"}
                            </span>
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className={styles.pagination}>
          <span>
            Page {Math.min(data.page, pageCount)} of {pageCount}
          </span>
          <div>
            <button
              aria-label="Previous page"
              disabled={data.page <= 1 || isNavigating}
              onClick={() => navigate({ page: data.page - 1 })}
              type="button"
            >
              <ChevronLeft aria-hidden="true" size={18} />
              Previous
            </button>
            <button
              aria-label="Next page"
              disabled={data.page >= pageCount || isNavigating}
              onClick={() => navigate({ page: data.page + 1 })}
              type="button"
            >
              Next
              <ChevronRight aria-hidden="true" size={18} />
            </button>
          </div>
        </div>
      </section>

      <dialog className={styles.crudDialog} ref={createDialogRef}>
        <div className={styles.dialogHeader}>
          <div>
            <h2>Create lead</h2>
            <p>Add a manual lead to the shared sales queue.</p>
          </div>
          <button
            aria-label="Close create lead"
            onClick={() => createDialogRef.current?.close()}
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        <CreateLeadForm data={data} onCreated={() => createDialogRef.current?.close()} />
      </dialog>

      <dialog
        className={styles.crudDialog}
        onClose={() => setSelectedLead(null)}
        ref={detailsDialogRef}
      >
        <div className={styles.dialogHeader}>
          <div>
            <h2>Lead details</h2>
            <p>Review status and update customer requirements.</p>
          </div>
          <button
            aria-label="Close lead details"
            onClick={() => detailsDialogRef.current?.close()}
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        {selectedLead ? (
          <LeadItem
            assigneeName={
              selectedLead.assignedSalesProfileId
                ? (assigneeNames.get(selectedLead.assignedSalesProfileId) ?? "Sales Member")
                : "Unassigned"
            }
            lead={selectedLead}
          />
        ) : null}
      </dialog>
    </div>
  );
}
