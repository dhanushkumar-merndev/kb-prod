"use client";

import { Award, CheckCircle2, ClipboardCheck, Target, Trophy } from "lucide-react";
import { useActionState } from "react";

import {
  ActionFeedback,
  FieldError,
  SubmitButton,
} from "@/features/core-crud/components/shared";
import { INITIAL_CRUD_ACTION_STATE } from "@/features/core-crud/types";

import { reviewSalesComplianceAction } from "./actions";
import { getSalesRating } from "./rating";
import styles from "./sales-performance.module.css";
import { SALES_COMPLIANCE_CRITERIA, type SalesComplianceData, type SalesComplianceRow } from "./types";

function Stars({ count }: { count: number }) {
  return (
    <span aria-label={`${count} out of 5 stars`} className={styles.stars}>
      {Array.from({ length: 5 }, (_, index) => (
        <span aria-hidden="true" className={index < count ? styles.starActive : styles.starIdle} key={index}>
          ★
        </span>
      ))}
    </span>
  );
}

function ReviewForm({ date, row }: { date: string; row: SalesComplianceRow }) {
  const [state, action] = useActionState(reviewSalesComplianceAction, INITIAL_CRUD_ACTION_STATE);
  return (
    <form action={action} className={styles.reviewForm}>
      <input name="salesProfileId" type="hidden" value={row.salesProfileId} />
      <input name="scoreDate" type="hidden" value={date} />
      <label>
        Manager marks (0–5)
        <input defaultValue={row.managerScore} max={5} min={0} name="managerScore" type="number" />
        <FieldError field="managerScore" state={state} />
      </label>
      <label>
        Quality and professionalism remarks
        <textarea defaultValue={row.managerRemarks ?? ""} maxLength={1000} name="remarks" required />
        <FieldError field="remarks" state={state} />
      </label>
      <SubmitButton pendingLabel="Saving review…" tone="secondary">Save review</SubmitButton>
      <ActionFeedback state={state} />
    </form>
  );
}

export function SalesPerformanceWorkspace({ data }: { data: SalesComplianceData }) {
  const top = data.rows[0];
  return (
    <div className={styles.workspace}>
      <section className={styles.hero}>
        <div className={styles.heroIcon}><Target aria-hidden="true" size={30} /></div>
        <div>
          <span className={styles.eyebrow}>Daily sales performance</span>
          <h2>Sales score</h2>
          <p>Track sales activity, follow-up quality, and customer response performance.</p>
        </div>
        <div className={styles.heroDate}>
          <ClipboardCheck aria-hidden="true" size={20} />
          {new Intl.DateTimeFormat("en-IN", { dateStyle: "long", timeZone: "Asia/Kolkata" }).format(
            new Date(`${data.scoreDate}T00:00:00+05:30`),
          )}
        </div>
      </section>

      <section className={styles.summaryGrid}>
        <div><span>Team members</span><strong>{data.rows.length}</strong></div>
        <div><span>Top score</span><strong>{top?.totalScore ?? 0}/100</strong></div>
        <div><span>Current leader</span><strong>{top?.fullName ?? "No score yet"}</strong></div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div><span className={styles.eyebrow}>Live ranking</span><h3>Sales leaderboard</h3></div>
          <Trophy aria-hidden="true" size={24} />
        </div>
        {data.rows.length === 0 ? (
          <div className={styles.empty}><strong>No active Sales Members</strong><p>Create and activate a Sales Member to begin ranking.</p></div>
        ) : (
          <div className={styles.rankingList}>
            {data.rows.map((row) => {
              const rating = getSalesRating(row.totalScore);
              return (
                <article className={styles.rankingCard} key={row.salesProfileId}>
                  <div className={styles.rank}>#{row.rank}</div>
                  <div className={styles.person}>
                    <strong>{row.fullName}</strong>
                    <span>{row.assignedLeads} assigned lead{row.assignedLeads === 1 ? "" : "s"}</span>
                  </div>
                  <div className={styles.scoreBar}>
                    <span style={{ width: `${row.totalScore}%` }} />
                  </div>
                  <div className={`${styles.rating} ${styles[rating.tone]}`}>
                    <strong>{row.totalScore}</strong><span>/100</span>
                    <Stars count={rating.stars} />
                    <small>{rating.label}</small>
                  </div>
                  <details className={styles.breakdown}>
                    <summary>Score breakdown</summary>
                    <dl>
                      {SALES_COMPLIANCE_CRITERIA.map((criterion) => (
                        <div key={criterion.key}>
                          <dt>{criterion.label}</dt>
                          <dd>{row[criterion.key]}/{criterion.maxMarks}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className={styles.guidance}><Award aria-hidden="true" size={16} /> {rating.guidance}</p>
                    {data.canReview ? <ReviewForm date={data.scoreDate} row={row} /> : row.managerRemarks ? (
                      <p className={styles.managerRemark}><strong>Manager:</strong> {row.managerRemarks}</p>
                    ) : null}
                  </details>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div><span className={styles.eyebrow}>Scoring rules</span><h3>KPI criteria</h3></div>
          <CheckCircle2 aria-hidden="true" size={24} />
        </div>
        <div className={styles.criteriaTableWrap}>
          <table className={styles.criteriaTable}>
            <thead><tr><th>#</th><th>KPI / criteria</th><th>Description</th><th>Max marks</th></tr></thead>
            <tbody>
              {SALES_COMPLIANCE_CRITERIA.map((criterion, index) => (
                <tr key={criterion.key}><td>{index + 1}</td><th scope="row">{criterion.label}</th><td>{criterion.description}</td><td>{criterion.maxMarks}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>Total</td><td>100</td></tr></tfoot>
          </table>
        </div>
      </section>

      <section className={styles.ratingScale} aria-label="Rating scale">
        {[100, 94, 84, 74, 59].map((score) => {
          const rating = getSalesRating(score);
          const range = score === 100 ? "95–100" : score === 94 ? "85–94" : score === 84 ? "75–84" : score === 74 ? "60–74" : "Below 60";
          return <div className={styles[rating.tone]} key={range}><Stars count={rating.stars} /><strong>{range}</strong><span>{rating.label}</span><small>{rating.guidance}</small></div>;
        })}
      </section>

      <section className={styles.notes}>
        <div><h3>Key notes</h3><p>CRM updates are mandatory; incomplete records reduce the daily score.</p><p>Consistent quality updates lead to better follow-ups and more bookings.</p></div>
        <div><h3>Best practices</h3><p>Call every new lead within the 15-minute SLA.</p><p>Use accurate tags, schedule the next action, and add clear call notes.</p></div>
      </section>
    </div>
  );
}
