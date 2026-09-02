import { expect, test } from "@playwright/test";

test("one human can fill the table with server bots", async ({ page, baseURL }) => {
  await page.goto(baseURL!);
  await page.getByLabel("昵称").fill("单人测试");
  await page.getByRole("button", { name: "创建房间" }).click();
  await expect(page.locator(".room-title")).toBeVisible();
  await page.getByRole("button", { name: "添加机器人并开始" }).click();
  const roll = page.getByRole("button", { name: /掷骰/ });
  if (await roll.isVisible().catch(() => false)) await roll.click({ timeout: 1_000 }).catch(() => undefined);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await page.locator(".own-hand .mahjong-tile").count() >= 13) break;
    const nextRoll = page.getByRole("button", { name: /掷骰/ });
    if (await nextRoll.isVisible().catch(() => false)) await nextRoll.click({ timeout: 1_000 }).catch(() => undefined);
    await page.waitForTimeout(100);
  }
  await expect(page.locator(".wall-side")).toHaveCount(4);
  await expect(page.locator(".player-badge").filter({ hasText: "小北" }).first()).toBeVisible();
  const ownHandCount = await page.locator(".own-hand .mahjong-tile").count();
  expect([13, 14]).toContain(ownHandCount);
});
