import { expect, test } from "@playwright/test";

const LOGIN_NOTICES = [
  ["auth_required", "Please log in to continue."],
  ["inactive", "Your account has been deactivated. Please contact HR or your Manager."],
  ["blocked", "Your account has been blocked. Please contact HR or your Manager."],
  ["payment_pending", "Your access is pending payment confirmation. Please contact HR."],
  ["left_organization", "This account is no longer active in this organization."],
  ["session_expired", "Your session has expired. Please log in again."],
  [
    "session_revoked",
    "Your session ended because your account access changed. Please log in again.",
  ],
  [
    "session_check_failed",
    "We could not verify your session. Check your connection and log in again.",
  ],
  ["logged_out", "You have been logged out."],
  ["logged_out_all", "You have been logged out from all devices."],
] as const;

test.describe("login validation and status messages", () => {
  test("exposes only the staff phone/password login controls", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByLabel("Phone number")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);
  });

  test("shows field-level errors without contacting authentication", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByText("Enter your phone number.", { exact: true })).toBeVisible();
    await expect(page.getByText("Enter your password.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Phone number")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Password")).toHaveAttribute("aria-invalid", "true");

    await page.getByLabel("Phone number").fill("12345");
    await page.getByLabel("Password").fill("validation-only");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(
      page.getByText("Enter a valid 10-digit Indian mobile number.", { exact: true }),
    ).toBeVisible();
  });

  for (const [status, message] of LOGIN_NOTICES) {
    test(`renders the ${status} notice`, async ({ page }) => {
      await page.goto(`/login?status=${status}`);

      await expect(page.getByText(message, { exact: true })).toBeVisible();
    });
  }
});
