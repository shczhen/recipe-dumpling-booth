import { expect, test, type Page } from "@playwright/test";
import type { Snapshot } from "../src/shared/model";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
async function capture(page: Page, name: string) {
  const directory = process.env.DUMPLING_CAPTURE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page
    .locator(".host-art")
    .evaluate((image) =>
      image instanceof HTMLImageElement ? image.decode() : Promise.resolve(),
    );
  await page.screenshot({
    path: join(directory, name + ".png"),
    fullPage: true,
    animations: "disabled",
  });
}

test.beforeEach(async ({ page }) => {
  // Existing Chinese flow coverage remains explicit; i18n.e2e.ts covers the English default.
  await page.addInitScript(() =>
    localStorage.setItem("dumpling.ui-locale.v1", "zh"),
  );
});

// Synthetic snapshots enter at the HTTP boundary. No SDK, database, or private
// display helpers are mocked; real production React handles the public page.
async function waitingPage(page: Page) {
  const view: Snapshot = {
    mode: "rehearsal",
    modes: ["rehearsal", "formal"],
    deployment: "local",
    agoraReady: false,
    demoSeconds: 120,
    serverNow: Date.now(),
    pool: {
      available: [6, 3, 3, 18, 30, 30, 200],
      allocated: [0, 0, 0, 0, 0, 0, 0],
      openedBatch: 1,
      sessions: [],
    },
    gifts: [
      { zh: "饺子兑换券", en: "Dumpling voucher" },
      { zh: "桌游套装", en: "Game set" },
      { zh: "小礼盒", en: "Gift box" },
      { zh: "帆布袋", en: "Tote bag" },
      { zh: "钥匙扣", en: "Keyring" },
      { zh: "徽章", en: "Pin" },
      { zh: "贴纸包", en: "Sticker pack" },
    ],
  };
  await page.route("**/api/{state,command}", async (route) => {
    const command = route.request().postDataJSON();
    if (command?.type === "display")
      view.display = {
        id: command.displayId,
        seenAt: Date.now(),
        prepared: command.prepared,
        audioReady: command.audioReady,
      };
    if (command?.type === "opening" && view.session) {
      view.session.status = "chatting";
      view.session.startedAt = Date.now();
      view.session.deadline = Date.now() + 120000;
    }
    if (command?.type === "cancel" && view.session)
      view.session.status = "cancelled";
    await route.fulfill({ json: { ...view, serverNow: Date.now() } });
  });
  await page.route("**/api/caption", (route) =>
    route.fulfill({
      json: {
        text: "老板娘，你最喜欢什么馅？",
        language: "zh",
        blocked: false,
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("region", { name: "本场礼品" })).toBeVisible();
  return view;
}

test("waiting host rotates invitations and visitors can pause them", async ({
  page,
}) => {
  await page.clock.install();
  await waitingPage(page);
  await expect(page.getByText("有人来试试美味的饺子吗？")).toBeVisible();
  await page.clock.runFor(10000);
  await expect(page.getByText("饺子配酒，越喝越有！")).toBeVisible();
  await page.getByRole("button", { name: "无声演练" }).click();
  await capture(page, "waiting");
  for (const [width, height] of [
    [1280, 720],
    [390, 844],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await capture(page, `waiting-${width}`);
  }
  await page.getByRole("button", { name: "暂停动态" }).click();
  await page.clock.runFor(20000);
  await expect(page.getByText("饺子配酒，越喝越有！")).toBeVisible();
});

test("a silent recording cannot pass device preparation", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      await context.resume();
      const destination = context.createMediaStreamDestination();
      const source = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(destination);
      source.start();
      return destination.stream;
    };
  });
  const view = await waitingPage(page);
  await page.getByRole("button", { name: "声音设备 / Audio devices" }).click();
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect(page.getByText(/正在录音，请说几句话/)).toBeVisible();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "停止录音", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("没有录到声音");
  await expect(
    page.getByRole("button", { name: "回放录音", exact: true }),
  ).not.toBeVisible();
  expect(view.display?.audioReady).not.toBe(true);
});

test("device preparation records the visitor and requires playback confirmation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      await context.resume();
      const destination = context.createMediaStreamDestination();
      const source = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = 0.12;
      source.connect(gain).connect(destination);
      source.start();
      Object.defineProperty(
        destination.stream.getAudioTracks()[0],
        "getSettings",
        {
          value: () => ({ deviceId: "default" }),
        },
      );
      return destination.stream;
    };
    const createURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      if (blob instanceof Blob && blob.type.startsWith("audio/"))
        (window as typeof window & { recordedSample: Blob }).recordedSample =
          blob;
      return createURL(blob);
    };
  });
  const view = await waitingPage(page);
  await page.getByRole("button", { name: "声音设备 / Audio devices" }).click();
  await page.getByRole("button", { name: "授权并刷新设备" }).click();
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect(page.getByText(/正在录音，请说几句话/)).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole("meter", { name: "麦克风输入音量" })
        .getAttribute("value")
        .then(Number),
    )
    .toBeGreaterThan(20);
  await capture(page, "devices-recording");
  expect(view.display?.audioReady).not.toBe(true);
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "停止录音", exact: true }).click();
  await expect(page.getByText("录好了。点回放，听听刚才的话。")).toBeVisible();
  const recorded = await page.evaluate(async () => {
    const blob = (window as typeof window & { recordedSample: Blob })
      .recordedSample;
    const context = new AudioContext();
    try {
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      const samples = buffer.getChannelData(0);
      const rms = Math.sqrt(
        samples.reduce((sum, value) => sum + value * value, 0) / samples.length,
      );
      return { duration: buffer.duration, rms };
    } finally {
      await context.close();
    }
  });
  expect(recorded.duration).toBeGreaterThan(0.2);
  expect(recorded.rms).toBeGreaterThan(0.03);
  const confirm = page.getByRole("button", { name: "听清楚了，完成准备" });
  await expect(confirm).toBeDisabled();
  await page.getByRole("button", { name: "回放录音", exact: true }).click();
  await expect(confirm).toBeEnabled();
  await capture(page, "devices-played");
  await confirm.click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect.poll(() => view.display?.audioReady).toBe(true);
});

test("closing device setup releases a microphone permission result that arrives late", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as typeof window & {
      releaseMic?: () => void;
      checkedTracks: MediaStreamTrack[];
    };
    state.checkedTracks = [];
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      state.checkedTracks.push(...stream.getTracks());
      await new Promise<void>((resolve) => {
        state.releaseMic = resolve;
      });
      return stream;
    };
  });
  const view = await waitingPage(page);
  await page.getByRole("button", { name: "声音设备 / Audio devices" }).click();
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!(window as typeof window & { releaseMic?: () => void }).releaseMic,
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() =>
    (window as typeof window & { releaseMic?: () => void }).releaseMic?.(),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as typeof window & { checkedTracks: MediaStreamTrack[] }
        ).checkedTracks.every((track) => track.readyState === "ended"),
      ),
    )
    .toBe(true);
  expect(view.display?.audioReady).not.toBe(true);
  await page.getByRole("button", { name: "声音设备 / Audio devices" }).click();
  await expect(
    page.getByRole("button", { name: "开始录音", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "听清楚了，完成准备" }),
  ).not.toBeVisible();
});

test("failed sample playback cannot mark audio ready", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      await context.resume();
      const destination = context.createMediaStreamDestination();
      const source = context.createOscillator();
      source.connect(destination);
      source.start();
      return destination.stream;
    };
    HTMLMediaElement.prototype.play = async function () {
      throw new DOMException("private playback details", "NotAllowedError");
    };
  });
  const view = await waitingPage(page);
  await page.getByRole("button", { name: "声音设备 / Audio devices" }).click();
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect(page.getByText(/正在录音，请说几句话/)).toBeVisible();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "停止录音", exact: true }).click();
  await page.getByRole("button", { name: "回放录音", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("录音回放失败");
  await expect(page.getByRole("dialog")).not.toContainText(
    "private playback details",
  );
  await expect(
    page.getByRole("button", { name: "听清楚了，完成准备" }),
  ).toBeDisabled();
  expect(view.display?.audioReady).not.toBe(true);
});

// Exercise the real recorder/UI, replacing only delayed media play promises.
test("a late failed playback cannot break a retry after its timeout", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      await context.resume();
      const destination = context.createMediaStreamDestination();
      const source = context.createOscillator();
      source.connect(destination);
      source.start();
      return destination.stream;
    };
    let calls = 0;
    HTMLMediaElement.prototype.play = function () {
      const surface = window as typeof window & {
        failOldPlayback(): void;
        finishRetry(): void;
      };
      if (++calls === 1)
        return new Promise<void>((_, reject) => {
          surface.failOldPlayback = () =>
            reject(new DOMException("Late failure", "NotAllowedError"));
        });
      surface.finishRetry = () => this.dispatchEvent(new Event("ended"));
      return Promise.resolve();
    };
  });
  const view = await waitingPage(page);
  await page.getByRole("button", { name: "声音设备 / Audio devices" }).click();
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect(page.getByText(/正在录音，请说几句话/)).toBeVisible();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "停止录音", exact: true }).click();
  await expect(page.getByText("录好了。点回放，听听刚才的话。")).toBeVisible();
  await page.clock.install();
  await page.getByRole("button", { name: "回放录音", exact: true }).click();
  await page.clock.runFor(20001);
  await expect(page.getByRole("dialog")).toContainText("录音回放失败");
  await page.getByRole("button", { name: "回放录音", exact: true }).click();
  await expect(page.getByText("正在回放，请检查音量和清晰度。")).toBeVisible();
  await page.evaluate(() =>
    (window as typeof window & { failOldPlayback(): void }).failOldPlayback(),
  );
  await page.evaluate(() =>
    (window as typeof window & { finishRetry(): void }).finishRetry(),
  );
  await expect(
    page.getByRole("button", { name: "听清楚了，完成准备" }),
  ).toBeEnabled();
  expect(view.display?.audioReady).not.toBe(true);
});

for (const unplug of [
  { name: "selected USB input", output: "hdmi-tv", missing: "usb-mic" },
  {
    name: "system default output",
    output: "system-default",
    missing: "hdmi-tv",
  },
])
  test(`${unplug.name} unplugging during a round clears readiness`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const state = window as typeof window & {
        testDevices: { kind: string; deviceId: string; label: string }[];
        testInputs: MediaStreamConstraints[];
        testOutputs: string[];
      };
      state.testDevices = [
        { kind: "audioinput", deviceId: "usb-mic", label: "USB 话筒" },
        { kind: "audiooutput", deviceId: "hdmi-tv", label: "HDMI 电视" },
      ];
      state.testInputs = [];
      state.testOutputs = [];
      Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
        value: async () => state.testDevices,
      });
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: async (constraints: MediaStreamConstraints) => {
          state.testInputs.push(constraints);
          const context = new AudioContext();
          await context.resume();
          const destination = context.createMediaStreamDestination();
          const oscillator = context.createOscillator();
          oscillator.connect(destination);
          oscillator.start();
          const stream = destination.stream;
          Object.defineProperty(stream.getAudioTracks()[0], "getSettings", {
            value: () => ({ deviceId: "usb-mic" }),
          });
          return stream;
        },
      });
      HTMLMediaElement.prototype.setSinkId = async function (id: string) {
        state.testOutputs.push(id);
      };
      HTMLMediaElement.prototype.play = async function () {
        setTimeout(() => this.dispatchEvent(new Event("ended")), 100);
      };
    });
    const view = await waitingPage(page);
    await page
      .getByRole("button", { name: "声音设备 / Audio devices" })
      .click();
    await page.getByLabel("输入设备 · 麦克风").selectOption("usb-mic");
    await page
      .getByLabel("输出设备 · 电视 / 扬声器")
      .selectOption(unplug.output);
    await page.getByRole("button", { name: "开始录音", exact: true }).click();
    await expect(page.getByText(/正在录音，请说几句话/)).toBeVisible();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "停止录音", exact: true }).click();
    await page.getByRole("button", { name: "回放录音", exact: true }).click();
    await page.getByRole("button", { name: "听清楚了，完成准备" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect.poll(() => view.display?.audioReady).toBe(true);
    const calls = await page.evaluate(() => {
      const state = window as typeof window & {
        testInputs: MediaStreamConstraints[];
        testOutputs: string[];
      };
      return { inputs: state.testInputs, outputs: state.testOutputs };
    });
    expect(calls.inputs.at(-1)?.audio).toMatchObject({
      deviceId: { exact: "usb-mic" },
    });
    if (unplug.output === "hdmi-tv") expect(calls.outputs).toContain("hdmi-tv");
    view.session = {
      id: "synthetic-active",
      requestId: "synthetic-active-start",
      mode: "rehearsal",
      driver: "demo",
      status: "chatting",
      language: "zh",
      createdAt: Date.now(),
      duration: 120,
      deadline: Date.now() + 120000,
      opening: "合成设备测试",
      announcement: "pending",
      muted: false,
      failures: 0,
    };
    await expect(page.getByRole("status", { name: "老板娘状态" })).toHaveText(
      /老板娘在听/,
    );
    await expect(
      page.getByRole("button", { name: "声音设备 / Audio devices" }),
    ).toBeDisabled();
    await page.evaluate((missing) => {
      const state = window as typeof window & {
        testDevices: { kind: string; deviceId: string; label: string }[];
      };
      state.testDevices = state.testDevices.filter(
        (d) => d.deviceId !== missing,
      );
      navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
    }, unplug.missing);
    await expect(page.getByRole("alert")).toContainText("所选声音设备已断开");
    await expect.poll(() => view.display?.audioReady).toBe(false);
    await expect(page.locator(".shop-page")).toHaveAttribute(
      "data-activity",
      "paused",
    );
    await expect(page.locator(".shop-page")).toHaveAttribute(
      "data-motion",
      "false",
    );
  });

test("a denied microphone permission explains recovery without exposing browser error details", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        throw new DOMException("private browser details", "NotAllowedError");
      },
    });
  });
  await waitingPage(page);
  await page.getByRole("button", { name: "声音设备 / Audio devices" }).click();
  await page.getByRole("button", { name: "授权并刷新设备" }).click();
  await expect(page.getByRole("dialog")).toContainText("权限被拒绝");
  await expect(page.getByRole("dialog")).not.toContainText(
    "private browser details",
  );
});

test("reduced motion keeps invitations still while all seven gifts remain visible", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await waitingPage(page);
  await expect(
    page.getByRole("region", { name: "本场礼品" }).getByRole("figure"),
  ).toHaveCount(7);
  await page.clock.runFor(20000);
  await expect(page.getByText("有人来试试美味的饺子吗？")).toBeVisible();
  expect(
    await page
      .locator(".host-art")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
});

test("empty audio device lists show a recovery message instead of an empty selector", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
      value: async () => [],
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        throw new DOMException("No device", "NotFoundError");
      },
    });
  });
  await waitingPage(page);
  await page.getByRole("button", { name: "声音设备 / Audio devices" }).click();
  await page.getByRole("button", { name: "授权并刷新设备" }).click();
  await expect(page.getByRole("dialog")).toContainText("未检测到麦克风");
  await capture(page, "devices-empty");
  await expect(
    page.getByRole("button", { name: "开始录音", exact: true }),
  ).toBeDisabled();
});

test("a completed viewer sentence shows thinking, then a reply, then listening", async ({
  page,
}) => {
  const view = await waitingPage(page);
  await page.getByRole("button", { name: "无声演练" }).click();
  view.session = {
    id: "synthetic-round",
    requestId: "synthetic-start",
    mode: "rehearsal",
    driver: "demo",
    status: "connecting",
    language: "zh",
    createdAt: Date.now(),
    duration: 120,
    opening: "欢迎来坐坐！",
    announcement: "pending",
    muted: false,
    failures: 0,
  };
  await expect(page.getByRole("status", { name: "老板娘状态" })).toHaveText(
    /老板娘在听/,
  );
  await page.evaluate(() => {
    const bus = new BroadcastChannel("dumpling-display");
    bus.postMessage({
      type: "utterance",
      sessionId: "synthetic-round",
      text: "老板娘，你最喜欢什么馅？",
    });
    bus.close();
  });
  const status = page.getByRole("status", {
    name: "老板娘状态",
  });
  await expect(status).toHaveText(/老板娘在想/);
  await capture(page, "thinking");
  await expect(status).toHaveText(/老板娘在说/);
  await expect(status).toHaveText(/老板娘在听/);
  await capture(page, "conversation");
  view.session.status = "announcing";
  view.session.result = {
    rank: 7,
    gift: { zh: "贴纸包", en: "Sticker pack" },
    settledAt: Date.now(),
    closing: "这份心意送给你。",
  };
  await expect(status).not.toBeVisible();
  await expect(page.getByRole("timer")).toBeVisible();
  await capture(page, "revealing");
  await expect(
    page.getByRole("heading", { name: "贴纸包", exact: true }),
  ).not.toBeVisible();
  view.session.status = "gifted";
  view.session.giftRevealedAt = Date.now();
  view.session.farewellAt = Date.now() + 20000;
  await expect(
    page.getByRole("heading", { name: "贴纸包", exact: true }),
  ).toBeVisible();
  const timer = page.getByRole("timer");
  await expect(timer).toBeVisible();
  await expect(timer).toContainText(/00:(?:1\d|20)/);
  await capture(page, "gifted-countdown");
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(timer).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await capture(page, "gifted-countdown-1280");
  await page.setViewportSize({ width: 1672, height: 941 });
  view.session.status = "announcing";
  view.session.announcementKind = "goodbye";
  await expect(timer).toBeVisible();
  view.session.status = "completed";
  view.session.announcement = "done";
  await expect(
    page.getByRole("heading", { name: "贴纸包", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("timer")).not.toBeVisible();
  await expect(page.locator(".host-bubble")).not.toBeVisible();
  await expect(page.getByRole("log")).not.toBeVisible();
  await capture(page, "result");
});
