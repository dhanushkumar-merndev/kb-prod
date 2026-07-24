import type { Role } from "@/lib/constants/roles";

export type DashboardMetricTone = "navy" | "saffron" | "mint" | "haldi" | "chilli" | "slate";

export interface DashboardMetric {
  id: string;
  label: string;
  value: number;
  description: string;
  tone: DashboardMetricTone;
}

export interface DashboardChartItem {
  label: string;
  value: number;
  tone: DashboardMetricTone;
}

export interface DashboardActivityItem {
  id: string;
  title: string;
  body: string | null;
  occurredAt: string;
  unread: boolean;
}

export interface DashboardPendingAction {
  id: string;
  label: string;
  description: string;
  count: number;
  href: string;
  tone: DashboardMetricTone;
}

export interface DashboardNextBooking {
  bookingCode: string;
  eventType: string;
  eventDate: string;
  reportingTime: string | null;
  venue: string;
  guestCount: number;
}

export interface DashboardViewModel {
  profileName: string;
  role: Role;
  title: string;
  subtitle: string;
  metrics: DashboardMetric[];
  chart: {
    title: string;
    description: string;
    items: DashboardChartItem[];
  };
  recentActivity: DashboardActivityItem[];
  pendingActions: DashboardPendingAction[];
  nextBooking: DashboardNextBooking | null;
  updatedAt: string;
}

export type DashboardLoadResult =
  | {
      ok: true;
      data: DashboardViewModel;
    }
  | {
      ok: false;
      profileName: string;
      role: Role;
      title: string;
      message: string;
    };
