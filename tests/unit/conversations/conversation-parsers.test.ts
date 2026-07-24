import { describe, expect, it } from "vitest";

import {
  parseConversationInbox,
  parseConversationTimeline,
} from "@/features/conversations/parsers";

describe("conversation response parsers", () => {
  it("normalizes PostgreSQL count values without inventing statuses", () => {
    const [conversation] = parseConversationInbox([
      {
        id: "96a3cf8b-6277-43ee-a5d9-593c4cb240e6",
        lead_id: "cbd4c1cb-07ed-4bef-bec4-c197ef24bf3a",
        contact_name: "Asha",
        contact_phone_e164: "+919876543210",
        channel: "whatsapp",
        status: "open",
        last_message_at: "2026-07-23T10:00:00.000Z",
        last_message_preview: "Please share the menu",
        assigned_sales_profile_id: null,
        assigned_sales_name: null,
        unread_count: "3",
        failed_count: 0,
        version: 2,
      },
    ]);

    expect(conversation?.unreadCount).toBe(3);
    expect(conversation?.status).toBe("open");
  });

  it("keeps provider-confirmed timeline status intact", () => {
    const [event] = parseConversationTimeline([
      {
        event_id: "96a3cf8b-6277-43ee-a5d9-593c4cb240e6",
        event_type: "message",
        direction: "outbound",
        body: "Menu sent",
        status: "delivered",
        occurred_at: "2026-07-23T10:00:00.000Z",
        actor_profile_id: null,
        actor_name: null,
        metadata: {},
      },
    ]);

    expect(event?.status).toBe("delivered");
  });
});
