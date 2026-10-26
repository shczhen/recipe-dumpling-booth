import { expect, test } from "@playwright/test";

// The browser's own language must not override the recipe's English default.
test.use({ locale: "zh-CN" });

test("English defaults, explicit Chinese persists and synchronizes between windows", async ({
  page,
  context,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".shop-page")).toHaveAttribute(
    "data-state",
    "waiting",
    { timeout: 10_000 },
  );
  await expect(
    page.getByRole("heading", { name: /Come on in\./ }),
  ).toBeVisible();
  await expect(page.locator(".idle-invitation")).toContainText("dumplings");
  await expect(
    page.getByRole("region", { name: "Gifts", exact: true }),
  ).toContainText("Dumpling voucher");
  // A preceding isolated test may have just closed its display. Let the real
  // six-second display lease expire rather than mocking or bypassing it.
  await expect(page.getByRole("alert")).not.toBeVisible({ timeout: 10_000 });
  await page.screenshot({
    path: testInfo.outputPath("english-waiting.png"),
    fullPage: true,
  });
  const staff = await context.newPage();
  await staff.goto("/admin");
  await expect(
    staff
      .getByRole("radiogroup", { name: "Greeting language" })
      .getByRole("radio", { name: "English", exact: true }),
  ).toHaveAttribute("data-state", "on");
  await staff.getByRole("radio", { name: "简体中文", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("heading", { name: /老板娘/ })).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "进入 / Enter" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "English", exact: true }).click();
  await expect(
    staff.getByRole("heading", { name: "Dumpling Booth Staff controls" }),
  ).toBeVisible();
  await expect(page.getByLabel("Access code", { exact: true })).toBeVisible();
  await page.evaluate(() =>
    localStorage.setItem("dumpling.ui-locale.v1", "unsupported"),
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(errors).toEqual([]);
});

test("English device errors remain recoverable without granting empty device lists", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
      value: async () => [],
    });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Audio devices", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("No microphone found.");
  await expect(
    page.getByRole("button", { name: "Start recording", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: test.info().outputPath("english-empty-devices.png"),
    fullPage: true,
  });
});

test("the router error boundary retains a saved locale and a working language switch", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("dumpling.ui-locale.v1", "zh"),
  );
  // A malformed public snapshot forces a real React render error. The router's
  // error boundary, rather than a test-only route or component, must recover.
  await page.route("**/api/{state,command}", (route) =>
    route.fulfill({
      json: {
        mode: "rehearsal",
        modes: ["rehearsal"],
        deployment: "local",
        agoraReady: false,
        demoSeconds: 120,
        serverNow: Date.now(),
        gifts: null,
        pool: { available: [1], allocated: [0], openedBatch: 1, sessions: [] },
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "暂时无法加载", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.getByRole("radio", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "We couldn't load this page",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("English inventory confirmation and UI language changes preserve the live session and unique gift", async ({
  page,
  context,
}) => {
  test.skip(
    !!process.env.DUMPLING_UI_URL && process.env.DUMPLING_UI_MUTATIONS !== "1",
    "Requires isolated rehearsal inventory.",
  );
  const headers = {
    origin: new URL((await page.request.get("/api/state")).url()).origin,
  };
  const snapshot = () =>
    page.request.get("/api/state").then((response) => response.json());
  const initial = await snapshot();
  expect(initial.mode).toBe("rehearsal");
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
  await page.goto("/admin");
  await page
    .getByRole("button", { name: "Logs and recovery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reset Rehearsal inventory", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Confirm inventory", exact: true })
    .fill("Rehearsal");
  await page
    .getByRole("textbox", { name: "Reason for this change", exact: true })
    .fill("start");
  await page
    .getByRole("button", { name: "Confirm reset", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Done. The change has been logged.",
  );
  await expect(
    page
      .getByRole("cell", { name: "Inventory reset · start", exact: true })
      .first(),
  ).toBeVisible();
  const baseline = await snapshot();
  expect(
    baseline.pool.allocated.reduce((a: number, b: number) => a + b, 0),
  ).toBe(0);
  await page.getByRole("button", { name: "Reception", exact: true }).click();
  const display = await context.newPage();
  await display.goto("/");
  await display
    .getByRole("button", { name: "Test without audio", exact: true })
    .click();
  await page.getByRole("radio", { name: "Demo mode", exact: true }).click();
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await expect(
    display.getByRole("status", { name: "Host activity" }),
  ).toContainText("Listening");
  // The active English title must fit between the header and caption area.
  const title = await display.locator(".shop-heading").boundingBox();
  const header = await display.locator(".shop-header").boundingBox();
  const timer = await display.getByRole("timer").boundingBox();
  const captions = await display.getByRole("log").boundingBox();
  expect(title!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  expect(timer!.y + timer!.height).toBeLessThanOrEqual(captions!.y);
  const started = (await snapshot()).session;
  expect(started.language).toBe("en");
  expect(started.opening).toMatch(/Hey|Come on in/);
  await page.getByRole("radio", { name: "简体中文", exact: true }).click();
  await expect(display.locator("html")).toHaveAttribute("lang", "zh-CN");
  const afterLocale = (await snapshot()).session;
  expect(afterLocale.id).toBe(started.id);
  expect(afterLocale.language).toBe("en");
  expect(afterLocale.result).toBeUndefined();
  await page
    .getByRole("textbox", { name: "演练发言", exact: true })
    .fill("Can we keep playing?");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(display.getByRole("log")).toContainText("Can we keep playing?");
  await page.getByRole("button", { name: "立即急停", exact: true }).click();
  await expect(display.getByRole("timer")).not.toBeVisible();
  const ended = await snapshot();
  expect(ended.session.result).toBeDefined();
  expect(ended.pool.allocated.reduce((a: number, b: number) => a + b, 0)).toBe(
    1,
  );
  await page.getByRole("radio", { name: "English", exact: true }).click();
  expect((await snapshot()).session.result).toEqual(ended.session.result);
  await page.getByRole("button", { name: "Next guest", exact: true }).click();
});
