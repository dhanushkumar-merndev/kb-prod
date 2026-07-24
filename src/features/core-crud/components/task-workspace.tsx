"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import { createTaskAction, updateTaskAction, updateTaskStatusAction } from "../actions";
import styles from "../core-crud.module.css";
import {
  INITIAL_CRUD_ACTION_STATE,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type SafeProfileOption,
  type TaskCrudData,
  type TaskRecord,
} from "../types";
import {
  ActionFeedback,
  EmptyState,
  FieldError,
  formatDate,
  formatDateTime,
  SubmitButton,
  toIndiaDateTimeLocal,
} from "./shared";

const TASKS_PER_PAGE = 10;

function AssigneeOptions({
  assignees,
  currentAssigneeId,
}: {
  assignees: SafeProfileOption[];
  currentAssigneeId?: string;
}) {
  const currentIsMissing =
    currentAssigneeId !== undefined &&
    !assignees.some((profile) => profile.id === currentAssigneeId);

  return (
    <>
      <option value="">Choose a team member</option>
      {currentIsMissing ? <option value={currentAssigneeId}>Current assignee</option> : null}
      {assignees.map((profile) => (
        <option key={profile.id} value={profile.id}>
          {profile.fullName}
        </option>
      ))}
    </>
  );
}

function CreateTaskForm({ assignees }: { assignees: SafeProfileOption[] }) {
  const [state, action] = useActionState(createTaskAction, INITIAL_CRUD_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state.mutationId, state.status]);

  return (
    <form action={action} className={styles.formGrid} ref={formRef} noValidate>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="task-title">
          Task title
        </label>
        <input className={styles.input} id="task-title" name="title" maxLength={200} required />
        <FieldError field="title" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="task-assignee">
          Assign to
        </label>
        <select className={styles.select} id="task-assignee" name="assignedToProfileId" required>
          <AssigneeOptions assignees={assignees} />
        </select>
        <FieldError field="assignedToProfileId" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="task-due">
          Due date and time
        </label>
        <input className={styles.input} id="task-due" name="dueAt" type="datetime-local" />
        <FieldError field="dueAt" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="task-priority">
          Priority
        </label>
        <select className={styles.select} defaultValue="normal" id="task-priority" name="priority">
          {TASK_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {TASK_PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
        <FieldError field="priority" state={state} />
      </div>
      <div className={styles.fieldWide}>
        <label className={styles.label} htmlFor="task-description">
          Description
        </label>
        <textarea
          className={styles.textarea}
          id="task-description"
          name="description"
          maxLength={4000}
        />
        <FieldError field="description" state={state} />
      </div>
      <input name="bookingId" type="hidden" value="" />
      <input name="leadId" type="hidden" value="" />
      <div className={styles.actions}>
        <SubmitButton pendingLabel="Assigning task…">Assign task</SubmitButton>
      </div>
      <div className={styles.fieldWide}>
        <ActionFeedback state={state} />
      </div>
    </form>
  );
}

function UpdateTaskForm({ assignees, task }: { assignees: SafeProfileOption[]; task: TaskRecord }) {
  const [state, action] = useActionState(updateTaskAction, INITIAL_CRUD_ACTION_STATE);

  return (
    <form action={action} className={`${styles.formGrid} ${styles.detailsForm}`} noValidate>
      <input name="id" type="hidden" value={task.id} />
      <input name="expectedUpdatedAt" type="hidden" value={task.updatedAt} />
      <input name="bookingId" type="hidden" value={task.bookingId ?? ""} />
      <input name="leadId" type="hidden" value={task.leadId ?? ""} />
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`task-title-${task.id}`}>
          Task title
        </label>
        <input
          className={styles.input}
          defaultValue={task.title}
          id={`task-title-${task.id}`}
          name="title"
          required
        />
        <FieldError field="title" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`task-assignee-${task.id}`}>
          Assign to
        </label>
        <select
          className={styles.select}
          defaultValue={task.assignedToProfileId}
          id={`task-assignee-${task.id}`}
          name="assignedToProfileId"
          required
        >
          <AssigneeOptions assignees={assignees} currentAssigneeId={task.assignedToProfileId} />
        </select>
        <FieldError field="assignedToProfileId" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`task-due-${task.id}`}>
          Due date and time
        </label>
        <input
          className={styles.input}
          defaultValue={toIndiaDateTimeLocal(task.dueAt)}
          id={`task-due-${task.id}`}
          name="dueAt"
          type="datetime-local"
        />
        <FieldError field="dueAt" state={state} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`task-priority-${task.id}`}>
          Priority
        </label>
        <select
          className={styles.select}
          defaultValue={task.priority}
          id={`task-priority-${task.id}`}
          name="priority"
        >
          {TASK_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {TASK_PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
        <FieldError field="priority" state={state} />
      </div>
      <div className={styles.fieldWide}>
        <label className={styles.label} htmlFor={`task-description-${task.id}`}>
          Description
        </label>
        <textarea
          className={styles.textarea}
          defaultValue={task.description ?? ""}
          id={`task-description-${task.id}`}
          name="description"
        />
        <FieldError field="description" state={state} />
      </div>
      <div className={styles.actions}>
        <SubmitButton pendingLabel="Saving task…">Save changes</SubmitButton>
      </div>
      <div className={styles.fieldWide}>
        <ActionFeedback state={state} />
      </div>
    </form>
  );
}

function TaskStatusForm({ task }: { task: TaskRecord }) {
  const [state, action] = useActionState(updateTaskStatusAction, INITIAL_CRUD_ACTION_STATE);

  return (
    <>
      <form
        action={action}
        className={styles.statusForm}
        onSubmit={(event) => {
          const nextStatus = new FormData(event.currentTarget).get("status");

          if (nextStatus === "cancelled" && !window.confirm("Cancel this task?")) {
            event.preventDefault();
          }
        }}
      >
        <input name="id" type="hidden" value={task.id} />
        <input name="expectedUpdatedAt" type="hidden" value={task.updatedAt} />
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`task-status-${task.id}`}>
            Status
          </label>
          <select
            className={styles.select}
            defaultValue={task.status}
            id={`task-status-${task.id}`}
            name="status"
          >
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {TASK_STATUS_LABELS[status]}
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

function TaskItem({
  assigneeName,
  canEdit,
  canUpdateStatus,
  data,
  task,
}: {
  assigneeName: string;
  canEdit: boolean;
  canUpdateStatus: boolean;
  data: TaskCrudData;
  task: TaskRecord;
}) {
  return (
    <li className={styles.record}>
      <div className={styles.recordTop}>
        <div>
          <h3 className={styles.recordTitle}>{task.title}</h3>
          <p className={styles.recordSubtitle}>Assigned to {assigneeName}</p>
        </div>
        <span className={styles.badge}>{TASK_STATUS_LABELS[task.status]}</span>
      </div>
      <dl className={styles.metadata}>
        <div>
          <dt>Priority</dt>
          <dd>{TASK_PRIORITY_LABELS[task.priority]}</dd>
        </div>
        <div>
          <dt>Due</dt>
          <dd>{formatDateTime(task.dueAt)}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatDate(task.createdAt)}</dd>
        </div>
      </dl>
      {task.description ? <p className={styles.recordText}>{task.description}</p> : null}
      {canUpdateStatus ? <TaskStatusForm task={task} /> : null}
      {canEdit ? (
        <details className={styles.details}>
          <summary>Edit task</summary>
          <UpdateTaskForm assignees={data.assignees} task={task} />
        </details>
      ) : null}
    </li>
  );
}

export function TaskWorkspace({ data }: { data: TaskCrudData }) {
  const assigneeNames = useMemo(
    () => new Map(data.assignees.map((profile) => [profile.id, profile.fullName])),
    [data.assignees],
  );
  const isUpperAdmin = data.viewerRole === "director" || data.viewerRole === "manager";
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredTasks = useMemo(
    () =>
      normalizedSearch
        ? data.tasks.filter((task) =>
            [
              task.title,
              task.description,
              task.status,
              task.priority,
              assigneeNames.get(task.assignedToProfileId),
            ]
              .filter(Boolean)
              .join(" ")
              .toLocaleLowerCase()
              .includes(normalizedSearch),
          )
        : data.tasks,
    [assigneeNames, data.tasks, normalizedSearch],
  );
  const pageCount = Math.max(1, Math.ceil(filteredTasks.length / TASKS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const visibleTasks = filteredTasks.slice(
    (safePage - 1) * TASKS_PER_PAGE,
    safePage * TASKS_PER_PAGE,
  );

  return (
    <div className={styles.panel}>
      {data.canCreate ? (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>Assign task</h2>
              <p>Create a task for a team member within your permitted branch.</p>
            </div>
          </div>
          {data.assignees.length === 0 ? (
            <EmptyState
              title="No eligible assignees"
              message="An active team member must be created before a task can be assigned."
            />
          ) : (
            <CreateTaskForm assignees={data.assignees} />
          )}
        </section>
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Tasks</h2>
            <p>Only tasks permitted by your role and Supabase RLS are shown.</p>
          </div>
          <span className={styles.count}>{filteredTasks.length}</span>
        </div>
        <div className={styles.tableToolbar}>
          <label className={styles.searchControl}>
            <Search aria-hidden="true" size={18} />
            <span className={styles.srOnly}>Search tasks</span>
            <input
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search task, assignee, status, or priority…"
              type="search"
              value={search}
            />
          </label>
          <span className={styles.resultSummary}>
            {filteredTasks.length} task{filteredTasks.length === 1 ? "" : "s"}
          </span>
        </div>
        {visibleTasks.length === 0 ? (
          <EmptyState
            title="No tasks"
            message="Assigned work will appear here when a permitted team lead creates it."
          />
        ) : (
          <ul className={styles.recordList}>
            {visibleTasks.map((task) => {
              const isAssignee = task.assignedToProfileId === data.viewerId;
              const isCreator = task.assignedByProfileId === data.viewerId;

              return (
                <TaskItem
                  assigneeName={
                    task.assignedToProfileId === data.viewerId
                      ? "you"
                      : (assigneeNames.get(task.assignedToProfileId) ?? "team member")
                  }
                  canEdit={isUpperAdmin || isCreator}
                  canUpdateStatus={isUpperAdmin || isCreator || isAssignee}
                  data={data}
                  key={task.id}
                  task={task}
                />
              );
            })}
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
    </div>
  );
}
