import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile", width: 360, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1366, height: 768 },
] as const;

test.describe("responsive login", () => {
  for (const viewport of VIEWPORTS) {
    test(`has no horizontal overflow at ${viewport.name} size`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "chromium", "Viewport matrix runs once in Chromium.");

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/login");

      await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
      await expect(page.getByLabel("Phone number")).toBeVisible();
      await expect(page.getByLabel("Password")).toBeVisible();
      await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();

      const targets = [
        page.getByLabel("Phone number"),
        page.getByLabel("Password"),
        page.getByRole("button", { name: "Log in" }),
      ];

      for (const target of targets) {
        const box = await target.boundingBox();
        expect(box, `${viewport.name} control should have a layout box`).not.toBeNull();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }

      await page.getByRole("button", { name: "Log in" }).click();
      await expect(page.getByText("Enter your phone number.", { exact: true })).toBeVisible();

      const layout = await page.evaluate(() => ({
        bodyWidth: document.body.scrollWidth,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));

      expect(Math.max(layout.bodyWidth, layout.documentWidth)).toBeLessThanOrEqual(
        layout.viewportWidth,
      );

      const brandHeading = page.getByRole("heading", {
        level: 1,
        name: "One kitchen. One connected operation.",
      });

      if (viewport.name === "desktop") {
        await expect(brandHeading).toBeVisible();
      } else {
        await expect(brandHeading).toBeHidden();
      }
    });
  }
});
