import { describe, expect, it } from "vitest";

import {
  getAccountStatusErrorCode,
  getAccountStatusMessage,
  getLoginNotice,
} from "@/lib/auth/account-status";

describe("account status messaging", () => {
  it("does not block active profiles", () => {
    expect(getAccountStatusErrorCode("active")).toBeNull();
    expect(getAccountStatusMessage("active")).toBeNull();
  });

  it.each([
    ["inactive" as const, "Your account has been deactivated. Please contact HR or your Manager."],
    ["blocked" as const, "Your account has been blocked. Please contact HR or your Manager."],
    ["payment_pending" as const, "Your access is pending payment confirmation. Please contact HR."],
    ["left_organization" as const, "This account is no longer active in this organization."],
  ])("uses the required message for %s", (status, expected) => {
    expect(getAccountStatusMessage(status)).toBe(expected);
    expect(getLoginNotice(status)?.message).toBe(expected);
  });

  it("ignores untrusted unknown status query values", () => {
    expect(getLoginNotice("made-up-status")).toBeNull();
  });
});
