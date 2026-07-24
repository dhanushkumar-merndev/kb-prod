"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import Link from "next/link";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  ActionFeedback,
  FieldError,
  SubmitButton,
  formatDate,
  formatDateTime,
  formatMoney,
} from "@/features/core-crud/components/shared";
import { INITIAL_CRUD_ACTION_STATE } from "@/features/core-crud/types";
import { ROLE_NAMESPACES } from "@/lib/navigation/role-navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

import {
  addInternalNoteAction,
  assignConversationAction,
  sendSuperfoneMessageAction,
  updateConversationStatusAction,
} from "./actions";
import { parseConversationInbox, parseConversationTimeline } from "./parsers";
import styles from "./conversations.module.css";
import {
  CONVERSATION_FILTERS,
  CONVERSATION_STATUSES,
  type ConversationFilter,
  type ConversationInboxRecord,
  type ConversationTimelineEvent,
  type ConversationWorkspaceData,
} from "./types";

const FILTER_LABELS: Record<ConversationFilter, string> = {
  all: "All",
  unread: "Unread",
  unassigned: "Unassigned",
  mine: "Mine",
  open: "Open",
  pending: "Pending",
  resolved: "Resolved",
  failed: "Failed",
};

type TimelineVirtualRow =
  | { id: string; kind: "date"; label: string }
  | { id: string; kind: "event"; event: ConversationTimelineEvent };

function SendButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      aria-busy={pending}
      className={styles.primaryButton}
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? "Sending…" : "Send"}
    </button>
  );
}

function inboxLabel(conversation: ConversationInboxRecord): string {
  return conversation.contactName?.trim() || conversation.contactPhoneE164;
}

function safeMetadataNumber(event: ConversationTimelineEvent, key: string): number | null {
  const value = event.metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeMetadataString(event: ConversationTimelineEvent, key: string): string | null {
  const value = event.metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function TimelineEvent({
  capabilitiesAvailable,
  conversationId,
  event,
}: {
  capabilitiesAvailable: boolean;
  conversationId: string;
  event: ConversationTimelineEvent;
}) {
  const isOutbound = event.direction === "outbound";
  const isNote = event.eventType === "internal_note";
  const isSystem = event.direction === "system" || event.eventType === "assignment";
  const isCall = event.eventType === "call";
  const isFailed = event.status === "failed";
  const className = [
    styles.event,
    isOutbound ? styles.eventOutbound : "",
    isNote ? styles.eventNote : "",
    isSystem ? styles.eventSystem : "",
    isCall ? styles.eventCall : "",
    isFailed ? styles.eventFailed : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={className}>
      <span className={styles.eventLabel}>
        {isNote
          ? "Internal note"
          : isCall
            ? "Call"
            : isSystem
              ? event.status?.replaceAll("_", " ") || "Activity"
              : event.direction}
      </span>
      <p className={styles.eventBody}>{event.body || "Attachment"}</p>
      {isCall ? (
        <p className={styles.muted}>
          Duration: {safeMetadataNumber(event, "duration_seconds") ?? 0} seconds
        </p>
      ) : null}
      {isFailed && safeMetadataString(event, "failure_message_safe") ? (
        <p className={styles.muted}>{safeMetadataString(event, "failure_message_safe")}</p>
      ) : null}
      <div className={styles.eventFooter}>
        {event.actorName ? <span>{event.actorName}</span> : null}
        {event.status ? <span>{event.status.replaceAll("_", " ")}</span> : null}
        <time dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time>
      </div>
      {isFailed && event.body ? (
        <RetryMessageForm
          body={event.body}
          conversationId={conversationId}
          disabled={!capabilitiesAvailable}
          messageId={event.eventId}
        />
      ) : null}
    </article>
  );
}

function RetryMessageForm({
  body,
  conversationId,
  disabled,
  messageId,
}: {
  body: string;
  conversationId: string;
  disabled: boolean;
  messageId: string;
}) {
  const [state, action] = useActionState(sendSuperfoneMessageAction, INITIAL_CRUD_ACTION_STATE);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  return (
    <form action={action}>
      <input name="conversationId" type="hidden" value={conversationId} />
      <input name="body" type="hidden" value={body} />
      <input name="retryOfMessageId" type="hidden" value={messageId} />
      <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
      <button
        className={styles.retryButton}
        disabled={disabled || state.status === "success"}
        title={disabled ? "Superfone messaging is unavailable." : undefined}
        type="submit"
      >
        {state.status === "success" ? "Retry queued" : "Retry"}
      </button>
      <ActionFeedback state={state} />
    </form>
  );
}

function MessageComposer({
  conversation,
  data,
}: {
  conversation: ConversationInboxRecord;
  data: ConversationWorkspaceData;
}) {
  const [mode, setMode] = useState<"message" | "note">("message");
  const [sendState, sendAction] = useActionState(
    sendSuperfoneMessageAction,
    INITIAL_CRUD_ACTION_STATE,
  );
  const [noteState, noteAction] = useActionState(addInternalNoteAction, INITIAL_CRUD_ACTION_STATE);
  const activeState = mode === "message" ? sendState : noteState;

  return (
    <div className={styles.composer}>
      <div className={styles.composerModes} role="tablist" aria-label="Composer mode">
        <button
          aria-selected={mode === "message"}
          className={`${styles.modeButton} ${mode === "message" ? styles.modeButtonActive : ""}`}
          onClick={() => setMode("message")}
          role="tab"
          type="button"
        >
          Customer message
        </button>
        <button
          aria-selected={mode === "note"}
          className={`${styles.modeButton} ${mode === "note" ? styles.modeButtonActive : ""}`}
          onClick={() => setMode("note")}
          role="tab"
          type="button"
        >
          Internal note
        </button>
      </div>
      {mode === "message" && !data.capabilities.messagingAvailable ? (
        <p className={styles.capabilityNotice}>
          {data.capabilities.unavailableReason ??
            "Messaging is waiting for official Superfone API configuration."}
        </p>
      ) : null}
      <form
        action={mode === "message" ? sendAction : noteAction}
        key={`${conversation.id}-${mode}-${activeState.mutationId}`}
        noValidate
      >
        <input name="conversationId" type="hidden" value={conversation.id} />
        {mode === "message" ? (
          <>
            <IdempotencyInput />
            <input name="retryOfMessageId" type="hidden" value="" />
          </>
        ) : null}
        <textarea
          aria-label={mode === "message" ? "Customer message" : "Internal note"}
          className={styles.textarea}
          disabled={mode === "message" && !data.capabilities.messagingAvailable}
          name={mode === "message" ? "body" : "note"}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !(mode === "message" && !data.capabilities.messagingAvailable)
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={
            mode === "message"
              ? "Write a customer message…"
              : "Add a note visible only to the CRM team…"
          }
          required
        />
        <FieldError field={mode === "message" ? "body" : "note"} state={activeState} />
        <div className={styles.composerActions}>
          <p className={styles.composerHint}>Enter sends · Shift+Enter adds a new line</p>
          {mode === "message" ? (
            <SendButton disabled={!data.capabilities.messagingAvailable} />
          ) : (
            <SubmitButton pendingLabel="Adding note…">Add note</SubmitButton>
          )}
        </div>
        <ActionFeedback state={activeState} />
      </form>
    </div>
  );
}

function IdempotencyInput() {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  return <input name="idempotencyKey" type="hidden" value={idempotencyKey} />;
}

function ConversationStatusForm({ conversation }: { conversation: ConversationInboxRecord }) {
  const [state, action] = useActionState(updateConversationStatusAction, INITIAL_CRUD_ACTION_STATE);
  return (
    <form action={action} className={styles.sideForm}>
      <input name="conversationId" type="hidden" value={conversation.id} />
      <input name="expectedVersion" type="hidden" value={conversation.version} />
      <label className={styles.label} htmlFor={`conversation-status-${conversation.id}`}>
        Conversation status
      </label>
      <select
        className={styles.select}
        defaultValue={conversation.status}
        id={`conversation-status-${conversation.id}`}
        name="status"
      >
        {CONVERSATION_STATUSES.map((status) => (
          <option key={status} value={status}>
            {status[0]?.toUpperCase()}
            {status.slice(1)}
          </option>
        ))}
      </select>
      <SubmitButton pendingLabel="Saving…" tone="secondary">
        Save status
      </SubmitButton>
      <ActionFeedback state={state} />
    </form>
  );
}

function ConversationAssignmentForm({
  conversation,
  data,
}: {
  conversation: ConversationInboxRecord;
  data: ConversationWorkspaceData;
}) {
  const [state, action] = useActionState(assignConversationAction, INITIAL_CRUD_ACTION_STATE);
  return (
    <form action={action} className={styles.sideForm} noValidate>
      <input name="conversationId" type="hidden" value={conversation.id} />
      <input name="expectedVersion" type="hidden" value={conversation.version} />
      <label className={styles.label} htmlFor={`conversation-assignee-${conversation.id}`}>
        Assigned Sales Member
      </label>
      <select
        className={styles.select}
        defaultValue={conversation.assignedSalesProfileId ?? ""}
        id={`conversation-assignee-${conversation.id}`}
        name="assignedSalesProfileId"
      >
        <option value="">Unassigned queue</option>
        {data.salesProfiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.fullName}
          </option>
        ))}
      </select>
      <label className={styles.label} htmlFor={`conversation-reason-${conversation.id}`}>
        Assignment reason
      </label>
      <input
        className={styles.input}
        id={`conversation-reason-${conversation.id}`}
        maxLength={500}
        name="reason"
        required
      />
      <FieldError field="reason" state={state} />
      <SubmitButton pendingLabel="Assigning…">Save assignment</SubmitButton>
      <ActionFeedback state={state} />
    </form>
  );
}

function LeadSidePanel({
  conversation,
  data,
}: {
  conversation: ConversationInboxRecord;
  data: ConversationWorkspaceData;
}) {
  const lead = data.leads.find((item) => item.id === conversation.leadId);
  const canAssign = ["director", "manager", "sales_manager"].includes(data.viewerRole);
  const bookingPath = `/${ROLE_NAMESPACES[data.viewerRole]}/bookings`;

  return (
    <aside className={styles.leadPanel} aria-label="Lead details">
      <section className={styles.sideSection}>
        <h3>{lead?.clientName ?? inboxLabel(conversation)}</h3>
        <p>{lead?.phoneE164 ?? conversation.contactPhoneE164}</p>
        <dl className={styles.sideList}>
          <div>
            <dt>Lead status</dt>
            <dd>{lead?.status.replaceAll("_", " ") ?? "—"}</dd>
          </div>
          <div>
            <dt>Assigned to</dt>
            <dd>{conversation.assignedSalesName ?? "Unassigned"}</dd>
          </div>
          <div>
            <dt>Event date</dt>
            <dd>{formatDate(lead?.eventDate ?? null)}</dd>
          </div>
          <div>
            <dt>Guests</dt>
            <dd>{lead?.guestCount ?? "—"}</dd>
          </div>
          <div>
            <dt>Quote</dt>
            <dd>{formatMoney(lead?.quoteAmount ?? null)}</dd>
          </div>
          <div>
            <dt>Requirement</dt>
            <dd>{lead?.requirement ?? "—"}</dd>
          </div>
        </dl>
        <div className={styles.sideActions}>
          <Link className={styles.linkButton} href={bookingPath}>
            Convert / view booking
          </Link>
        </div>
      </section>
      <section className={styles.sideSection}>
        <h3>Workflow</h3>
        <ConversationStatusForm conversation={conversation} />
      </section>
      {canAssign ? (
        <section className={styles.sideSection}>
          <h3>Ownership</h3>
          <ConversationAssignmentForm conversation={conversation} data={data} />
        </section>
      ) : null}
    </aside>
  );
}

export function ConversationWorkspace({ data }: { data: ConversationWorkspaceData }) {
  const [inbox, setInbox] = useState(data.inbox);
  const [selectedId, setSelectedId] = useState(data.initialConversationId);
  const [timeline, setTimeline] = useState(data.initialTimeline);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [assignee, setAssignee] = useState("");
  const [inboxLoading, setInboxLoading] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(data.inbox.length === 50);
  const [mobileOpen, setMobileOpen] = useState(false);
  const selectedIdRef = useRef(selectedId);
  const inboxScrollRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadTimeline = useCallback(async (conversationId: string) => {
    setTimelineLoading(true);
    const supabase = createBrowserSupabaseClient();
    const result = await supabase.rpc("get_conversation_timeline", {
      p_conversation_id: conversationId,
      p_limit: 200,
    });
    if (result.error) {
      setLoadError("The conversation timeline could not be refreshed.");
    } else {
      try {
        setTimeline(parseConversationTimeline(result.data));
        setLoadError(null);
      } catch {
        setLoadError("The conversation timeline response was invalid.");
      }
    }
    setTimelineLoading(false);
  }, []);

  const loadInbox = useCallback(
    async (offset = 0, append = false) => {
      setInboxLoading(true);
      const supabase = createBrowserSupabaseClient();
      const result = await supabase.rpc("get_conversation_inbox", {
        p_search: search.trim() || null,
        p_filter: filter,
        p_assigned_profile_id: assignee || null,
        p_limit: 50,
        p_offset: offset,
      });
      if (result.error) {
        setLoadError("The conversation list could not be refreshed.");
      } else {
        try {
          const rows = parseConversationInbox(result.data);
          setInbox((current) =>
            append
              ? [
                  ...current,
                  ...rows.filter((row) => !current.some((existing) => existing.id === row.id)),
                ]
              : rows,
          );
          setHasMore(rows.length === 50);
          setLoadError(null);
          if (
            !append &&
            (!selectedIdRef.current || !rows.some((row) => row.id === selectedIdRef.current))
          ) {
            const nextConversationId = rows[0]?.id ?? null;
            setSelectedId(nextConversationId);
            if (nextConversationId) {
              void loadTimeline(nextConversationId);
            } else {
              setTimeline([]);
            }
          }
        } catch {
          setLoadError("The conversation list response was invalid.");
        }
      }
      setInboxLoading(false);
    },
    [assignee, filter, loadTimeline, search],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadInbox();
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [loadInbox]);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let timer: number | undefined;
    const refresh = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void loadInbox();
        if (selectedIdRef.current) void loadTimeline(selectedIdRef.current);
      }, 180);
    };
    const channel = supabase
      .channel(`conversation-workspace:${data.organizationId}:${data.viewerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `organization_id=eq.${data.organizationId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `organization_id=eq.${data.organizationId}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation_reads",
          filter: `organization_id=eq.${data.organizationId}`,
        },
        refresh,
      )
      .subscribe();

    return () => {
      if (timer) window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [data.organizationId, data.viewerId, loadInbox, loadTimeline]);

  const selected = useMemo(
    () => inbox.find((conversation) => conversation.id === selectedId) ?? null,
    [inbox, selectedId],
  );
  const timelineAscending = useMemo(() => [...timeline].reverse(), [timeline]);
  const timelineRows = useMemo<TimelineVirtualRow[]>(() => {
    const rows: TimelineVirtualRow[] = [];
    let previousDateLabel: string | null = null;

    timelineAscending.forEach((event) => {
      const dateLabel = formatDate(event.occurredAt);

      if (dateLabel !== previousDateLabel) {
        rows.push({
          id: `date:${dateLabel}:${event.eventId}`,
          kind: "date",
          label: dateLabel,
        });
        previousDateLabel = dateLabel;
      }

      rows.push({
        id: `${event.eventType}:${event.eventId}`,
        kind: "event",
        event,
      });
    });

    return rows;
  }, [timelineAscending]);
  // TanStack Virtual intentionally returns imperative measurement functions.
  // eslint-disable-next-line react-hooks/incompatible-library
  const inboxVirtualizer = useVirtualizer({
    count: inbox.length,
    estimateSize: () => 106,
    getItemKey: (index) => inbox[index]?.id ?? index,
    getScrollElement: () => inboxScrollRef.current,
    overscan: 8,
  });
  const timelineVirtualizer = useVirtualizer({
    count: timelineRows.length,
    estimateSize: (index) => (timelineRows[index]?.kind === "date" ? 42 : 116),
    getItemKey: (index) => timelineRows[index]?.id ?? index,
    getScrollElement: () => timelineScrollRef.current,
    overscan: 10,
  });

  useEffect(() => {
    if (!timelineLoading && timelineRows.length > 0) {
      timelineVirtualizer.scrollToIndex(timelineRows.length - 1, { align: "end" });
    }
  }, [selectedId, timelineLoading, timelineRows.length, timelineVirtualizer]);

  async function openConversation(conversation: ConversationInboxRecord): Promise<void> {
    setSelectedId(conversation.id);
    setMobileOpen(true);
    await Promise.all([
      loadTimeline(conversation.id),
      createBrowserSupabaseClient().rpc("mark_conversation_read", {
        p_conversation_id: conversation.id,
      }),
    ]);
    setInbox((current) =>
      current.map((item) => (item.id === conversation.id ? { ...item, unreadCount: 0 } : item)),
    );
  }

  const canFilterAssignee = ["director", "manager", "sales_manager"].includes(data.viewerRole);

  return (
    <div className={`${styles.shell} ${mobileOpen ? styles.mobileOpen : ""}`}>
      <section className={styles.listPanel} aria-label="Conversation list">
        <div className={styles.panelHeader}>
          <h2>Conversations</h2>
          <p>{inboxLoading ? "Refreshing…" : `${inbox.length} visible conversations`}</p>
          <div className={styles.filterGrid}>
            <label className={styles.label} htmlFor="conversation-search">
              Search name or phone
            </label>
            <input
              className={styles.search}
              id="conversation-search"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search customers"
              type="search"
              value={search}
            />
            <label className={styles.label} htmlFor="conversation-filter">
              Filter
            </label>
            <select
              className={styles.select}
              id="conversation-filter"
              onChange={(event) => setFilter(event.target.value as ConversationFilter)}
              value={filter}
            >
              {CONVERSATION_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {FILTER_LABELS[value]}
                </option>
              ))}
            </select>
            {canFilterAssignee ? (
              <>
                <label className={styles.label} htmlFor="conversation-assignee-filter">
                  Assigned person
                </label>
                <select
                  className={styles.select}
                  id="conversation-assignee-filter"
                  onChange={(event) => setAssignee(event.target.value)}
                  value={assignee}
                >
                  <option value="">All assignees</option>
                  {data.salesProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.fullName}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
          </div>
        </div>
        {loadError ? (
          <div className={styles.error} role="alert">
            {loadError}
          </div>
        ) : null}
        {inbox.length === 0 && !inboxLoading ? (
          <div className={styles.empty}>
            <strong>No conversations found</strong>
            <p>Try another filter. Provider-ingested conversations will appear here.</p>
          </div>
        ) : (
          <div className={styles.conversationList} ref={inboxScrollRef} role="list">
            <div
              className={styles.virtualList}
              style={{ height: `${inboxVirtualizer.getTotalSize()}px` }}
            >
              {inboxVirtualizer.getVirtualItems().map((virtualRow) => {
                const conversation = inbox[virtualRow.index];

                if (!conversation) {
                  return null;
                }

                return (
                  <div
                    className={styles.virtualRow}
                    data-index={virtualRow.index}
                    key={conversation.id}
                    ref={inboxVirtualizer.measureElement}
                    role="listitem"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <button
                      className={`${styles.conversationButton} ${
                        selectedId === conversation.id ? styles.conversationButtonActive : ""
                      }`}
                      onClick={() => void openConversation(conversation)}
                      type="button"
                    >
                      <div className={styles.conversationTop}>
                        <span className={styles.conversationName}>{inboxLabel(conversation)}</span>
                        <time className={styles.conversationTime}>
                          {conversation.lastMessageAt
                            ? formatDateTime(conversation.lastMessageAt)
                            : "No messages"}
                        </time>
                      </div>
                      <span className={styles.preview}>
                        {conversation.lastMessagePreview ?? "Conversation created"}
                      </span>
                      <span className={styles.conversationMeta}>
                        <span>{conversation.assignedSalesName ?? "Unassigned"}</span>
                        <span>
                          {conversation.failedCount > 0 ? (
                            <span className={styles.failed}>{conversation.failedCount} failed</span>
                          ) : null}
                          {conversation.unreadCount > 0 ? (
                            <span className={styles.unread}>{conversation.unreadCount}</span>
                          ) : (
                            <span className={styles.badge}>{conversation.status}</span>
                          )}
                        </span>
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {hasMore ? (
          <button
            className={styles.loadMore}
            disabled={inboxLoading}
            onClick={() => void loadInbox(inbox.length, true)}
            type="button"
          >
            {inboxLoading ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </section>

      <section className={styles.timelinePanel} aria-label="Message and call timeline">
        {selected ? (
          <>
            <header className={styles.timelineHeader}>
              <div className={styles.timelineHeaderActions}>
                <button
                  className={styles.backButton}
                  onClick={() => setMobileOpen(false)}
                  type="button"
                >
                  Back
                </button>
                <div>
                  <h2>{inboxLabel(selected)}</h2>
                  <p>
                    {selected.channel} · {selected.contactPhoneE164}
                  </p>
                </div>
              </div>
              <span className={styles.badge}>{selected.status}</span>
            </header>
            {timelineLoading ? (
              <div className={styles.loading} role="status">
                Loading timeline…
              </div>
            ) : timelineAscending.length === 0 ? (
              <div className={styles.empty}>
                <strong>No timeline events yet</strong>
                <p>Add an internal note or wait for an authenticated provider event.</p>
              </div>
            ) : (
              <div className={styles.timeline} ref={timelineScrollRef} role="list">
                <div
                  className={styles.virtualList}
                  style={{ height: `${timelineVirtualizer.getTotalSize()}px` }}
                >
                  {timelineVirtualizer.getVirtualItems().map((virtualRow) => {
                    const row = timelineRows[virtualRow.index];

                    if (!row) {
                      return null;
                    }

                    return (
                      <div
                        className={styles.virtualRow}
                        data-index={virtualRow.index}
                        key={row.id}
                        ref={timelineVirtualizer.measureElement}
                        role="listitem"
                        style={{ transform: `translateY(${virtualRow.start}px)` }}
                      >
                        {row.kind === "date" ? (
                          <div className={styles.eventSystem}>
                            <span className={styles.eventLabel}>{row.label}</span>
                          </div>
                        ) : (
                          <TimelineEvent
                            capabilitiesAvailable={data.capabilities.messagingAvailable}
                            conversationId={selected.id}
                            event={row.event}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <MessageComposer conversation={selected} data={data} />
          </>
        ) : (
          <div className={styles.empty}>
            <strong>Select a conversation</strong>
            <p>Choose a customer from the conversation list.</p>
          </div>
        )}
      </section>

      {selected ? <LeadSidePanel conversation={selected} data={data} /> : null}
    </div>
  );
}
