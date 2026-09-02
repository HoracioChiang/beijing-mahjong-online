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
    await pages[1]!.reload();
    await expect(pages[1]!.locator(".mahjong-table")).toBeVisible();
    const handCount = await pages[1]!.locator(".own-hand .mahjong-tile").count();
    expect([13, 14]).toContain(handCount);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
