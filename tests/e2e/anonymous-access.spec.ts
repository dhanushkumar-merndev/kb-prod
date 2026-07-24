import { expect, test } from "@playwright/test";

import { ROLE_MATRIX } from "./support/role-matrix";

test.describe("anonymous route protection", () => {
  for (const role of ROLE_MATRIX) {
    test(`redirects the ${role.label} dashboard to login`, async ({ page }) => {
      await page.goto(role.homePath);

      await expect(page).toHaveURL(/\/login\?status=auth_required$/u);
      await expect(page.getByText("Please log in to continue.", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    });
  }
});
