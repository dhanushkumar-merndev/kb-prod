import { AppError } from "./errors.ts";

const BREVO_API_URL = "https://api.brevo.com/v3";

function environment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new AppError("BREVO_NOT_CONFIGURED");
  return value;
}

function safeProviderMessage(status: number): string {
  if (status === 401 || status === 403) return "Brevo authentication failed.";
  if (status === 429) return "Brevo rate limit reached.";
  if (status >= 500) return "Brevo is temporarily unavailable.";
  return "Brevo rejected the email request.";
}

export interface BrevoAccountResult {
  accountIdentifierSafe: string;
  planSummary: string;
}

export async function testBrevoAccount(): Promise<BrevoAccountResult> {
  const response = await fetch(`${BREVO_API_URL}/account`, {
    headers: {
      accept: "application/json",
      "api-key": environment("BREVO_API_KEY"),
    },
  });

  if (!response.ok) {
    throw new AppError(
      response.status === 401 || response.status === 403
        ? "BREVO_AUTH_FAILED"
        : response.status === 429
          ? "BREVO_RATE_LIMITED"
          : "BREVO_PROVIDER_FAILED",
      {
        details: { provider: "brevo", reason: safeProviderMessage(response.status) },
        status: response.status === 429 ? 429 : 502,
      },
    );
  }

  const payload: unknown = await response.json();
  const row =
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const email = typeof row.email === "string" ? row.email : environment("BREVO_SENDER_EMAIL");
  const plan = Array.isArray(row.plan)
    ? row.plan
        .flatMap((entry) =>
          typeof entry === "object" && entry !== null && "type" in entry
            ? [String((entry as Record<string, unknown>).type)]
            : [],
        )
        .join(", ")
    : "Transactional email";

  return {
    accountIdentifierSafe: email.replace(/^(.{2}).*(@.*)$/u, "$1***$2"),
    planSummary: plan || "Transactional email",
  };
}

export interface BrevoAttachment {
  contentBase64: string;
  name: string;
}

export interface SendBrevoInput {
  attachment?: BrevoAttachment;
  html: string;
  outboxId: string;
  recipientEmail: string;
  recipientName: string;
  senderEmail?: string;
  senderName?: string;
  subject: string;
}

export async function sendBrevoEmail(input: SendBrevoInput): Promise<string> {
  const response = await fetch(`${BREVO_API_URL}/smtp/email`, {
    body: JSON.stringify({
      attachment: input.attachment
        ? [{ content: input.attachment.contentBase64, name: input.attachment.name }]
        : undefined,
      headers: {
        "X-Mailin-custom": `outbox:${input.outboxId}`,
      },
      htmlContent: input.html,
      sender: {
        email: input.senderEmail ?? environment("BREVO_SENDER_EMAIL"),
        name: input.senderName ?? environment("BREVO_SENDER_NAME"),
      },
      subject: input.subject,
      tags: ["khana-banao-crm", "transactional"],
      to: [{ email: input.recipientEmail, name: input.recipientName }],
    }),
    headers: {
      accept: "application/json",
      "api-key": environment("BREVO_API_KEY"),
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new AppError(
      response.status === 401 || response.status === 403
        ? "BREVO_AUTH_FAILED"
        : response.status === 429
          ? "BREVO_RATE_LIMITED"
          : "BREVO_PROVIDER_FAILED",
      {
        details: {
          provider: "brevo",
          reason: safeProviderMessage(response.status),
          retryable: response.status === 429 || response.status >= 500,
        },
        status: response.status === 429 ? 429 : 502,
      },
    );
  }

  const payload: unknown = await response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("messageId" in payload) ||
    typeof payload.messageId !== "string"
  ) {
    throw new AppError("BREVO_PROVIDER_FAILED");
  }

  return payload.messageId;
}

export function configuredBrevoSender(): string {
  return environment("BREVO_SENDER_EMAIL");
}
