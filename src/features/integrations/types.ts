export interface EmailIntegrationData {
  automationEnabled: boolean;
  dailySendCap: number;
  failedCount: number;
  invoicePaymentInstructions: string;
  invoicePrefix: string;
  invoiceTerms: string;
  queuedCount: number;
  senderEmail: string;
  senderName: string;
  connection: {
    account: string | null;
    lastError: string | null;
    lastSuccessAt: string | null;
    lastTestedAt: string | null;
    status: string;
  } | null;
}
