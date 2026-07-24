export interface PaymentRecord {
  id: string;
  bookingId: string;
  bookingCode: string;
  paymentStage: "advance" | "partial" | "final" | "full" | "refund";
  amount: string;
  paymentMethod: string | null;
  transactionReference: string | null;
  verificationStatus: "pending" | "verified" | "rejected";
  rejectionReason: string | null;
  paidAt: string | null;
  createdAt: string;
  proofUrl: string | null;
}

export interface PaymentBookingOption {
  id: string;
  bookingCode: string;
  clientName: string;
  totalValue: string;
  paymentStatus: string;
}

export interface PaymentData {
  payments: PaymentRecord[];
  bookings: PaymentBookingOption[];
  canSubmit: boolean;
  canReview: boolean;
}
