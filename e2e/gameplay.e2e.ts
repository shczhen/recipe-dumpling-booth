import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Existing Chinese flow coverage remains explicit; i18n.e2e.ts covers the English default.
  await page.addInitScript(() =>
    localStorage.setItem("dumpling.ui-locale.v1", "zh"),
  );
});

test("the voice experience offers conversation without scene controls or background scoring", async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    !!process.env.DUMPLING_UI_URL && process.env.DUMPLING_UI_MUTATIONS !== "1",
    "Requires an isolated local rehearsal server.",
  );
  const initial = await page.request
    .get("/api/state")
    .then((res) => res.json());
  expect(initial.mode).toBe("rehearsal");
  const headers = { origin: "http://127.0.0.1:3130" };
  // Use the actual server origin when running against an isolated preview.
  headers.origin = new URL((await page.request.get("/api/state")).url()).origin;
  if (initial.session) {
    await page.request.post("/api/command", {
      headers,
      data: { type: "cancel", sessionId: initial.session.id, reason: "staff" },
    });
    await page.request.post("/api/command", {
      headers,
      data: { type: "next", sessionId: initial.session.id },
    });
  }
  const baseline = await page.request
    .get("/api/state")
    .then((res) => res.json());
  const before = baseline.pool.allocated.reduce(
    (a: number, b: number) => a + b,
    0,
  );
  const sceneRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(?:game-turn|game-action|rehearse)$/.test(request.url()))
      sceneRequests.push(request.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "无声演练" }).click();
  const admin = await context.newPage();
  await admin.goto("/admin");
  await admin.getByRole("radio", { name: "流程演练", exact: true }).click();
  await expect(
    admin.getByRole("radiogroup", { name: "本轮玩法" }).getByRole("radio"),
  ).toHaveText([
    "随机玩法",
    "二十问",
    "你描述，她来猜",
    "食物接龙",
    "故事接龙",
    "答非所问",
  ]);
  await expect(
    admin.getByRole("radio", { name: "随机玩法", exact: true }),
  ).toHaveAttribute("data-state", "on");
  await admin.screenshot({
    path: testInfo.outputPath("five-games-admin.png"),
    fullPage: true,
  });
  await admin.getByRole("button", { name: "开始接待", exact: true }).click();
  const activity = page.getByRole("status", {
    name: "老板娘状态",
  });
  await expect(activity).toContainText("老板娘在听");
  const randomRound = await page.request
    .get("/api/state")
    .then((res) => res.json());
  expect([
    "twenty-questions",
    "describe-and-guess",
    "food-chain",
    "story-chain",
    "wrong-answers",
  ]).toContain(randomRound.session.gameId);
  await expect(
    page.getByRole("region", { name: "本轮剧情 / Scene record" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "接受 / Accept", exact: true }),
  ).not.toBeVisible();
  await admin.getByRole("textbox", { name: "演练发言" }).fill("给我一份饺子");
  await admin.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("log", { name: "安全字幕" })).toContainText(
    "这轮流程演练先接着聊",
  );
  expect(sceneRequests).toEqual([]);
  expect(
    (await page.request.get("/api/state").then((res) => res.json())).session
      .result,
  ).toBeUndefined();
  await admin.getByRole("button", { name: "立即急停", exact: true }).click();
  await expect(page.getByRole("timer")).not.toBeVisible();
  const final = await page.request.get("/api/state").then((res) => res.json());
  expect(final.pool.allocated.reduce((a: number, b: number) => a + b, 0)).toBe(
    before + 1,
  );
  await admin.getByRole("button", { name: "下一位", exact: true }).click();
  await admin.getByRole("radio", { name: "故事接龙", exact: true }).click();
  await admin.getByRole("button", { name: "开始接待", exact: true }).click();
  await expect(activity).toContainText("老板娘在听");
  const fixedRound = await page.request
    .get("/api/state")
    .then((res) => res.json());
  expect(fixedRound.session.gameId).toBe("story-chain");
  await admin.getByRole("button", { name: "立即急停", exact: true }).click();
  await expect(page.getByRole("timer")).not.toBeVisible();
  const fixedEnd = await page.request
    .get("/api/state")
    .then((res) => res.json());
  expect(
    fixedEnd.pool.allocated.reduce((a: number, b: number) => a + b, 0),
  ).toBe(before + 2);
  await admin.getByRole("button", { name: "下一位", exact: true }).click();
});
