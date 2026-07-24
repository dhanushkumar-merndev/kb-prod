"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import {
  ActionFeedback,
  EmptyState,
  SubmitButton,
  formatDate,
  formatMoney,
} from "@/features/core-crud/components/shared";
import { INITIAL_CRUD_ACTION_STATE } from "@/features/core-crud/types";

import { updateWorkforceCompensationAction, uploadEmployeeDocumentAction } from "./actions";
import styles from "./employee-records.module.css";
import type { EmployeeRecord } from "./types";

const EMPLOYEES_PER_PAGE = 10;

function CompensationForm({ employee }: { employee: EmployeeRecord }) {
  const [state, action] = useActionState(
    updateWorkforceCompensationAction,
    INITIAL_CRUD_ACTION_STATE,
  );

  return (
    <>
      <form action={action} className={styles.form}>
        <input name="profileId" type="hidden" value={employee.id} />
        <input name="expectedUpdatedAt" type="hidden" value={employee.updatedAt} />
        <label>
          Joining date
          <input
            defaultValue={employee.joiningDate ?? ""}
            name="joiningDate"
            required
            type="date"
          />
        </label>
        <label>
          Pay type
          <select defaultValue={employee.paymentType ?? ""} name="paymentType" required>
            <option disabled value="">
              Select pay type
            </option>
            {employee.role === "chef" ? <option value="monthly">Monthly</option> : null}
            <option value="daily">Daily</option>
            <option value="hourly">Hourly</option>
            <option value="per_booking">Per booking</option>
          </select>
        </label>
        <label>
          Pay amount
          <input
            defaultValue={employee.paymentAmount ?? ""}
            min="0"
            name="paymentAmount"
            required
            step="0.01"
            type="number"
          />
        </label>
        <SubmitButton pendingLabel="Saving pay structure…">Save pay structure</SubmitButton>
      </form>
      <ActionFeedback state={state} />
    </>
  );
}

function DocumentForm({
  documentType,
  employee,
}: {
  documentType: "aadhaar" | "part-time-payment-proof";
  employee: EmployeeRecord;
}) {
  const [state, action] = useActionState(uploadEmployeeDocumentAction, INITIAL_CRUD_ACTION_STATE);
  const isPaymentProof = documentType === "part-time-payment-proof";

  return (
    <>
      <form action={action} className={styles.form}>
        <input name="profileId" type="hidden" value={employee.id} />
        <input name="expectedUpdatedAt" type="hidden" value={employee.updatedAt} />
        <input name="documentType" type="hidden" value={documentType} />
        <label>
          {isPaymentProof ? "Payment proof" : "Aadhaar document"}
          <input
            accept="image/jpeg,image/png,image/webp,application/pdf"
            name="document"
            required
            type="file"
          />
        </label>
        {isPaymentProof ? (
          <label>
            Payment amount
            <input
              defaultValue={employee.partTimePaymentAmount ?? ""}
              min="0"
              name="paymentAmount"
              required
              step="0.01"
              type="number"
            />
          </label>
        ) : null}
        <SubmitButton pendingLabel="Uploading document…">
          {isPaymentProof ? "Save payment proof" : "Save Aadhaar"}
        </SubmitButton>
      </form>
      <ActionFeedback state={state} />
    </>
  );
}

function EmployeeCard({ employee }: { employee: EmployeeRecord }) {
  return (
    <li className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <h2>{employee.fullName}</h2>
          <p>{employee.phoneE164}</p>
        </div>
        <span>{employee.accountStatus.replaceAll("_", " ")}</span>
      </div>
      <dl className={styles.summary}>
        <div>
          <dt>Role</dt>
          <dd>{employee.role === "chef" ? "Chef" : "Part-time Chef"}</dd>
        </div>
        <div>
          <dt>Joined</dt>
          <dd>{formatDate(employee.joiningDate)}</dd>
        </div>
        <div>
          <dt>Pay</dt>
          <dd>
            {formatMoney(employee.paymentAmount)} ·{" "}
            {employee.paymentType?.replaceAll("_", " ") ?? "Not configured"}
          </dd>
        </div>
      </dl>
      <div className={styles.documentLinks}>
        {employee.aadhaarUrl ? (
          <a href={employee.aadhaarUrl} rel="noreferrer" target="_blank">
            Open Aadhaar
          </a>
        ) : (
          <span>Aadhaar not uploaded</span>
        )}
        {employee.role === "part_time_chef" ? (
          employee.paymentProofUrl ? (
            <a href={employee.paymentProofUrl} rel="noreferrer" target="_blank">
              Open payment proof
            </a>
          ) : (
            <span>Payment proof not uploaded</span>
          )
        ) : null}
      </div>
      <details>
        <summary>Edit pay structure</summary>
        <CompensationForm employee={employee} />
      </details>
      <details>
        <summary>Upload or replace Aadhaar</summary>
        <DocumentForm documentType="aadhaar" employee={employee} />
      </details>
      {employee.role === "part_time_chef" ? (
        <details>
          <summary>Upload or replace payment proof</summary>
          <DocumentForm documentType="part-time-payment-proof" employee={employee} />
        </details>
      ) : null}
    </li>
  );
}

export function EmployeeRecordsWorkspace({ records }: { records: EmployeeRecord[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? records.filter(
          (record) =>
            record.fullName.toLowerCase().includes(needle) || record.phoneE164.includes(needle),
        )
      : records;
  }, [query, records]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / EMPLOYEES_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const visibleRecords = filtered.slice(
    (safePage - 1) * EMPLOYEES_PER_PAGE,
    safePage * EMPLOYEES_PER_PAGE,
  );

  return (
    <section className={styles.workspace}>
      <div className={styles.toolbar}>
        <label htmlFor="employee-search">Search employees</label>
        <input
          id="employee-search"
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder="Name or phone"
          type="search"
          value={query}
        />
        <span>{filtered.length} employees</span>
      </div>
      {visibleRecords.length === 0 ? (
        <EmptyState
          title="No employee records"
          message="No workforce employee matches the current search."
        />
      ) : (
        <ul className={styles.list}>
          {visibleRecords.map((employee) => (
            <EmployeeCard employee={employee} key={employee.id} />
          ))}
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
  );
}
