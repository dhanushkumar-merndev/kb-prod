import { Suspense } from "react";
import Link from "next/link";

import { DashboardChart } from "./dashboard-chart";
import { loadCurrentDashboardData } from "./dashboard-data";
import styles from "./dashboard.module.css";
import type { DashboardLoadResult } from "./types";
import { ROLE_LABELS } from "@/lib/constants/roles";

function MetricGridSkeleton() {
  return (
    <div className={styles.metricGrid} aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div className={styles.skeletonCard} key={index}>
          <span />
          <strong />
          <span />
        </div>
      ))}
    </div>
  );
}

export function DashboardLoading() {
  return (
    <div className={styles.dashboard} role="status" aria-live="polite">
      <span className={styles.srOnly}>Loading live dashboard data.</span>
      <div className={styles.skeletonHeader} aria-hidden="true">
        <span />
        <strong />
        <span />
      </div>
      <MetricGridSkeleton />
      <div className={styles.skeletonChart} aria-hidden="true" />
    </div>
  );
}

export function DashboardResultView({ result }: { result: DashboardLoadResult }) {
  if (!result.ok) {
    return (
      <div className={styles.dashboard}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>{ROLE_LABELS[result.role]}</p>
            <h1>{result.title}</h1>
            <p>Welcome, {result.profileName}.</p>
          </div>
        </header>
        <section className={styles.errorState} role="alert">
          <span className={styles.errorMark} aria-hidden="true">
            !
          </span>
          <div>
            <h2>Dashboard unavailable</h2>
            <p>{result.message}</p>
          </div>
        </section>
      </div>
    );
  }

  const { data } = result;
  const updatedTime = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(data.updatedAt));

  return (
    <div className={styles.dashboard}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>{ROLE_LABELS[data.role]}</p>
          <h1>{data.title}</h1>
          <p>
            Welcome, {data.profileName}. {data.subtitle}
          </p>
        </div>
        <span className={styles.updatedAt}>Live data · Updated {updatedTime}</span>
      </header>

      <section aria-labelledby="dashboard-kpis-title">
        <h2 id="dashboard-kpis-title" className={styles.srOnly}>
          Current key performance indicators
        </h2>
        <div className={styles.metricGrid}>
          {data.metrics.map((metric) => (
            <article className={styles.metricCard} data-tone={metric.tone} key={metric.id}>
              <span className={styles.metricLabel}>{metric.label}</span>
              <strong className={styles.metricValue}>{metric.value.toLocaleString("en-IN")}</strong>
              <span className={styles.metricDescription}>{metric.description}</span>
            </article>
          ))}
        </div>
      </section>

      <DashboardChart
        title={data.chart.title}
        description={data.chart.description}
        items={data.chart.items}
      />

      {data.nextBooking ? (
        <section className={styles.nextBooking} aria-labelledby="next-booking-title">
          <div>
            <p className={styles.eyebrow}>Next assigned booking</p>
            <h2 id="next-booking-title">
              {data.nextBooking.bookingCode} · {data.nextBooking.eventType}
            </h2>
            <p>
              {new Intl.DateTimeFormat("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                timeZone: "Asia/Kolkata",
              }).format(new Date(`${data.nextBooking.eventDate}T00:00:00+05:30`))}
              {data.nextBooking.reportingTime
                ? ` · Report by ${data.nextBooking.reportingTime.slice(0, 5)}`
                : ""}
            </p>
          </div>
          <dl>
            <div>
              <dt>Venue</dt>
              <dd>{data.nextBooking.venue}</dd>
            </div>
            <div>
              <dt>Guests</dt>
              <dd>{data.nextBooking.guestCount.toLocaleString("en-IN")}</dd>
            </div>
          </dl>
          <Link
            href={`/${data.role === "part_time_chef" ? "part-time-chef" : "chef"}/jobs`}
            className={styles.actionLink}
          >
            Open job
          </Link>
        </section>
      ) : null}

      <div className={styles.dashboardDetails}>
        <section className={styles.detailCard} aria-labelledby="pending-actions-title">
          <div className={styles.detailHeader}>
            <div>
              <p className={styles.eyebrow}>Work queue</p>
              <h2 id="pending-actions-title">Pending actions</h2>
            </div>
            <span>{data.pendingActions.length}</span>
          </div>
          {data.pendingActions.length === 0 ? (
            <p className={styles.detailEmpty}>No pending actions in your current scope.</p>
          ) : (
            <ul className={styles.actionList}>
              {data.pendingActions.map((action) => (
                <li data-tone={action.tone} key={action.id}>
                  <Link href={action.href}>
                    <span>
                      <strong>{action.label}</strong>
                      <small>{action.description}</small>
                    </span>
                    <b>{action.count.toLocaleString("en-IN")}</b>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.detailCard} aria-labelledby="recent-activity-title">
          <div className={styles.detailHeader}>
            <div>
              <p className={styles.eyebrow}>Notifications</p>
              <h2 id="recent-activity-title">Recent activity</h2>
            </div>
            <span>{data.recentActivity.length}</span>
          </div>
          {data.recentActivity.length === 0 ? (
            <p className={styles.detailEmpty}>
              New workflow updates and approvals will appear here.
            </p>
          ) : (
            <ul className={styles.activityList}>
              {data.recentActivity.map((activity) => (
                <li key={activity.id}>
                  <span
                    aria-label={activity.unread ? "Unread" : "Read"}
                    className={activity.unread ? styles.unreadMark : styles.readMark}
                  />
                  <div>
                    <strong>{activity.title}</strong>
                    {activity.body ? <p>{activity.body}</p> : null}
                    <time dateTime={activity.occurredAt}>
                      {new Intl.DateTimeFormat("en-IN", {
                        day: "2-digit",
                        month: "short",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: "Asia/Kolkata",
                      }).format(new Date(activity.occurredAt))}
                    </time>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

async function DashboardContent() {
  const result = await loadCurrentDashboardData();

  return <DashboardResultView result={result} />;
}

export function RoleDashboard() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardContent />
    </Suspense>
  );
}
