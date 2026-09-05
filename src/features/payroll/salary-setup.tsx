"use client";

import { useActionState, useState } from "react";
import {
  ActionFeedback,
  FieldError,
  SubmitButton,
  formatMoney,
} from "@/features/core-crud/components/shared";
import { INITIAL_CRUD_ACTION_STATE } from "@/features/core-crud/types";
import { saveSalaryStructureAction } from "./actions";
import { SALARY_FIELDS, type PayrollWorkspaceData } from "./types";
import styles from "./payroll.module.css";

export function SalarySetup({ data }: { data: PayrollWorkspaceData }) {
  const [profileId, setProfileId] = useState(data.workforce[0]?.id ?? "");
  const [state, action] = useActionState(saveSalaryStructureAction, INITIAL_CRUD_ACTION_STATE);
  const structure = data.salaryStructures.find((s) => s.profile_id === profileId);
  const person = data.workforce.find((p) => p.id === profileId);
  return (
    <details className={styles.card}>
      <summary>Salary setup</summary>
      <p className={styles.workflowNote}>
        Save monthly components once before generating payroll. Changes apply to future drafts.
        Basic pay comes from Employee Records.
      </p>
      <label className={styles.selectLabel}>
        Employee
        <select value={profileId} onChange={(event) => setProfileId(event.target.value)}>
          {data.workforce.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {person ? (
        <>
          <p>
            Basic pay: {formatMoney(person.paymentAmount ?? "0")} /{" "}
            {person.paymentType?.replaceAll("_", " ") ?? "not configured"}
          </p>
          <form
            action={action}
            className={styles.adjustmentForm}
            key={`${profileId}-${structure?.version ?? 0}`}
          >
            <input name="profileId" type="hidden" value={profileId} />
            <input name="expectedVersion" type="hidden" value={structure?.version ?? 0} />
            <label>
              Effective from
              <input
                name="effectiveFrom"
                type="date"
                required
                defaultValue={structure?.effective_from}
              />
              <FieldError field="effectiveFrom" state={state} />
            </label>
            {Object.entries(SALARY_FIELDS).map(([field, label]) => (
              <label key={field}>
                {label}
                <input
                  name={field}
                  type="number"
                  min="0"
                  max="999999999.99"
                  step="0.01"
                  required
                  defaultValue={structure?.[field as keyof typeof SALARY_FIELDS] ?? "0"}
                />
                <FieldError field={field} state={state} />
              </label>
            ))}
            <label className={`${styles.confirmLabel} ${styles.wide}`}>
              <input
                name="paidLeave"
                type="checkbox"
                value="true"
                defaultChecked={structure?.paid_leave ?? false}
              />
              Approved leave is paid leave (does not reduce monthly salary)
            </label>
            <p className={styles.wide}>
              Use the first day of the effective month. Monthly staff are paid for the full
              calendar month; only days marked absent in Attendance, and approved leave when the
              box above is unticked, reduce payable days. Earnings and employer contributions are
              prorated by payable days; configured employee deductions are prorated by the period
              length. PF and ESIC stay off while left at zero — enter amounts only if your payroll
              policy applies them.
            </p>
            <div className={styles.wide}>
              <SubmitButton>Save Salary Structure</SubmitButton>
            </div>
          </form>
        </>
      ) : (
        <p>No workforce employees available.</p>
      )}
      <ActionFeedback state={state} />
    </details>
  );
}
