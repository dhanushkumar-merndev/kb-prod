"use client";

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";

import { ActionFeedback, SubmitButton } from "@/features/core-crud/components/shared";
import { INITIAL_CRUD_ACTION_STATE } from "@/features/core-crud/types";
import { ROLE_LABELS, type Role } from "@/lib/constants/roles";

import { createTeamMemberAction, updateTeamMemberStatusAction } from "./actions";
import styles from "./team-access.module.css";

interface TeamAccessData {
  viewerId: string;
  viewerRole: Role;
  viewerFranchiseName: string | null;
  creatableRoles: readonly Role[];
  needsFranchiseChoice: boolean;
  franchiseOptions: Array<{ id: string; name: string; code: string }>;
  page: number;
  pageSize: number;
  profiles: Array<{
    id: string;
    full_name: string;
    phone_e164: string;
    franchise_id: string | null;
    franchise_name: string | null;
    role: Role;
    account_status: "active" | "inactive" | "blocked" | "payment_pending" | "left_organization";
    joining_date: string | null;
    last_login_at: string | null;
  }>;
  search: string;
  total: number;
}

function currentIndiaDate(): string {
  const indiaOffsetMilliseconds = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + indiaOffsetMilliseconds).toISOString().slice(0, 10);
}

function StatusForm({ profile }: { profile: TeamAccessData["profiles"][number] }) {
  const [state, action] = useActionState(updateTeamMemberStatusAction, INITIAL_CRUD_ACTION_STATE);

  return (
    <>
      <form action={action} className={styles.statusForm}>
        <input name="targetProfileId" type="hidden" value={profile.id} />
        <select defaultValue={profile.account_status} name="accountStatus">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="blocked">Blocked</option>
          {profile.role === "part_time_chef" ? (
            <option value="payment_pending">Payment pending</option>
          ) : null}
          <option value="left_organization">Left organization</option>
        </select>
        <input name="reason" placeholder="Reason for account change" required />
        <SubmitButton>Update access</SubmitButton>
      </form>
      <ActionFeedback state={state} />
    </>
  );
}

export function TeamAccessWorkspace({ data }: { data: TeamAccessData }) {
  const pathname = usePathname();
  const router = useRouter();
  const currentSearchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(data.search);
  const [selectedRole, setSelectedRole] = useState<Role>(data.creatableRoles[0] ?? "sales");
  const [isNavigating, startNavigation] = useTransition();
  const [createState, createAction] = useActionState(
    createTeamMemberAction,
    INITIAL_CRUD_ACTION_STATE,
  );
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  const isChefRole = selectedRole === "chef" || selectedRole === "part_time_chef";

  const navigate = (updates: { page?: number; search?: string }) => {
    const params = new URLSearchParams(currentSearchParams.toString());

    if (updates.search !== undefined) {
      const value = updates.search.trim();
      if (value) {
        params.set("teamSearch", value);
      } else {
        params.delete("teamSearch");
      }
      params.delete("teamPage");
    }

    if (updates.page !== undefined) {
      if (updates.page > 1) {
        params.set("teamPage", String(updates.page));
      } else {
        params.delete("teamPage");
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
    // Navigation helpers intentionally use the current URL values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.search, pathname, searchInput]);

  return (
    <div className={styles.stack}>
      {data.creatableRoles.length > 0 ? (
        <section className={styles.section}>
          <h2>Create team member</h2>
          {data.needsFranchiseChoice && data.franchiseOptions.length === 0 ? (
            <p>Create a franchise first — every account below the Director belongs to one.</p>
          ) : null}
          <form action={createAction} className={styles.formGrid}>
            <label>
              Full name
              <input name="fullName" required />
            </label>
            <label>
              Phone number
              <input inputMode="tel" name="phone" required />
            </label>
            <label>
              Role
              <select
                name="role"
                onChange={(event) => setSelectedRole(event.target.value as Role)}
                required
                value={selectedRole}
              >
                {data.creatableRoles.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
            {data.needsFranchiseChoice ? (
              <label>
                Franchise
                <select name="franchiseId" required>
                  <option value="">Select a franchise…</option>
                  {data.franchiseOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name} ({option.code})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              Temporary password
              <input minLength={8} name="password" required type="password" />
            </label>
            <label>
              Joining date
              <input defaultValue={currentIndiaDate()} name="joiningDate" type="date" />
            </label>
            {isChefRole ? (
              <>
                <label>
                  Payment type
                  <select defaultValue="" name="paymentType" required>
                    <option value="" disabled>
                      Select payment type…
                    </option>
                    <option value="monthly">Monthly</option>
                    <option value="daily">Daily</option>
                    <option value="hourly">Hourly</option>
                    <option value="per_booking">Per booking</option>
                  </select>
                </label>
                <label>
                  Payment amount
                  <input min="0" name="paymentAmount" required step="0.01" type="number" />
                </label>
              </>
            ) : null}
            <div className={styles.actions}>
              <SubmitButton pendingLabel="Creating…">Create account</SubmitButton>
            </div>
          </form>
          <ActionFeedback state={createState} />
        </section>
      ) : null}

      <section className={styles.section}>
        <div className={styles.header}>
          <div>
            <h2>Team access</h2>
            <p>
              {data.viewerFranchiseName
                ? `${data.viewerFranchiseName} staff only. `
                : "Every franchise. "}
              Account changes are enforced immediately by Auth, RLS and session checks.
            </p>
          </div>
          <span>{data.total}</span>
        </div>
        <div className={styles.toolbar}>
          <label className={styles.searchControl}>
            <Search aria-hidden="true" size={18} />
            <span className={styles.srOnly}>Search team accounts</span>
            <input
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search name or phone…"
              type="search"
              value={searchInput}
            />
          </label>
          <span className={styles.resultSummary} aria-live="polite">
            {isNavigating ? "Searching…" : `${data.total} account${data.total === 1 ? "" : "s"}`}
          </span>
        </div>
        {data.profiles.length === 0 ? (
          <div className={styles.empty}>
            <strong>{data.search ? "No matching accounts" : "No team accounts"}</strong>
            <p>
              {data.search
                ? "Try a different name or phone number."
                : "Created team accounts will appear here."}
            </p>
          </div>
        ) : (
          <ul className={styles.list}>
            {data.profiles.map((profile) => (
              <li key={profile.id}>
                <div className={styles.profileTop}>
                  <div>
                    <strong>{profile.full_name}</strong>
                    <span>
                      {ROLE_LABELS[profile.role]} · {profile.phone_e164}
                      {profile.franchise_name ? ` · ${profile.franchise_name}` : ""}
                    </span>
                  </div>
                  <span className={styles.badge}>
                    {profile.account_status.replaceAll("_", " ")}
                  </span>
                </div>
                {profile.id !== data.viewerId && profile.role !== "director" ? (
                  <StatusForm profile={profile} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <div className={styles.pagination}>
          <span>
            Page {Math.min(data.page, pageCount)} of {pageCount}
          </span>
          <div>
            <button
              disabled={data.page <= 1 || isNavigating}
              onClick={() => navigate({ page: data.page - 1 })}
              type="button"
            >
              <ChevronLeft aria-hidden="true" size={18} />
              Previous
            </button>
            <button
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
    </div>
  );
}
