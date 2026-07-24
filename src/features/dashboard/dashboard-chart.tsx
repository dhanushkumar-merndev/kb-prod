"use client";

import {
  ArcElement,
  Chart as ChartJS,
  Legend,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { useMemo } from "react";
import { Doughnut } from "react-chartjs-2";

import styles from "./dashboard.module.css";
import type { DashboardChartItem, DashboardMetricTone } from "./types";

ChartJS.register(ArcElement, Tooltip, Legend);

const CHART_COLORS: Record<DashboardMetricTone, string> = {
  navy: "#0b2545",
  saffron: "#f2701d",
  mint: "#1e9e6a",
  haldi: "#e8a33d",
  chilli: "#d93a2b",
  slate: "#5b6b85",
};

interface DashboardChartProps {
  title: string;
  description: string;
  items: DashboardChartItem[];
}

export function DashboardChart({ title, description, items }: DashboardChartProps) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const chartData = useMemo<ChartData<"doughnut">>(
    () => ({
      labels: items.map((item) => item.label),
      datasets: [
        {
          data: items.map((item) => item.value),
          backgroundColor: items.map((item) => CHART_COLORS[item.tone]),
          borderColor: "#ffffff",
          borderWidth: 3,
          hoverOffset: 3,
        },
      ],
    }),
    [items],
  );
  const chartOptions = useMemo<ChartOptions<"doughnut">>(
    () => ({
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            color: "#5b6b85",
            padding: 16,
            usePointStyle: true,
          },
        },
        tooltip: {
          callbacks: {
            label(context) {
              const value = context.parsed;

              return ` ${context.label}: ${value.toLocaleString("en-IN")}`;
            },
          },
        },
      },
    }),
    [],
  );
  const accessibleSummary = items
    .map((item) => `${item.label}: ${item.value.toLocaleString("en-IN")}`)
    .join(", ");

  return (
    <section className={styles.chartCard} aria-labelledby="dashboard-chart-title">
      <div>
        <p className={styles.eyebrow}>Live analytics</p>
        <h2 id="dashboard-chart-title" className={styles.chartTitle}>
          {title}
        </h2>
        <p className={styles.chartDescription}>{description}</p>
      </div>

      {total === 0 ? (
        <div className={styles.chartEmpty} role="status">
          <span className={styles.chartEmptyMark} aria-hidden="true">
            0
          </span>
          <strong>No activity in this scope yet</strong>
          <span>The chart will populate as operational records are added.</span>
        </div>
      ) : (
        <>
          <div className={styles.chartCanvas}>
            <Doughnut
              data={chartData}
              options={chartOptions}
              role="img"
              aria-label={`${title}. ${accessibleSummary}.`}
            />
          </div>
          <p className={styles.srOnly}>{accessibleSummary}</p>
        </>
      )}
    </section>
  );
}
