export type BookingServiceStatus =
  | "pending"
  | "confirmed"
  | "chef_assigned"
  | "preparing"
  | "service_completed"
  | "fully_completed"
  | "cancelled";

export interface BookingRecord {
  id: string;
  bookingCode: string;
  leadId: string | null;
  clientName: string;
  customerEmail: string | null;
  eventType: string;
  eventDate: string;
  eventStartTime: string | null;
  reportingTime: string | null;
  venue: string;
  guestCount: number;
  menu: string;
  instructions: string | null;
  totalValue: string;
  paymentStatus: string;
  serviceStatus: BookingServiceStatus;
  version: number;
  invoice: {
    id: string;
    number: string;
    status: "pending_generation" | "issued" | "void" | "generation_failed";
    downloadUrl: string | null;
  } | null;
  latestEmail: {
    id: string;
    status: string;
    error: string | null;
  } | null;
}

export interface BookingLeadOption {
  id: string;
  clientName: string;
  customerEmail: string | null;
  eventDate: string | null;
  guestCount: number | null;
  quoteAmount: string | null;
}

export interface BookingCrudData {
  viewerRole: Role;
  bookings: BookingRecord[];
  eligibleLeads: BookingLeadOption[];
  canCreate: boolean;
  total: number;
  page: number;
  pageSize: number;
  search: string;
}
import type { Role } from "@/lib/constants/roles";
