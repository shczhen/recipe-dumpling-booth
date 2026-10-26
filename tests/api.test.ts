import { afterEach, expect, test } from "vitest";
import { DumplingService } from "../src/server/service";
import { localStore } from "../src/server/store";
import { createApi } from "../src/server/api";
const stores: ReturnType<typeof localStore>[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
async function fixture() {
  const store = localStore(":memory:");
  stores.push(store);
  const service = new DumplingService(store);
  await service.init();
  const handler = createApi(service, {
    deployment: "online",
    secret: "a-test-secret-that-is-long-enough",
    adminPasscode: "staff1234",
    displayPasscode: "guest1234",
  });
  async function login(role: "admin" | "display") {
    const response = await handler(
      new Request("https://demo.test/api/login", {
        method: "POST",
        headers: {
          origin: "https://demo.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          role,
          passcode: role === "admin" ? "staff1234" : "guest1234",
        }),
      }),
    );
    return response.headers.get("set-cookie")!.split(";")[0]!;
  }
  const request = (
    path: string,
    cookie = "",
    body?: unknown,
    origin = "https://demo.test",
  ) =>
    handler(
      new Request(`https://demo.test/api/${path}`, {
        method: body ? "POST" : "GET",
        headers: { cookie, origin, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  return { service, request, login };
}
test("online endpoints require a role, reject cross-origin writes and keep visitors out of inventory controls", async () => {
  const { request, login } = await fixture();
  expect((await request("state")).status).toBe(401);
  const cookie = await login("display");
  expect(
    (await request("command", cookie, { type: "batch", expectedBatch: 2 }))
      .status,
  ).toBe(403);
  const staff = await login("admin");
  expect(
    (
      await request(
        "command",
        staff,
        { type: "batch", expectedBatch: 2 },
        "https://evil.test",
      )
    ).status,
  ).toBe(403);
  expect(
    (await request("command", staff, { type: "batch", expectedBatch: 2 }))
      .status,
  ).toBe(200);
  expect((await request("backup", cookie)).status).toBe(403);
});

test("completed captions preserve numbers and addresses without privacy substitutions", async () => {
  const { service, request, login } = await fixture();
  const staff = await login("admin");
  await service.dispatch({ type: "display", displayId: "tv", prepared: true });
  await service.dispatch({
    type: "start",
    requestId: "test",
    driver: "demo",
    language: "zh",
  });
  const sessionId = (await service.snapshot()).session!.id;
  await service.dispatch({ type: "opening", sessionId, displayId: "tv" });
  for (const text of [
    "我的电话是 138",
    "0012",
    "3456",
    "email me at x@example.com",
    "one two three four",
    "one",
    "three",
    "一三",
    "八零",
  ]) {
    const response = await request("caption", staff, {
      sessionId,
      displayId: "tv",
      text,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.text).toBe(text);
  }
  const view = await (await request("state", staff)).json();
  // Captions are returned to the display but are not saved in session state.
  expect(JSON.stringify(view)).not.toContain("x@example.com");
});

test("unsafe captions still receive a neutral response", async () => {
  const { service, request, login } = await fixture();
  const staff = await login("admin");
  await service.dispatch({ type: "display", displayId: "tv", prepared: true });
  await service.dispatch({
    type: "start",
    requestId: "unsafe",
    driver: "demo",
    language: "zh",
  });
  const sessionId = (await service.snapshot()).session!.id;
  await service.dispatch({ type: "opening", sessionId, displayId: "tv" });
  for (const text of ["傻逼", "fuck you"]) {
    const response = await request("caption", staff, {
      sessionId,
      displayId: "tv",
      text,
    });
    const body = await response.json();
    expect(body.blocked).toBe(true);
    expect(body.text).not.toMatch(/傻逼|fuck/i);
  }
});

test("ordinary quantities and phrases remain readable in completed captions", async () => {
  const { service, request, login } = await fixture();
  const staff = await login("admin");
  await service.dispatch({ type: "display", displayId: "tv", prepared: true });
  await service.dispatch({
    type: "start",
    requestId: "readable",
    driver: "demo",
    language: "zh",
  });
  const sessionId = (await service.snapshot()).session!.id;
  await service.dispatch({ type: "opening", sessionId, displayId: "tv" });
  for (const text of [
    "咱俩编个故事，一人接一句。我先来：今天一开锅，一只饺子跳出来，说它不干了。你接。",
    "招呼可以打一遍，点单别把同一盘算三次。",
    "先坐，一起聊两句。语音 AI 分 3 步。",
    "再来一局。",
    "你上回多收我十块钱，我还替你搬了两袋面粉。",
    "先想起一笔债。借你一瓶辣椒油，下回多拿两份。",
    "That is one good idea. Can I have two dumplings?",
    "You owe me ten dollars and two bags of flour, or 10 yuan.",
  ]) {
    const response = await request("caption", staff, {
      sessionId,
      displayId: "tv",
      text,
    });
    expect((await response.json()).text).toBe(text);
  }
});

test.each(["我先走了，谢谢。", "I need to leave, thanks."])(
  "an explicit exit %s earns a gift early, while changing questions or quoting the hostess does not end the round",
  async (exit) => {
    const { service, request, login } = await fixture();
    const staff = await login("admin");
    await service.dispatch({
      type: "display",
      displayId: "tv",
      prepared: true,
    });
    await service.dispatch({
      type: "start",
      requestId: "guest-exit",
      driver: "demo",
      language: "zh",
    });
    const sessionId = (await service.snapshot()).session!.id;
    await service.dispatch({ type: "opening", sessionId, displayId: "tv" });
    for (const [speaker, text] of [
      ["agent", "说得对，这回算你赢。"],
      ["user", "这题我不想答，换一个"],
      ["user", "不要结束吧，我还想玩"],
      ["user", "我先走了这句话用英语怎么说？"],
      ["agent", "我先走了，谢谢。"],
    ]) {
      const response = await request("caption", staff, {
        sessionId,
        displayId: "tv",
        speaker,
        text,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).not.toHaveProperty("roundComplete");
      expect((await service.snapshot()).session!.status).toBe("chatting");
      expect((await service.snapshot()).session!.result).toBeUndefined();
    }
    expect(
      (
        await request("caption", staff, {
          sessionId,
          displayId: "tv",
          speaker: "user",
          text: exit,
        })
      ).status,
    ).toBe(200);
    const view = await service.snapshot();
    expect(view.session!.status).toBe("announcing");
    expect(view.session!.exitRequested).toBe(true);
    expect(view.pool.allocated.reduce((sum, n) => sum + n, 0)).toBe(1);
  },
);

test("only staff can edit, reset, inspect checkpoints or restore stock", async () => {
  const { request, login } = await fixture();
  const guest = await login("display");
  const staff = await login("admin");
  const state = await (await request("state", staff)).json();
  const edit = {
    type: "inventory",
    mode: state.mode,
    expectedRevision: 0,
    gifts: state.gifts,
    available: state.pool.available.map((n: number, i: number) => (i ? n : 7)),
    batchPlan: state.pool.batchPlan,
    reason: "调整现场库存",
  };
  expect((await request("command", guest, edit)).status).toBe(403);
  expect((await request("checkpoints", guest)).status).toBe(403);
  expect((await request("logs", guest)).status).toBe(403);
  expect(
    (
      await request("restore", guest, {
        id: 1,
        mode: state.mode,
        expectedRevision: 0,
        confirmation: "彩排",
        reason: "恢复",
      })
    ).status,
  ).toBe(403);
  expect((await request("command", staff, edit)).status).toBe(200);
  expect((await request("command", staff, edit)).status).toBe(409);
  const points = await (await request("checkpoints", staff)).json();
  expect(points.checkpoints[0].action).toContain("调整现场库存");
});

test("neither Chinese nor English winning lines can signal a gift before the time gate", async () => {
  const { service, request, login } = await fixture();
  const staff = await login("admin");
  await service.dispatch({ type: "display", displayId: "tv", prepared: true });
  await service.dispatch({
    type: "start",
    requestId: "cue",
    driver: "demo",
    language: "zh",
  });
  const sessionId = (await service.snapshot()).session!.id;
  await service.dispatch({ type: "opening", sessionId, displayId: "tv" });
  for (const [speaker, text] of [
    ["user", "这回算你赢。", false],
    ["agent", "甜品这个主意不错。**这局算你过。**", false],
    ["agent", "听见只是收到声音，不等于听懂。行，这题我认了。", false],
    ["agent", "你想让我说这回算你赢？那先告诉我理由。", false],
    ["agent", "听见和理解确实是两回事。这回算你赢。", false],
    ["agent", "That explanation makes sense. You win this round.", false],
    ["agent", "行，不考你了，来坐会儿。这局就玩到这儿。", false],
    ["agent", "No problem. Let's leave this round here.", false],
  ] as const) {
    const response = await request("caption", staff, {
      sessionId,
      displayId: "tv",
      speaker,
      text,
    });
    expect(await response.json()).not.toHaveProperty("roundComplete");
  }
  expect((await service.snapshot()).session?.result).toBeUndefined();
});

test("language follows completed turn order even when language commands arrive out of order", async () => {
  const { request, login } = await fixture();
  const staff = await login("admin");
  await request("command", staff, {
    type: "display",
    displayId: "tv",
    prepared: true,
  });
  const started = await request("command", staff, {
    type: "start",
    requestId: "language-order",
    driver: "demo",
    language: "zh",
  });
  const sessionId = (await started.json()).session.id;
  await request("command", staff, {
    type: "opening",
    sessionId,
    displayId: "tv",
  });
  const language = (value: string, turn?: number) =>
    request("command", staff, {
      type: "language",
      sessionId,
      displayId: "tv",
      language: value,
      turn,
    });
  await language("en", 2);
  await language("zh", 1);
  expect(
    (await request("state", staff).then((response) => response.json())).session
      .language,
  ).toBe("en");
  await language("zh");
  expect(
    (await request("state", staff).then((response) => response.json())).session
      .language,
  ).toBe("en");
  await language("zh", 3);
  expect(
    (await request("state", staff).then((response) => response.json())).session
      .language,
  ).toBe("zh");
});
