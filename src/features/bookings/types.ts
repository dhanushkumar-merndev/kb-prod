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
}

export interface BookingLeadOption {
  id: string;
  clientName: string;
  eventDate: string | null;
  guestCount: number | null;
  quoteAmount: string | null;
}

export interface BookingCrudData {
  bookings: BookingRecord[];
  eligibleLeads: BookingLeadOption[];
  canCreate: boolean;
  total: number;
  page: number;
  pageSize: number;
  search: string;
}
