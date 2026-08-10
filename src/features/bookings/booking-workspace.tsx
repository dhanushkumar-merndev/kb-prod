"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  FileText,
  Mail,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import { ActionFeedback, FieldError, SubmitButton } from "@/features/core-crud/components/shared";
import { INITIAL_CRUD_ACTION_STATE, type CrudActionState } from "@/features/core-crud/types";
import { downloadBookingInvoicePdf } from "@/lib/invoices/client-pdf";

import {
  createBookingAction,
  issueBookingInvoiceAction,
  reissueBookingInvoiceAction,
  resendBookingInvoiceAction,
  retryBookingEmailAction,
  updateBookingAction,
  updateBookingCustomerEmailAction,
} from "./actions";
import styles from "./bookings.module.css";
import type { BookingCrudData, BookingRecord } from "./types";

function GenerateInvoiceButton() {
  const { pending } = useFormStatus();

  return (
    <button className={styles.invoiceActionBtn} disabled={pending} type="submit">
      <FileText size={14} />
      {pending ? "Generating…" : "Generate"}
    </button>
  );
}

function LocalInvoiceDownloadButton({
  booking,
  compact = false,
}: {
  booking: BookingRecord;
  compact?: boolean;
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");

  return (
    <button
      className={compact ? styles.invoiceActionBtn : styles.pageBtn}
      disabled={isGenerating}
      onClick={async () => {
        setError("");
        setIsGenerating(true);
        try {
          await downloadBookingInvoicePdf(booking);
        } catch {
          setError("PDF could not be created in this browser.");
        } finally {
          setIsGenerating(false);
        }
      }}
      title={error || "Generate and download an offline PDF on this computer"}
      type="button"
    >
      <Download size={14} />
      {isGenerating ? "Creating…" : compact ? "PDF" : "Download local PDF"}
    </button>
  );
}

function BookingInvoiceQuickAction({ booking }: { booking: BookingRecord }) {
  const [state, action] = useActionState(issueBookingInvoiceAction, INITIAL_CRUD_ACTION_STATE);

  if (booking.serviceStatus === "cancelled" && !booking.invoice) {
    return <span className={styles.invoiceUnavailable}>Not applicable</span>;
  }

  if (booking.invoice) {
    return <LocalInvoiceDownloadButton booking={booking} compact />;
  }

  return (
    <div className={styles.quickInvoice}>
      <form action={action}>
        <input name="bookingId" type="hidden" value={booking.id} />
        <GenerateInvoiceButton />
      </form>
      {state.status === "error" ? (
        <span className={styles.quickInvoiceError} role="alert" title={state.message}>
          Retry
        </span>
      ) : null}
    </div>
  );
}

function invoiceAvailability(booking: BookingRecord): string {
  switch (booking.invoice?.status) {
    case "issued":
      return "local download ready · cloud copy stored";
    case "generation_failed":
      return "local download ready · cloud copy needs retry";
    case "pending_generation":
      return "local download ready";
    default:
      return "Invoice record is not available yet.";
  }
}

function InvoiceControls({
  booking,
  viewerRole,
}: {
  booking: BookingRecord;
  viewerRole: BookingCrudData["viewerRole"];
}) {
  const [emailState, emailAction] = useActionState(
    updateBookingCustomerEmailAction,
    INITIAL_CRUD_ACTION_STATE,
  );
  const [invoiceState, invoiceAction] = useActionState(
    issueBookingInvoiceAction,
    INITIAL_CRUD_ACTION_STATE,
  );
  const [reissueState, reissueAction] = useActionState(
    reissueBookingInvoiceAction,
    INITIAL_CRUD_ACTION_STATE,
  );
  const [resendState, resendAction] = useActionState(
    resendBookingInvoiceAction,
    INITIAL_CRUD_ACTION_STATE,
  );
  const [retryState, retryAction] = useActionState(
    retryBookingEmailAction,
    INITIAL_CRUD_ACTION_STATE,
  );
  const canReissue = ["director", "franchise", "manager", "sales_manager"].includes(viewerRole);

  return (
    <section className={styles.invoicePanel}>
      <div className={styles.invoiceHeader}>
        <div>
          <h3>Invoice & customer email</h3>
          <p>
            {booking.invoice
              ? `${booking.invoice.number} · ${invoiceAvailability(booking)}`
              : invoiceAvailability(booking)}
          </p>
        </div>
        <div className={styles.invoiceActions}>
          {booking.invoice ? <LocalInvoiceDownloadButton booking={booking} /> : null}
          {booking.invoice?.downloadUrl ? (
            <a className={styles.pageBtn} download href={booking.invoice.downloadUrl}>
              <Download size={15} /> Stored copy
            </a>
          ) : null}
        </div>
      </div>

      <form action={emailAction} className={styles.inlineForm}>
        <input name="bookingId" type="hidden" value={booking.id} />
        <label>
          Customer email
          <input
            defaultValue={booking.customerEmail ?? ""}
            name="customerEmail"
            placeholder="customer@example.com"
            required
            type="email"
          />
          <FieldError field="customerEmail" state={emailState} />
        </label>
        <SubmitButton pendingLabel="Saving…">Save email</SubmitButton>
      </form>
      <ActionFeedback state={emailState} />

      <div className={styles.invoiceActions}>
        {!booking.invoice ? (
          <form action={invoiceAction}>
            <input name="bookingId" type="hidden" value={booking.id} />
            <SubmitButton pendingLabel="Creating…">
              <FileText size={15} /> Create invoice
            </SubmitButton>
          </form>
        ) : (
          <form action={resendAction}>
            <input name="bookingId" type="hidden" value={booking.invoice.id} />
            <SubmitButton pendingLabel="Queueing…" tone="secondary">
              <Mail size={15} /> Resend invoice
            </SubmitButton>
          </form>
        )}
        {booking.latestEmail && ["failed", "skipped"].includes(booking.latestEmail.status) ? (
          <form action={retryAction}>
            <input name="outboxId" type="hidden" value={booking.latestEmail.id} />
            <SubmitButton pendingLabel="Queueing…" tone="secondary">
              Retry email
            </SubmitButton>
          </form>
        ) : null}
      </div>
      <ActionFeedback state={invoiceState} />
      <ActionFeedback state={resendState} />
      <ActionFeedback state={retryState} />

      <p className={styles.emailStatus}>
        Email:{" "}
        {booking.latestEmail
          ? booking.latestEmail.status.replaceAll("_", " ")
          : booking.customerEmail
            ? "not queued"
            : "skipped · customer email missing"}
        {booking.latestEmail?.error ? ` · ${booking.latestEmail.error}` : ""}
      </p>

      {canReissue && booking.invoice?.status === "issued" ? (
        <form
          action={reissueAction}
          className={styles.inlineForm}
          onSubmit={(event) => {
            if (!window.confirm("Void this invoice and issue a corrected replacement?")) {
              event.preventDefault();
            }
          }}
        >
          <input name="bookingId" type="hidden" value={booking.invoice.id} />
          <label>
            Reissue reason
            <input name="reason" minLength={5} required />
            <FieldError field="reason" state={reissueState} />
          </label>
          <SubmitButton pendingLabel="Reissuing…" tone="secondary">
            Void & reissue
          </SubmitButton>
        </form>
      ) : null}
      <ActionFeedback state={reissueState} />
    </section>
  );
}

function CreateBookingDialog({
  data,
  isOpen,
  onClose,
}: {
  data: BookingCrudData;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [state, action] = useActionState(createBookingAction, INITIAL_CRUD_ACTION_STATE);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (isOpen) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [isOpen]);

  useEffect(() => {
    if (state.status === "success") {
      onClose();
    }
  }, [onClose, state.mutationId, state.status]);

  if (!data.canCreate) {
    return null;
  }

  return (
    <dialog className={styles.modalDialog} ref={dialogRef} onClose={onClose}>
      <div className={styles.modalHeader}>
        <div>
          <h2>Create booking</h2>
          <p>Convert a qualified lead into an operational booking.</p>
        </div>
        <button className={styles.closeBtn} onClick={onClose} type="button">
          <X size={20} />
        </button>
      </div>

      <div className={styles.modalBody}>
        {data.eligibleLeads.length === 0 ? (
          <p className={styles.empty}>No qualified lead is ready for conversion.</p>
        ) : (
          <form action={action} className={styles.formGrid}>
            <label>
              Qualified lead
              <select name="leadId" required>
                {data.eligibleLeads.map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.clientName}
                    {lead.customerEmail ? ` · ${lead.customerEmail}` : " · no customer email"}
                  </option>
                ))}
              </select>
              <FieldError field="leadId" state={state} />
            </label>
            <label>
              Event type
              <input name="eventType" required />
              <FieldError field="eventType" state={state} />
            </label>
            <label>
              Event date
              <input name="eventDate" required type="date" />
              <FieldError field="eventDate" state={state} />
            </label>
            <label>
              Event start
              <input name="eventStartTime" type="time" />
            </label>
            <label>
              Reporting time
              <input name="reportingTime" type="time" />
            </label>
            <label>
              Guest count
              <input min="1" name="guestCount" required type="number" />
              <FieldError field="guestCount" state={state} />
            </label>
            <label className={styles.wide}>
              Venue
              <input name="venue" required />
              <FieldError field="venue" state={state} />
            </label>
            <label className={styles.wide}>
              Menu
              <textarea name="menu" required />
              <FieldError field="menu" state={state} />
            </label>
            <label className={styles.wide}>
              Instructions
              <textarea name="instructions" />
            </label>
            <label>
              Total value
              <input min="0" name="totalValue" required step="0.01" type="number" />
              <FieldError field="totalValue" state={state} />
            </label>
            <div className={styles.actions}>
              <button className={styles.pageBtn} onClick={onClose} type="button">
                Cancel
              </button>
              <SubmitButton pendingLabel="Creating…">Create booking</SubmitButton>
            </div>
          </form>
        )}
        <ActionFeedback state={state} />
      </div>
    </dialog>
  );
}

function EditBookingDialog({
  booking,
  onClose,
  viewerRole,
}: {
  booking: BookingRecord | null;
  onClose: () => void;
  viewerRole: BookingCrudData["viewerRole"];
}) {
  const [state, action] = useActionState(updateBookingAction, INITIAL_CRUD_ACTION_STATE);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (booking) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [booking]);

  useEffect(() => {
    if (state.status === "success") {
      onClose();
    }
  }, [onClose, state.mutationId, state.status]);

  if (!booking) {
    return null;
  }

  const locked = ["preparing", "service_completed", "fully_completed", "cancelled"].includes(
    booking.serviceStatus,
  );

  return (
    <dialog className={styles.modalDialog} ref={dialogRef} onClose={onClose}>
      <div className={styles.modalHeader}>
        <div>
          <h2>Edit booking {booking.bookingCode}</h2>
          <p>
            {booking.clientName} · {booking.eventType}
          </p>
        </div>
        <button className={styles.closeBtn} onClick={onClose} type="button">
          <X size={20} />
        </button>
      </div>

      <div className={styles.modalBody}>
        <InvoiceControls booking={booking} viewerRole={viewerRole} />
        {locked ? (
          <p className={styles.empty}>
            This booking is locked in status &ldquo;{booking.serviceStatus.replaceAll("_", " ")}
            &rdquo; and cannot be edited.
          </p>
        ) : (
          <form action={action} className={styles.formGrid}>
            <input name="bookingId" type="hidden" value={booking.id} />
            <input name="expectedVersion" type="hidden" value={booking.version} />
            <label>
              Event type
              <input defaultValue={booking.eventType} name="eventType" required />
            </label>
            <label>
              Event date
              <input defaultValue={booking.eventDate} name="eventDate" required type="date" />
            </label>
            <label>
              Event start
              <input
                defaultValue={booking.eventStartTime?.slice(0, 5) ?? ""}
                name="eventStartTime"
                type="time"
              />
            </label>
            <label>
              Reporting time
              <input
                defaultValue={booking.reportingTime?.slice(0, 5) ?? ""}
                name="reportingTime"
                type="time"
              />
            </label>
            <label>
              Guests
              <input
                defaultValue={booking.guestCount}
                min="1"
                name="guestCount"
                required
                type="number"
              />
            </label>
            <label>
              Total value
              <input
                defaultValue={booking.totalValue}
                min="0"
                name="totalValue"
                required
                step="0.01"
                type="number"
              />
            </label>
            <label className={styles.wide}>
              Venue
              <input defaultValue={booking.venue} name="venue" required />
            </label>
            <label className={styles.wide}>
              Menu
              <textarea defaultValue={booking.menu} name="menu" required />
            </label>
            <label className={styles.wide}>
              Instructions
              <textarea defaultValue={booking.instructions ?? ""} name="instructions" />
            </label>
            <div className={styles.actions}>
              <button className={styles.pageBtn} onClick={onClose} type="button">
                Cancel
              </button>
              <SubmitButton>Save booking</SubmitButton>
            </div>
          </form>
        )}
        <ActionFeedback state={state as CrudActionState} />
      </div>
    </dialog>
  );
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case "pending":
      return `${styles.badge} ${styles.statusPending}`;
    case "confirmed":
      return `${styles.badge} ${styles.statusConfirmed}`;
    case "chef_assigned":
      return `${styles.badge} ${styles.statusChefAssigned}`;
    case "preparing":
      return `${styles.badge} ${styles.statusPreparing}`;
    case "service_completed":
    case "fully_completed":
      return `${styles.badge} ${styles.statusCompleted}`;
    case "cancelled":
      return `${styles.badge} ${styles.statusCancelled}`;
    default:
      return styles.badge ?? "";
  }
}

export function BookingWorkspace({ data }: { data: BookingCrudData }) {
  const router = useRouter();
  const pathname = usePathname();
  const currentSearchParams = useSearchParams();
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const [, startTransition] = useTransition();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<BookingRecord | null>(null);

  const [searchInput, setSearchInput] = useState(data.search);
  const [sorting, setSorting] = useState<SortingState>([]);

  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  const fromRecord = data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;
  const toRecord = Math.min(data.total, data.page * data.pageSize);

  const updateUrl = (updates: { page?: number; search?: string }) => {
    const params = new URLSearchParams(currentSearchParams.toString());
    if (updates.search !== undefined) {
      const val = updates.search.trim();
      if (val) {
        params.set("bookingSearch", val);
      } else {
        params.delete("bookingSearch");
      }
      params.delete("bookingPage");
    }
    if (updates.page !== undefined) {
      if (updates.page > 1) {
        params.set("bookingPage", String(updates.page));
      } else {
        params.delete("bookingPage");
      }
    }
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  useEffect(() => {
    if (searchInput.trim() === data.search) {
      return;
    }
    const timer = window.setTimeout(() => updateUrl({ search: searchInput }), 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, data.search, pathname]);

  useEffect(() => {
    setSelectedBooking((current) => {
      if (!current) return null;
      return data.bookings.find((booking) => booking.id === current.id) ?? current;
    });
  }, [data.bookings]);

  const columns = useMemo<ColumnDef<BookingRecord>[]>(
    () => [
      {
        accessorKey: "bookingCode",
        header: "Booking / Client",
        cell: ({ row }) => (
          <div>
            <span className={styles.codeCell}>{row.original.bookingCode}</span>
            <span className={styles.clientSub}>{row.original.clientName}</span>
          </div>
        ),
      },
      {
        accessorKey: "eventType",
        header: "Event & Venue",
        cell: ({ row }) => (
          <div>
            <strong>{row.original.eventType}</strong>
            <span className={styles.clientSub}>{row.original.venue}</span>
          </div>
        ),
      },
      {
        accessorKey: "eventDate",
        header: "Date",
        cell: ({ row }) => <span className={styles.mono}>{row.original.eventDate}</span>,
      },
      {
        accessorKey: "guestCount",
        header: "Guests",
        cell: ({ row }) => (
          <span className={styles.mono}>{row.original.guestCount.toLocaleString("en-IN")}</span>
        ),
      },
      {
        accessorKey: "totalValue",
        header: "Value",
        cell: ({ row }) => (
          <span className={styles.mono}>
            {new Intl.NumberFormat("en-IN", {
              style: "currency",
              currency: "INR",
              maximumFractionDigits: 2,
            }).format(Number(row.original.totalValue))}
          </span>
        ),
      },
      {
        accessorKey: "serviceStatus",
        header: "Status",
        cell: ({ row }) => (
          <span className={getStatusBadgeClass(row.original.serviceStatus)}>
            {row.original.serviceStatus.replaceAll("_", " ")}
          </span>
        ),
      },
      {
        id: "invoice",
        header: "Invoice",
        enableSorting: false,
        cell: ({ row }) => <BookingInvoiceQuickAction booking={row.original} />,
      },
      {
        id: "actions",
        header: "Details",
        cell: ({ row }) => (
          <button
            className={styles.editActionBtn}
            onClick={() => setSelectedBooking(row.original)}
            type="button"
          >
            <Pencil size={14} /> Manage
          </button>
        ),
      },
    ],
    [],
  );

  const tableData = useMemo(() => [...data.bookings], [data.bookings]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    columns,
    data: tableData,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  const { rows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 58,
    overscan: 5,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const paddingTop = virtualItems.length > 0 ? (virtualItems[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualItems.length > 0 ? totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0) : 0;

  return (
    <div className={styles.stack}>
      <CreateBookingDialog
        data={data}
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />

      <EditBookingDialog
        booking={selectedBooking}
        onClose={() => setSelectedBooking(null)}
        viewerRole={data.viewerRole}
      />

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Bookings</h2>
            <p>Records visible to your role and organization.</p>
          </div>

          <div className={styles.sectionHeaderActions}>
            <span className={styles.countBadge}>{data.total} total</span>
            {data.canCreate && (
              <button
                className={styles.createBtn}
                onClick={() => setIsCreateOpen(true)}
                type="button"
              >
                <Plus size={16} /> Create booking
              </button>
            )}
          </div>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.searchBox}>
            <Search size={16} style={{ color: "var(--slate)", flexShrink: 0 }} />
            <input
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by booking code, client, event, venue…"
              value={searchInput}
            />
            {searchInput && (
              <button
                onClick={() => {
                  setSearchInput("");
                  updateUrl({ search: "" });
                }}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--slate)",
                  display: "flex",
                  padding: 0,
                }}
                type="button"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <div className={styles.toolbarInfo}>
            Showing {fromRecord}–{toRecord} of {data.total} ({data.pageSize} per page)
          </div>
        </div>

        {data.bookings.length === 0 ? (
          <p className={styles.empty}>
            {data.search ? `No bookings matched "${data.search}".` : "No bookings are visible yet."}
          </p>
        ) : (
          <>
            <div className={styles.tableWrap} ref={tableContainerRef}>
              <table className={styles.table}>
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => {
                        const direction = header.column.getIsSorted();

                        return (
                          <th
                            aria-sort={
                              direction === "asc"
                                ? "ascending"
                                : direction === "desc"
                                  ? "descending"
                                  : "none"
                            }
                            key={header.id}
                            scope="col"
                          >
                            {header.isPlaceholder ? null : header.column.getCanSort() ? (
                              <button
                                className={styles.sortButton}
                                onClick={header.column.getToggleSortingHandler()}
                                type="button"
                              >
                                {flexRender(header.column.columnDef.header, header.getContext())}
                                <span aria-hidden="true">
                                  {direction === "asc" ? " ↑" : direction === "desc" ? " ↓" : " ↕"}
                                </span>
                              </button>
                            ) : (
                              flexRender(header.column.columnDef.header, header.getContext())
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {paddingTop > 0 && (
                    <tr>
                      <td colSpan={columns.length} style={{ height: `${paddingTop}px` }} />
                    </tr>
                  )}
                  {virtualItems.map((virtualRow) => {
                    const row = rows[virtualRow.index];
                    if (!row) {
                      return null;
                    }
                    return (
                      <tr key={row.original.id}>
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {paddingBottom > 0 && (
                    <tr>
                      <td colSpan={columns.length} style={{ height: `${paddingBottom}px` }} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className={styles.mobileCards}>
              {data.bookings.map((booking) => (
                <div className={styles.mobileCard} key={booking.id}>
                  <div className={styles.sectionHeader} style={{ marginBottom: "12px" }}>
                    <div>
                      <span className={styles.codeCell}>{booking.bookingCode}</span>
                      <span className={styles.clientSub}>
                        {booking.clientName} · {booking.eventType}
                      </span>
                    </div>
                    <span className={getStatusBadgeClass(booking.serviceStatus)}>
                      {booking.serviceStatus.replaceAll("_", " ")}
                    </span>
                  </div>
                  <dl
                    style={{
                      display: "grid",
                      gap: "8px",
                      gridTemplateColumns: "1fr 1fr",
                      margin: "0 0 12px",
                    }}
                  >
                    <div>
                      <dt
                        style={{
                          color: "var(--slate)",
                          fontSize: "10px",
                          textTransform: "uppercase",
                        }}
                      >
                        Date
                      </dt>
                      <dd style={{ margin: "2px 0 0", fontFamily: "var(--font-mono)" }}>
                        {booking.eventDate}
                      </dd>
                    </div>
                    <div>
                      <dt
                        style={{
                          color: "var(--slate)",
                          fontSize: "10px",
                          textTransform: "uppercase",
                        }}
                      >
                        Guests
                      </dt>
                      <dd style={{ margin: "2px 0 0", fontFamily: "var(--font-mono)" }}>
                        {booking.guestCount.toLocaleString("en-IN")}
                      </dd>
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <dt
                        style={{
                          color: "var(--slate)",
                          fontSize: "10px",
                          textTransform: "uppercase",
                        }}
                      >
                        Venue
                      </dt>
                      <dd style={{ margin: "2px 0 0" }}>{booking.venue}</dd>
                    </div>
                    <div>
                      <dt
                        style={{
                          color: "var(--slate)",
                          fontSize: "10px",
                          textTransform: "uppercase",
                        }}
                      >
                        Total Value
                      </dt>
                      <dd
                        style={{
                          margin: "2px 0 0",
                          fontFamily: "var(--font-mono)",
                          fontWeight: 600,
                        }}
                      >
                        {new Intl.NumberFormat("en-IN", {
                          style: "currency",
                          currency: "INR",
                        }).format(Number(booking.totalValue))}
                      </dd>
                    </div>
                  </dl>
                  <div className={styles.mobileActions}>
                    <BookingInvoiceQuickAction booking={booking} />
                    <button
                      className={styles.editActionBtn}
                      onClick={() => setSelectedBooking(booking)}
                      type="button"
                    >
                      <Pencil size={14} /> Manage booking
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.pagination}>
              <div className={styles.pageSummary}>
                Page {data.page} of {pageCount} ({data.total} total bookings)
              </div>
              <div className={styles.pageControls}>
                <button
                  className={styles.pageBtn}
                  disabled={data.page <= 1}
                  onClick={() => updateUrl({ page: 1 })}
                  title="First Page"
                  type="button"
                >
                  <ChevronsLeft size={16} />
                </button>
                <button
                  className={styles.pageBtn}
                  disabled={data.page <= 1}
                  onClick={() => updateUrl({ page: data.page - 1 })}
                  title="Previous Page"
                  type="button"
                >
                  <ChevronLeft size={16} />
                </button>

                {Array.from({ length: pageCount }, (_, i) => i + 1)
                  .filter((p) => Math.abs(p - data.page) <= 2 || p === 1 || p === pageCount)
                  .map((p, idx, arr) => {
                    const prev = arr[idx - 1];
                    const showEllipsis = prev && p - prev > 1;
                    return (
                      <div key={p} style={{ display: "inline-flex", gap: "6px" }}>
                        {showEllipsis && (
                          <span style={{ padding: "0 4px", color: "var(--slate)" }}>…</span>
                        )}
                        <button
                          className={`${styles.pageBtn} ${p === data.page ? styles.pageBtnActive : ""}`}
                          onClick={() => updateUrl({ page: p })}
                          type="button"
                        >
                          {p}
                        </button>
                      </div>
                    );
                  })}

                <button
                  className={styles.pageBtn}
                  disabled={data.page >= pageCount}
                  onClick={() => updateUrl({ page: data.page + 1 })}
                  title="Next Page"
                  type="button"
                >
                  <ChevronRight size={16} />
                </button>
                <button
                  className={styles.pageBtn}
                  disabled={data.page >= pageCount}
                  onClick={() => updateUrl({ page: pageCount })}
                  title="Last Page"
                  type="button"
                >
                  <ChevronsRight size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
