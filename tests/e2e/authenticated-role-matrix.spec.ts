import { expect, test, type Page } from "@playwright/test";

import { getRoleCredentials } from "./support/e2e-environment";
import { ROLE_MATRIX, type E2ERole } from "./support/role-matrix";

async function expectRoleNavigation(page: Page, role: E2ERole, projectName: string): Promise<void> {
  if (projectName === "mobile-chromium") {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("dialog", { name: "Mobile navigation" })).toBeVisible();
  }

  const navigation = page.getByRole("navigation", { name: "Primary navigation" }).filter({
    visible: true,
  });

  await expect(
    navigation.getByRole("link", { name: role.primaryNavigationLabel, exact: true }),
  ).toHaveAttribute("aria-current", "page");
}

async function logoutIfAuthenticated(page: Page): Promise<void> {
  if (!ROLE_MATRIX.some((role) => page.url().includes(role.homePath))) {
    return;
  }

  const visibleLogout = page.getByRole("button", { name: "Log out", exact: true }).filter({
    visible: true,
  });

  if ((await visibleLogout.count()) === 0) {
    const openNavigation = page.getByRole("button", { name: "Open navigation" });

    if (await openNavigation.isVisible()) {
      await openNavigation.click();
    }
  }

  const logout = page.getByRole("button", { name: "Log out", exact: true }).filter({
    visible: true,
  });

  if ((await logout.count()) > 0) {
    await logout.click();
    await expect(page).toHaveURL(/\/login\?status=logged_out$/u);
  }
}

test.describe("authenticated role matrix", () => {
  for (const role of ROLE_MATRIX) {
    const credentials = getRoleCredentials(role.key);

    test(`${role.label} reaches only its own live dashboard`, async ({ page }, testInfo) => {
      test.skip(
        !credentials,
        `Set E2E_${role.key}_PHONE and E2E_${role.key}_PASSWORD to run this read-only role check.`,
      );
      test.setTimeout(90_000);

      try {
        await page.goto("/login");
        await page.getByLabel("Phone number").fill(credentials?.phone ?? "");
        await page.getByLabel("Password").fill(credentials?.password ?? "");
        await page.getByRole("button", { name: "Log in" }).click();

        await expect(page).toHaveURL(new RegExp(`${role.homePath.replaceAll("/", "\\/")}$`, "u"), {
          timeout: 30_000,
        });
        await expect(
          page.getByRole("heading", { level: 1, name: role.dashboardHeading }),
        ).toBeVisible();
        await expect(page.getByText("Dashboard unavailable", { exact: true })).toHaveCount(0);

        await expectRoleNavigation(page, role, testInfo.project.name);

        await page.goto(role.unauthorizedPath);
        await expect(page).toHaveURL(new RegExp(`${role.homePath.replaceAll("/", "\\/")}$`, "u"));
        await expect(
          page.getByRole("heading", { level: 1, name: role.dashboardHeading }),
        ).toBeVisible();
      } finally {
        await logoutIfAuthenticated(page);
      }
    });
  }
});
