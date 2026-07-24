import { AppError } from "../errors.ts";
import type {
  CallPage,
  ConnectionResult,
  ConversationPage,
  LeadPage,
  MessagePage,
  SendMediaInput,
  SendMessageInput,
  SendResult,
  SuperfoneCapability,
  SuperfoneCapabilityMap,
  SuperfoneProvider,
  VerifiedProviderEvent,
} from "./types.ts";

const NO_CAPABILITIES: SuperfoneCapabilityMap = {
  testConnection: false,
  fetchLeads: false,
  fetchConversations: false,
  fetchMessages: false,
  fetchCalls: false,
  sendMessage: false,
  sendMedia: false,
  verifyWebhook: false,
};

interface ProviderConfiguration {
  baseUrl: string | null;
  apiKey: string | null;
  accountId: string | null;
  webhookSecret: string | null;
}

function optionalEnvironment(name: string): string | null {
  const value = Deno.env.get(name)?.trim();
  return value ? value : null;
}

function readConfiguration(): ProviderConfiguration {
  return {
    baseUrl: optionalEnvironment("SUPERFONE_BASE_URL"),
    apiKey: optionalEnvironment("SUPERFONE_API_KEY"),
    accountId: optionalEnvironment("SUPERFONE_ACCOUNT_ID"),
    webhookSecret: optionalEnvironment("SUPERFONE_WEBHOOK_SECRET"),
  };
}

function unavailable(capability: SuperfoneCapability): never {
  throw new AppError("SUPERFONE_CAPABILITY_UNAVAILABLE", {
    message: `Superfone ${capability} is waiting for the official provider API configuration.`,
  });
}

/**
 * No production URL, header, signature algorithm, or payload field is guessed here.
 * Supplying credentials alone intentionally keeps capabilities disabled until the
 * official Superfone contract is implemented in this adapter.
 */
class PendingOfficialContractProvider implements SuperfoneProvider {
  readonly capabilities = NO_CAPABILITIES;

  constructor(private readonly configuration: ProviderConfiguration) {}

  async testConnection(): Promise<ConnectionResult> {
    return await Promise.reject(unavailable("testConnection"));
  }

  async fetchLeads(_input: { cursor?: string; updatedAfter?: string }): Promise<LeadPage> {
    return await Promise.reject(unavailable("fetchLeads"));
  }

  async fetchConversations(_input: {
    cursor?: string;
    updatedAfter?: string;
  }): Promise<ConversationPage> {
    return await Promise.reject(unavailable("fetchConversations"));
  }

  async fetchMessages(_input: {
    conversationExternalId: string;
    cursor?: string;
  }): Promise<MessagePage> {
    return await Promise.reject(unavailable("fetchMessages"));
  }

  async fetchCalls(_input: { cursor?: string; updatedAfter?: string }): Promise<CallPage> {
    return await Promise.reject(unavailable("fetchCalls"));
  }

  async sendMessage(_input: SendMessageInput): Promise<SendResult> {
    return await Promise.reject(unavailable("sendMessage"));
  }

  async sendMedia(_input: SendMediaInput): Promise<SendResult> {
    return await Promise.reject(unavailable("sendMedia"));
  }

  async verifyWebhook(_request: Request): Promise<VerifiedProviderEvent> {
    return await Promise.reject(unavailable("verifyWebhook"));
  }

  async mapStoredEvent(_payload: Record<string, unknown>): Promise<VerifiedProviderEvent> {
    return await Promise.reject(unavailable("verifyWebhook"));
  }

  /**
   * Keeps the compiler aware that configuration is deliberately retained for
   * the future official adapter without ever logging or returning its values.
   */
  isConfigured(): boolean {
    return Boolean(
      this.configuration.baseUrl &&
      this.configuration.apiKey &&
      this.configuration.accountId &&
      this.configuration.webhookSecret,
    );
  }
}

export function createSuperfoneProvider(): SuperfoneProvider {
  const configuration = readConfiguration();

  if (!configuration.baseUrl || !configuration.apiKey || !configuration.accountId) {
    throw new AppError("SUPERFONE_NOT_CONFIGURED");
  }

  return new PendingOfficialContractProvider(configuration);
}

export function requireSuperfoneCapability(
  provider: SuperfoneProvider,
  capability: SuperfoneCapability,
): void {
  if (!provider.capabilities[capability]) {
    unavailable(capability);
  }
}
