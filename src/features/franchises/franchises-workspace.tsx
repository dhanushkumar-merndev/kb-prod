"use client";

import { Building2, UserRoundX } from "lucide-react";
import { useActionState } from "react";

import { ActionFeedback, SubmitButton } from "@/features/core-crud/components/shared";
import { INITIAL_CRUD_ACTION_STATE } from "@/features/core-crud/types";

import { createFranchiseAction, updateFranchiseAction } from "./actions";
import type { FranchiseSummary } from "./queries";
import styles from "./franchises.module.css";

function FranchiseEditForm({ franchise }: { franchise: FranchiseSummary }) {
  const [state, action] = useActionState(updateFranchiseAction, INITIAL_CRUD_ACTION_STATE);

  return (
    <>
      <form action={action} className={styles.formGrid}>
        <input name="franchiseId" type="hidden" value={franchise.id} />
        <label>
          Franchise name
          <input defaultValue={franchise.name} name="name" required />
        </label>
        <label>
          City
          <input defaultValue={franchise.city ?? ""} name="city" />
        </label>
        <label>
          Contact number
          <input defaultValue={franchise.contactPhone ?? ""} inputMode="tel" name="contactPhone" />
        </label>
        <label>
          Status
          <select defaultValue={String(franchise.isActive)} name="isActive">
            <option value="true">Active</option>
            <option value="false">Closed</option>
          </select>
        </label>
        <label>
          Notes
          <input defaultValue={franchise.notes ?? ""} name="notes" />
        </label>
        <label>
          Reason for change
          <input name="reason" placeholder="Why is this changing?" required />
        </label>
        <div className={styles.actions}>
          <SubmitButton pendingLabel="Saving…">Save franchise</SubmitButton>
        </div>
      </form>
      <ActionFeedback state={state} />
    </>
  );
}

export function FranchisesWorkspace({ franchises }: { franchises: FranchiseSummary[] }) {
  const [createState, createAction] = useActionState(
    createFranchiseAction,
    INITIAL_CRUD_ACTION_STATE,
  );

  return (
    <div className={styles.stack}>
      <section className={styles.section}>
        <h2>Create franchise</h2>
        <p>
          Each franchise runs its own Manager, HR, Sales Manager, Sales Executives and kitchen team,
          and sees only its own leads, bookings, attendance and payroll.
        </p>
        <form action={createAction} className={styles.formGrid}>
          <label>
            Franchise name
            <input name="name" placeholder="Chennai Central" required />
          </label>
          <label>
            Short code
            <input
              maxLength={16}
              name="code"
              pattern="[A-Za-z0-9][A-Za-z0-9_\-]{0,15}"
              placeholder="CHN"
              required
              title="2-16 letters, digits, hyphen or underscore."
            />
          </label>
          <label>
            City
            <input name="city" placeholder="Chennai" />
          </label>
          <label>
            Contact number
            <input inputMode="tel" name="contactPhone" placeholder="+91…" />
          </label>
          <label>
            Notes
            <input name="notes" placeholder="Optional internal note" />
          </label>
          <div className={styles.actions}>
            <SubmitButton pendingLabel="Creating…">Create franchise</SubmitButton>
          </div>
        </form>
        <ActionFeedback state={createState} />
      </section>

      <section className={styles.section}>
        <div className={styles.header}>
          <div>
            <h2>Franchises</h2>
            <p>Only the Director can create a franchise or change which one a person belongs to.</p>
          </div>
          <span>{franchises.length}</span>
        </div>

        {franchises.length === 0 ? (
          <div className={styles.empty}>
            <Building2 aria-hidden="true" size={28} />
            <strong>No franchises yet</strong>
            <p>Create the first franchise above, then add its Franchise Owner in Team &amp; Access.</p>
          </div>
        ) : (
          <ul className={styles.list}>
            {franchises.map((franchise) => (
              <li key={franchise.id}>
                <div className={styles.profileTop}>
                  <div>
                    <strong>{franchise.name}</strong>
                    <span>
                      {franchise.code}
                      {franchise.city ? ` · ${franchise.city}` : ""} ·{" "}
                      {franchise.activeStaffCount} active{" "}
                      {franchise.activeStaffCount === 1 ? "person" : "people"}
                    </span>
                  </div>
                  <span className={styles.badge}>{franchise.isActive ? "active" : "closed"}</span>
                </div>
                {!franchise.ownerAssigned ? (
                  <p className={styles.warning}>
                    <UserRoundX aria-hidden="true" size={16} />
                    No Franchise Owner yet. Create one from Team &amp; Access so this franchise can
                    run itself.
                  </p>
                ) : null}
                <FranchiseEditForm franchise={franchise} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
