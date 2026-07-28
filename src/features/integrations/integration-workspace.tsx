"use client";

import { MailCheck, Play, Save } from "lucide-react";
import { useActionState } from "react";

import { ActionFeedback, SubmitButton } from "@/features/core-crud/components/shared";
import { INITIAL_CRUD_ACTION_STATE } from "@/features/core-crud/types";

import {
  processEmailQueueAction,
  saveEmailIntegrationAction,
  testBrevoConnectionAction,
} from "./actions";
import styles from "./integrations.module.css";
import type { EmailIntegrationData } from "./types";

function date(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function IntegrationWorkspace({ data }: { data: EmailIntegrationData }) {
  const [settingsState, settingsAction] = useActionState(
    saveEmailIntegrationAction,
    INITIAL_CRUD_ACTION_STATE,
  );
  const [testState, testAction] = useActionState(
    testBrevoConnectionAction,
    INITIAL_CRUD_ACTION_STATE,
  );
  const [processState, processAction] = useActionState(
    processEmailQueueAction,
    INITIAL_CRUD_ACTION_STATE,
  );

  return (
    <div className={styles.stack}>
      <section className={styles.card}>
        <div className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Transactional email</span>
            <h2>Brevo connection</h2>
            <p>Credentials stay in Supabase Edge Function secrets and are never shown here.</p>
          </div>
          <span className={styles.status}>{data.connection?.status ?? "not tested"}</span>
        </div>
        <dl className={styles.healthGrid}>
          <div>
            <dt>Account</dt>
            <dd>{data.connection?.account ?? "Not verified"}</dd>
          </div>
          <div>
            <dt>Last tested</dt>
            <dd>{date(data.connection?.lastTestedAt ?? null)}</dd>
          </div>
          <div>
            <dt>Queued</dt>
            <dd>{data.queuedCount}</dd>
          </div>
          <div>
            <dt>Failed</dt>
            <dd>{data.failedCount}</dd>
          </div>
        </dl>
        {data.connection?.lastError ? (
          <p className={styles.error}>Last safe error: {data.connection.lastError}</p>
        ) : null}
        <div className={styles.actions}>
          <form action={testAction}>
            <SubmitButton pendingLabel="Testing…">
              <MailCheck size={16} /> Test connection
            </SubmitButton>
          </form>
          <form action={processAction}>
            <SubmitButton pendingLabel="Processing…" tone="secondary">
              <Play size={16} /> Process queue now
            </SubmitButton>
          </form>
        </div>
        <ActionFeedback state={testState} />
        <ActionFeedback state={processState} />
      </section>

      <section className={styles.card}>
        <div className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Production safety</span>
            <h2>Email and invoice settings</h2>
            <p>Keep automation off until the sender domain, webhook, and cron are verified.</p>
          </div>
        </div>
        <form action={settingsAction} className={styles.form}>
          <label>
            Sender name
            <input defaultValue={data.senderName} name="senderName" required />
          </label>
          <label>
            Verified sender email
            <input defaultValue={data.senderEmail} name="senderEmail" required type="email" />
          </label>
          <label>
            Invoice prefix
            <input defaultValue={data.invoicePrefix} maxLength={8} name="invoicePrefix" required />
          </label>
          <label>
            Daily send cap
            <input
              defaultValue={data.dailySendCap}
              max={300}
              min={1}
              name="dailySendCap"
              required
              type="number"
            />
          </label>
          <label className={styles.wide}>
            Payment instructions
            <textarea
              defaultValue={data.invoicePaymentInstructions}
              name="invoicePaymentInstructions"
              rows={3}
            />
          </label>
          <label className={styles.wide}>
            Invoice terms
            <textarea defaultValue={data.invoiceTerms} name="invoiceTerms" required rows={3} />
          </label>
          <label className={`${styles.toggle} ${styles.wide}`}>
            <input
              defaultChecked={data.automationEnabled}
              name="automationEnabled"
              type="checkbox"
            />
            Enable automatic customer email
          </label>
          <div className={`${styles.actions} ${styles.wide}`}>
            <SubmitButton pendingLabel="Saving…">
              <Save size={16} /> Save settings
            </SubmitButton>
          </div>
        </form>
        <ActionFeedback state={settingsState} />
      </section>
    </div>
  );
}
