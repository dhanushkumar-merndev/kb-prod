"use client";

import { Coffee, TimerReset } from "lucide-react";
import { useActionState, useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";

import { endBreakAction, startBreakAction } from "./actions";
import styles from "./session-controls.module.css";
import {
  INITIAL_SESSION_CONTROL_STATE,
  type ActiveBreak,
  type SessionControlActionState,
  type SessionSummaryData,
} from "./types";

const BREAK_LABELS = {
  lunch: "Lunch",
  break: "General break",
  superfone: "Superfone",
} as const;

function formatSessionTime(value: string | null): string {
  if (!value) {
    return "Current secure session";
  }

  return `Signed in ${new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value))}`;
}

function PendingButton({ activeBreak }: { activeBreak: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button disabled={pending} type="submit">
      {pending ? "Saving…" : activeBreak ? "End break" : "Start"}
    </button>
  );
}

function Feedback({ state }: { state: SessionControlActionState }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const visible = state.status !== "idle" && dismissed !== state.mutationId;

  useEffect(() => {
    if (state.status !== "success") {
      return;
    }

    const timer = window.setTimeout(() => setDismissed(state.mutationId), 3000);
    return () => window.clearTimeout(timer);
  }, [state.mutationId, state.status]);

  return visible ? (
    <div
      className={styles.feedback}
      data-tone={state.status}
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
  ) : null;
}

export function BreakControls({ activeBreak }: { activeBreak: ActiveBreak | null }) {
  const breakTypeId = useId();
  const [startState, startAction] = useActionState(
    startBreakAction,
    INITIAL_SESSION_CONTROL_STATE,
  );
  const [endState, endAction] = useActionState(endBreakAction, INITIAL_SESSION_CONTROL_STATE);

  return (
    <div className={styles.breakControls}>
      {activeBreak ? (
        <form action={endAction}>
          <input name="breakSessionId" type="hidden" value={activeBreak.id} />
          <span>
            <Coffee aria-hidden="true" size={14} />
            {BREAK_LABELS[activeBreak.breakType]} active
          </span>
          <PendingButton activeBreak />
        </form>
      ) : (
        <form action={startAction}>
          <label htmlFor={breakTypeId}>Break</label>
          <select
            aria-label="Break type"
            defaultValue="break"
            id={breakTypeId}
            name="breakType"
          >
            <option value="break">General</option>
            <option value="lunch">Lunch</option>
            <option value="superfone">Superfone</option>
          </select>
          <PendingButton activeBreak={false} />
        </form>
      )}
      <Feedback state={activeBreak ? endState : startState} />
    </div>
  );
}

export function SessionSummary({
  data,
  showBreakControls,
}: {
  data: SessionSummaryData;
  showBreakControls: boolean;
}) {
  return (
    <section
      className={styles.summary}
      aria-label={showBreakControls ? "Session and break controls" : "Session summary"}
    >
      <div className={styles.sessionTime}>
        <TimerReset aria-hidden="true" size={14} />
        <span>{formatSessionTime(data.loginAt)}</span>
      </div>
      {showBreakControls ? <BreakControls activeBreak={data.activeBreak} /> : null}
    </section>
  );
}
