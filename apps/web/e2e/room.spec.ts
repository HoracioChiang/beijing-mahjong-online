import { expect, test } from "@playwright/test";

test("four browsers can create, join, ready, start, and refresh without losing identity", async ({ browser, baseURL }) => {
  const contexts = await Promise.all([0, 1, 2, 3].map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    await pages[0]!.goto(baseURL!);
    await pages[0]!.getByLabel("昵称").fill("张三");
    await pages[0]!.getByRole("button", { name: "创建房间" }).click();
    await expect(pages[0]!.locator(".room-title")).toBeVisible();
    const roomText = await pages[0]!.locator(".room-title").innerText();
    const roomId = roomText.match(/\d{6}/)?.[0];
    expect(roomId).toBeTruthy();
    for (let index = 1; index < pages.length; index += 1) {
      await pages[index]!.goto(`${baseURL}/room/${roomId}`);
      await pages[index]!.getByLabel("昵称").fill(["李四", "王五", "赵六"][index - 1]!);
      await pages[index]!.getByLabel("房间号").fill(roomId!);
      await pages[index]!.getByRole("button", { name: "加入房间" }).click();
      await expect(pages[index]!.locator(".room-title")).toBeVisible();
    }
    for (const page of pages) await page.getByRole("button", { name: "准备" }).click();
    await expect(pages[0]!.getByRole("button", { name: "开始游戏" })).toBeVisible();
    await pages[0]!.getByRole("button", { name: "开始游戏" }).click();
    await expect(pages[0]!.locator(".mahjong-table")).toBeVisible();
    for (const page of pages) {
      const roll = page.getByRole("button", { name: /掷骰/ });
      if (await roll.isVisible().catch(() => false)) await roll.click({ timeout: 1_000 }).catch(() => undefined);
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      for (const page of pages) {
        const roll = page.getByRole("button", { name: /掷骰/ });
        if (await roll.isVisible().catch(() => false)) await roll.click({ timeout: 1_000 }).catch(() => undefined);
      }
      if (await pages[0]!.locator(".own-hand .mahjong-tile").count() >= 13) break;
      await pages[0]!.waitForTimeout(50);
    }
    await pages[1]!.reload();
    await expect(pages[1]!.locator(".mahjong-table")).toBeVisible();
    const handCount = await pages[1]!.locator(".own-hand .mahjong-tile").count();
    expect([13, 14]).toContain(handCount);
    let settled = false;
    for (let turn = 0; turn < 180 && !settled; turn += 1) {
      for (const page of pages) {
        const settlement = page.locator(".settlement-card");
        if (await settlement.isVisible().catch(() => false)) { settled = true; break; }
        const hu = page.getByRole("button", { name: "胡", exact: true });
        if (await hu.isVisible().catch(() => false) && await hu.isEnabled().catch(() => false)) { await hu.click({ timeout: 1_000 }).catch(() => undefined); continue; }
        const pass = page.getByRole("button", { name: "过", exact: true });
        if (await pass.isVisible().catch(() => false) && await pass.isEnabled().catch(() => false)) { await pass.click({ timeout: 1_000 }).catch(() => undefined); continue; }
        const availableTiles = page.locator(".own-hand .mahjong-tile:not(:disabled)");
        const availableCount = await availableTiles.count();
        if (availableCount > 0) await availableTiles.last().click({ timeout: 1_000 }).catch(() => undefined);
      }
      settled = settled || await pages[0]!.locator(".settlement-card").isVisible().catch(() => false);
      if (!settled) await pages[0]!.waitForTimeout(25);
    }
    await expect(pages[0]!.locator(".settlement-card")).toBeVisible({ timeout: 5_000 });
    for (const page of pages) await page.getByRole("button", { name: "准备下一局", exact: true }).click();
    await expect(pages[0]!.getByText("庄家开牌", { exact: true })).toBeVisible({ timeout: 5_000 });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
