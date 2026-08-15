import { expect, test } from "@playwright/test";

test.describe("Demo Track Spectrum smoke", () => {
  test("demo route shows Play and mounts a canvas host", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.getByRole("heading", { name: "Spectrum" })).toBeVisible();
    const play = page.getByRole("button", { name: /^Play$/i });
    await expect(play).toBeVisible();
    await play.click();
    await expect(page.locator("[data-visualizer='spectrum']")).toBeVisible();
    // Presence only — avoid exact canvas pixel assertions.
    await expect(page.locator("[data-visualizer='spectrum'] canvas")).toHaveCount(1);
  });

  test("combined mode hosts the same Demo Track experience", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByText(/Combined · Demo Track/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Play$/i })).toBeVisible();
  });
});
