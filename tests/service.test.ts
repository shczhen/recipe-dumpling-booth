import { afterEach, expect, test } from "vitest";
import { localStore } from "../src/server/store";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DumplingService } from "../src/server/service";
import { catalog } from "../src/shared/model";
import { defaultGameId, gameDefinitions } from "../src/shared/games";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup(
  demoSeconds = 120,
  ticket = 0,
  storage: "file" | "memory" = "file",
) {
  const dir = await mkdtemp(join(tmpdir(), "dumpling-"));
  const client = localStore(
    storage === "memory" ? ":memory:" : join(dir, "test.db"),
  );
  let now = 100_000;
  const service = new DumplingService(client, {
    now: () => now,
    random: (max) => ticket % max,
    demoSeconds,
    gifts: catalog.gifts,
  });
  cleanups.push(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true });
  });
  await service.init();
  return {
    service,
    advance: (ms: number) => {
      now += ms;
    },
    client,
    dir,
  };
}

test("a gift at three quarters allows reactions, then says goodbye without reallocating", async () => {
  const { service, advance } = await setup();
  const heartbeat = () =>
    service.dispatch({ type: "display", displayId: "tv", prepared: true });
  await heartbeat();
  await service.dispatch({
    type: "start",
    requestId: "game",
    driver: "demo",
    language: "zh",
  });
  const sessionId = (await service.snapshot()).session!.id;
  await service.dispatch({ type: "opening", sessionId, displayId: "tv" });
  for (let i = 0; i < 90; i++) {
    advance(1000);
    await heartbeat();
  }
  await service.dispatch({ type: "settle", sessionId });
  const result = (await service.snapshot()).session!.result;
  expect(result?.rank).toBe(1);
  await service.dispatch({ type: "settle", sessionId });
  await service.dispatch({ type: "announced", sessionId, displayId: "tv" });
  expect((await service.snapshot()).session!.status).toBe("gifted");
  await service.dispatch({ type: "announced", sessionId, displayId: "tv" });
  expect((await service.snapshot()).session!.status).toBe("gifted");
  for (let i = 0; i < 20; i++) {
    advance(1000);
    await heartbeat();
  }
  const farewell = (await service.snapshot()).session!;
  expect(farewell.status).toBe("announcing");
  expect(farewell.announcementKind).toBe("goodbye");
  await service.dispatch({ type: "announced", sessionId, displayId: "tv" });
  expect((await service.snapshot()).session!.status).toBe("announcing");
  await service.dispatch({
    type: "announced",
    sessionId,
    displayId: "tv",
    kind: "goodbye",
  });
  const view = await service.snapshot();
  expect(view.session!.status).toBe("completed");
  expect(view.session!.result).toEqual(result);
  expect(view.pool.allocated).toEqual([1, 0, 0, 0, 0, 0, 0]);
});

test.each([
  { duration: 8, gameId: defaultGameId },
  ...gameDefinitions.map(({ id }) => ({ duration: 120, gameId: id })),
])(
  "$gameId ignores early wins and gifts at 75 percent of $duration seconds",
  async ({ duration, gameId }) => {
    const { service, advance } = await setup(duration);
    const heartbeat = () =>
      service.dispatch({ type: "display", displayId: "tv", prepared: true });
    await heartbeat();
    await service.dispatch({
      type: "start",
      requestId: "minimum-chat",
      driver: "demo",
      language: "zh",
      gameId,
    });
    const sessionId = (await service.snapshot()).session!.id;
    await service.dispatch({ type: "opening", sessionId, displayId: "tv" });
    await expect(
      service.dispatch({ type: "settle", sessionId }),
    ).rejects.toThrow("尚未到时");
    expect((await service.snapshot()).session!.result).toBeUndefined();
    const threshold = duration * 750;
    for (let elapsed = 0; elapsed < threshold - 1;) {
      const step = Math.min(1000, threshold - 1 - elapsed);
      advance(step);
      await heartbeat();
      elapsed += step;
    }
    await expect(
      service.dispatch({ type: "settle", sessionId }),
    ).rejects.toThrow("尚未到时");
    const before = await service.snapshot();
    expect(before.session!.status).toBe("chatting");
    expect(before.session!.result).toBeUndefined();
    expect(before.pool.allocated).toEqual([0, 0, 0, 0, 0, 0, 0]);
    advance(1);
    const atBoundary = await service.snapshot();
    expect(atBoundary.session!.status).toBe("announcing");
    expect(
      atBoundary.session!.result!.settledAt - atBoundary.session!.startedAt!,
    ).toBe(threshold);
    expect(atBoundary.pool.allocated).toEqual([1, 0, 0, 0, 0, 0, 0]);
    await service.dispatch({
      type: "settle",
      sessionId,
    });
    expect((await service.snapshot()).session!.result).toEqual(
      atBoundary.session!.result,
    );
  },
);

test("a gift finishing at the round deadline still gets a spoken goodbye", async () => {
  const { service, advance } = await setup();
  const heartbeat = () =>
    service.dispatch({ type: "display", displayId: "tv", prepared: true });
  await heartbeat();
  await service.dispatch({
    type: "start",
    requestId: "slow-gift",
    driver: "demo",
    language: "zh",
  });
  const sessionId = (await service.snapshot()).session!.id;
  await service.dispatch({ type: "opening", sessionId, displayId: "tv" });
  for (let i = 0; i < 120; i++) {
    advance(1000);
    await heartbeat();
  }
  const result = (await service.snapshot()).session!.result;
  await service.dispatch({
    type: "announced",
    sessionId,
    displayId: "tv",
    kind: "gift",
  });
  const goodbye = (await service.snapshot()).session!;
  expect(goodbye.status).toBe("announcing");
  expect(goodbye.announcementKind).toBe("goodbye");
  expect(goodbye.farewell).toBeTruthy();
  await service.dispatch({
    type: "announced",
    sessionId,
    displayId: "tv",
    kind: "goodbye",
  });
  expect((await service.snapshot()).session!.status).toBe("completed");
  expect((await service.snapshot()).session!.result).toEqual(result);
});

test("leaving early reveals a single participation gift without another 20 seconds of conversation", async () => {
  const { service } = await setup();
  await service.dispatch({ type: "display", displayId: "tv", prepared: true });
  await service.dispatch({
    type: "start",
    requestId: "leaving",
    driver: "demo",
    language: "zh",
  });
  const sessionId = (await service.snapshot()).session!.id;
  await service.dispatch({ type: "opening", sessionId, displayId: "tv" });
  await service.dispatch({ type: "leave", sessionId, displayId: "tv" });
  const result = (await service.snapshot()).session!.result;
  expect(result).toBeDefined();
  await service.dispatch({ type: "leave", sessionId, displayId: "tv" });
  await service.dispatch({ type: "announced", sessionId, displayId: "tv" });
  const view = await service.snapshot();
  expect(view.session!.status).toBe("completed");
  expect(view.session!.result).toEqual(result);
  expect(view.pool.allocated).toEqual([1, 0, 0, 0, 0, 0, 0]);
});

test("initializes the first 290 gifts once and retains stock on reopening", async () => {
  const { service, client } = await setup();
  const initial = await service.snapshot();
  expect(initial.pool.available).toEqual([6, 3, 3, 18, 30, 30, 200]);
  expect(initial.pool.openedBatch).toBe(1);
  await service.init();
  const reopened = new DumplingService(client);
  await reopened.init();
  expect((await reopened.snapshot()).pool.available).toEqual([
    6, 3, 3, 18, 30, 30, 200,
  ]);
});

test("saved gift configuration survives reopening with different environment defaults", async () => {
  const { client, service } = await setup();
  const before = await service.snapshot();
  const changed = new DumplingService(client, {
    gifts: [{ zh: "另一份礼品", en: "Changed gift" }, ...before.gifts.slice(1)],
  });
  await changed.init();
  expect((await changed.snapshot()).gifts[0]?.zh).toBe("饺子兑换券");
});

test("staff start is idempotent, the greeting starts the clock, and a result is allocated exactly once", async () => {
  const { service, advance } = await setup();
  await service.dispatch({ type: "display", displayId: "tv", prepared: true });
  await service.dispatch({
    type: "start",
    requestId: "one",
    driver: "demo",
    language: "zh",
  });
  let view = await service.snapshot();
  const id = view.session!.id;
  expect(view.session!.deadline).toBeUndefined();
  await service.dispatch({
    type: "start",
    requestId: "one",
    driver: "demo",
    language: "zh",
  });
  expect((await service.snapshot()).pool.sessions).toHaveLength(1);
  await service.dispatch({ type: "opening", sessionId: id, displayId: "tv" });
  await expect(
    service.dispatch({ type: "settle", sessionId: id }),
  ).rejects.toThrow("尚未到时");
  for (let i = 0; i < 120; i++) {
    advance(1000);
    await service.dispatch({
      type: "display",
      displayId: "tv",
      prepared: true,
    });
  }
  await service.dispatch({ type: "settle", sessionId: id });
  await service.dispatch({ type: "settle", sessionId: id });
  view = await service.snapshot();
  expect(view.session!.result?.rank).toBe(1);
  expect(view.pool.available).toEqual([5, 3, 3, 18, 30, 30, 200]);
  expect(view.pool.allocated).toEqual([1, 0, 0, 0, 0, 0, 0]);
});

test("cancellation preserves stock, only between rounds can the next batch open, and formal is isolated", async () => {
  const { service } = await setup();
  await service.dispatch({ type: "display", displayId: "tv", prepared: true });
  await service.dispatch({
    type: "start",
    requestId: "one",
    driver: "demo",
    language: "zh",
  });
  const id = (await service.snapshot()).session!.id;
  await expect(
    service.dispatch({ type: "batch", expectedBatch: 2 }),
  ).rejects.toThrow("局间");
  await service.dispatch({ type: "cancel", sessionId: id });
  expect((await service.snapshot()).pool.allocated).toEqual([
    0, 0, 0, 0, 0, 0, 0,
  ]);
  await service.dispatch({ type: "batch", expectedBatch: 2 });
  await service.dispatch({ type: "batch", expectedBatch: 2 });
  expect((await service.snapshot()).pool.available).toEqual([
    12, 6, 6, 36, 60, 60, 200,
  ]);
  await service.dispatch({ type: "mode", mode: "formal" });
  expect((await service.snapshot()).pool.available).toEqual([
    6, 3, 3, 18, 30, 30, 200,
  ]);
  await expect(
    service.dispatch({
      type: "start",
      requestId: "two",
      driver: "demo",
      language: "zh",
    }),
  ).rejects.toThrow("彩排");
});

test("an abandoned display cancels an unfinished round, but a saved result survives stop, restart and next", async () => {
  const { service, advance, client } = await setup();
  await service.dispatch({ type: "display", displayId: "tv", prepared: true });
  await service.dispatch({
    type: "start",
    requestId: "one",
    driver: "demo",
    language: "en",
  });
  advance(7000);
  expect((await service.snapshot()).session!.status).toBe("cancelled");
  expect((await service.snapshot()).pool.allocated).toEqual([
    0, 0, 0, 0, 0, 0, 0,
  ]);
  const cancelled = (await service.snapshot()).session!.id;
  await service.dispatch({ type: "next", sessionId: cancelled });
  await service.dispatch({ type: "display", displayId: "tv2", prepared: true });
  await service.dispatch({
    type: "start",
    requestId: "two",
    driver: "demo",
    language: "en",
  });
  const id = (await service.snapshot()).session!.id;
  await service.dispatch({ type: "opening", sessionId: id, displayId: "tv2" });
  for (let i = 0; i < 120; i++) {
    advance(1000);
    await service.dispatch({
      type: "display",
      displayId: "tv2",
      prepared: true,
    });
  }
  await service.dispatch({ type: "settle", sessionId: id });
  await service.dispatch({ type: "cancel", sessionId: id });
  const result = (await service.snapshot()).session!.result;
  const reopened = new DumplingService(client);
  expect((await reopened.snapshot()).session!.result).toEqual(result);
  await reopened.dispatch({ type: "next", sessionId: id });
  expect((await reopened.snapshot()).session).toBeUndefined();
  expect(
    (await reopened.snapshot()).pool.sessions.filter((s) => s.result),
  ).toHaveLength(1);
});

test("concurrent staff and TV requests on separate connections cannot allocate twice", async () => {
  const { service, advance, dir } = await setup();
  const otherClient = localStore(join(dir, "test.db"));
  cleanups.push(async () => {
    otherClient.close();
  });
  const other = new DumplingService(otherClient, {
    now: () => 220_000,
    random: () => 0,
  });
  await service.dispatch({ type: "display", displayId: "tv", prepared: true });
  await service.dispatch({
    type: "start",
    requestId: "one",
    driver: "demo",
    language: "zh",
  });
  const id = (await service.snapshot()).session!.id;
  await service.dispatch({ type: "opening", sessionId: id, displayId: "tv" });
  for (let i = 0; i < 120; i++) {
    advance(1000);
    await service.dispatch({
      type: "display",
      displayId: "tv",
      prepared: true,
    });
  }
  await Promise.all([
    service.dispatch({ type: "settle", sessionId: id }),
    other.dispatch({ type: "settle", sessionId: id }),
  ]);
  expect((await service.snapshot()).pool.allocated).toEqual([
    1, 0, 0, 0, 0, 0, 0,
  ]);
});

test("a participant keeps one gift after the display disconnects, even before finishing the game", async () => {
  const { service, advance } = await setup();
  await service.dispatch({ type: "display", displayId: "tv", prepared: true });
  await service.dispatch({
    type: "start",
    requestId: "lost",
    driver: "demo",
    language: "zh",
  });
  const id = (await service.snapshot()).session!.id;
  await service.dispatch({ type: "opening", sessionId: id, displayId: "tv" });
  advance(121_000);
  const view = await service.snapshot();
  expect(view.session!.status).toBe("completed");
  expect(view.session!.result?.rank).toBe(1);
  expect(view.session!.announcement).toBe("fallback");
  expect(view.pool.allocated).toEqual([1, 0, 0, 0, 0, 0, 0]);
  await service.dispatch({ type: "cancel", sessionId: id });
  expect((await service.snapshot()).session!.result).toEqual(
    view.session!.result,
  );
  expect((await service.snapshot()).pool.available).toEqual([
    5, 3, 3, 18, 30, 30, 200,
  ]);
});

test.each(["staff", "safety", "restart"])(
  "a started participant keeps a single gift after %s interrupts the game",
  async (reason) => {
    const { service, client } = await setup();
    await service.dispatch({
      type: "display",
      displayId: "tv",
      prepared: true,
    });
    await service.dispatch({
      type: "start",
      requestId: reason,
      driver: "demo",
      language: "zh",
    });
    const sessionId = (await service.snapshot()).session!.id;
    await service.dispatch({ type: "opening", sessionId, displayId: "tv" });
    if (reason === "staff")
      await service.dispatch({ type: "cancel", sessionId });
    else if (reason === "safety") {
      await service.dispatch({ type: "violation", sessionId, displayId: "tv" });
      await service.dispatch({ type: "violation", sessionId, displayId: "tv" });
    } else await new DumplingService(client, { random: () => 0 }).init(true);
    const view = await service.snapshot();
    expect(view.session?.status).toBe("completed");
    expect(view.session?.result?.rank).toBe(1);
    expect(view.pool.allocated).toEqual([1, 0, 0, 0, 0, 0, 0]);
    await new DumplingService(client).init(true);
    expect((await service.snapshot()).session?.result).toEqual(
      view.session?.result,
    );
    expect((await service.snapshot()).pool.available).toEqual([
      5, 3, 3, 18, 30, 30, 200,
    ]);
  },
);

test("local restart cancels unfinished sessions while preserving an allocated result", async () => {
  const { service, client } = await setup();
  await service.dispatch({ type: "display", displayId: "tv", prepared: true });
  await service.dispatch({
    type: "start",
    requestId: "one",
    driver: "demo",
    language: "zh",
  });
  const restarted = new DumplingService(client);
  await restarted.init(true);
  expect((await restarted.snapshot()).session!.status).toBe("cancelled");
  expect((await restarted.snapshot()).pool.allocated).toEqual([
    0, 0, 0, 0, 0, 0, 0,
  ]);
});

test.each([
  [0, 1],
  [5, 1],
  [6, 2],
  [8, 2],
  [9, 3],
  [11, 3],
  [12, 4],
  [29, 4],
  [30, 5],
  [59, 5],
  [60, 6],
  [89, 6],
  [90, 7],
  [289, 7],
])(
  "ticket %i maps to gift rank %i in the first 290-item pool",
  async (ticket, rank) => {
    const { service, advance } = await setup(5, ticket);
    await service.dispatch({
      type: "display",
      displayId: "tv",
      prepared: true,
    });
    await service.dispatch({
      type: "start",
      requestId: "one",
      driver: "demo",
      language: "zh",
    });
    const sessionId = (await service.snapshot()).session!.id;
    await service.dispatch({ type: "opening", sessionId, displayId: "tv" });
    advance(5000);
    expect((await service.snapshot()).session!.result?.rank).toBe(rank);
  },
);

test("staff can configure this pool's gifts and stock without changing past gifts or another pool", async () => {
  const { service } = await setup();
  await service.dispatch({ type: "display", displayId: "tv", prepared: true });
  await service.dispatch({
    type: "start",
    requestId: "stock-edit",
    driver: "demo",
    language: "zh",
  });
  const sessionId = (await service.snapshot()).session!.id;
  await service.dispatch({ type: "opening", sessionId, displayId: "tv" });
  await service.dispatch({ type: "cancel", sessionId });
  const before = await service.snapshot();
  const gifts = before.gifts.map((g, i) =>
    i ? g : { zh: "耳机", en: "Headphones" },
  );
  const edit = {
    type: "inventory" as const,
    mode: before.mode,
    expectedRevision: before.pool.revision ?? 0,
    gifts,
    available: [9, 3, 3, 18, 30, 30, 200],
    batchPlan: before.pool.batchPlan!,
    reason: "现场盘点",
  };
  await service.dispatch(edit);
  let view = await service.snapshot();
  expect(view.gifts[0]?.zh).toBe("耳机");
  expect(view.pool.available[0]).toBe(9);
  expect(view.pool.allocated[0]).toBe(1);
  expect(view.session!.result?.gift.zh).toBe("饺子兑换券");
  await expect(
    service.dispatch({ ...edit, available: [99, 3, 3, 18, 30, 30, 200] }),
  ).rejects.toThrow(/变更/);
  await service.dispatch({ type: "mode", mode: "formal" });
  view = await service.snapshot();
  expect(view.pool.available).toEqual([6, 3, 3, 18, 30, 30, 200]);
  expect(view.gifts[0]?.zh).toBe("饺子兑换券");
});

test("reset is isolated, logged durably, and reversible to a selected checkpoint after reopening", async () => {
  const { service, client } = await setup();
  await service.dispatch({ type: "display", displayId: "tv", prepared: true });
  await service.dispatch({
    type: "start",
    requestId: "recover",
    driver: "demo",
    language: "zh",
  });
  const sessionId = (await service.snapshot()).session!.id;
  await service.dispatch({ type: "opening", sessionId, displayId: "tv" });
  await service.dispatch({ type: "cancel", sessionId });
  const before = await service.snapshot();
  const points = await service.checkpoints();
  const point = points[0]!;
  for (let i = 0; i < 10; i++)
    await service.dispatch({
      type: "display",
      displayId: "tv",
      prepared: true,
    });
  expect(await service.checkpoints()).toHaveLength(points.length);
  await service.dispatch({
    type: "reset",
    mode: "rehearsal",
    expectedRevision: before.pool.revision ?? 0,
    confirmation: "彩排",
    reason: "彩排重新开始",
  });
  expect((await service.snapshot()).pool.sessions).toHaveLength(0);
  const reopened = new DumplingService(client);
  await reopened.init(true);
  const reset = await reopened.snapshot();
  expect(reset.pool.available).toEqual([6, 3, 3, 18, 30, 30, 200]);
  const logs = await reopened.checkpoints();
  expect(logs.some((p) => p.action.includes("彩排重新开始"))).toBe(true);
  await reopened.restoreCheckpoint(
    point.id,
    "rehearsal",
    reset.pool.revision ?? 0,
    "彩排",
    "恢复发奖记录",
  );
  const recovered = await reopened.snapshot();
  expect(recovered.session?.result).toEqual(before.session?.result);
  expect(recovered.pool.available).toEqual(before.pool.available);
  expect(recovered.pool.allocated).toEqual([1, 0, 0, 0, 0, 0, 0]);
  expect(recovered.pool.revision).toBeGreaterThan(reset.pool.revision!);
  await reopened.dispatch({ type: "mode", mode: "formal" });
  expect((await reopened.snapshot()).pool.allocated).toEqual([
    0, 0, 0, 0, 0, 0, 0,
  ]);
});

test("restoring an earlier started round retains its already known gift instead of redrawing", async () => {
  const { service, client } = await setup();
  await service.dispatch({ type: "display", displayId: "tv", prepared: true });
  await service.dispatch({
    type: "start",
    requestId: "known-gift",
    driver: "demo",
    language: "zh",
  });
  const sessionId = (await service.snapshot()).session!.id;
  await service.dispatch({ type: "opening", sessionId, displayId: "tv" });
  const point = (await service.checkpoints())[0]!;
  await service.dispatch({ type: "cancel", sessionId });
  const original = await service.snapshot();
  const reopened = new DumplingService(client, {
    now: () => 100_000,
    random: () => 227,
  });
  await reopened.restoreCheckpoint(
    point.id,
    "rehearsal",
    original.pool.revision!,
    "彩排",
    "恢复开聊时刻",
  );
  const recovered = await reopened.snapshot();
  expect(recovered.session?.result).toEqual(original.session?.result);
  expect(recovered.pool.available).toEqual([5, 3, 3, 18, 30, 30, 200]);
  expect(recovered.pool.allocated).toEqual([1, 0, 0, 0, 0, 0, 0]);
});

test("seven-gift inventory edits, participation gifts, reset and checkpoints keep the seven-gift catalog", async () => {
  const { service, client } = await setup(120, 90);
  const initial = await service.snapshot();
  expect(initial.gifts).toHaveLength(7);
  expect(initial.pool.available).toEqual([6, 3, 3, 18, 30, 30, 200]);
  const gifts = structuredClone(initial.gifts);
  gifts[6] = { zh: "测试贴纸", en: "Test stickers" };
  const plan = structuredClone(initial.pool.batchPlan!);
  plan[1]![6] = 4;
  await service.dispatch({
    type: "inventory",
    mode: "rehearsal",
    expectedRevision: 0,
    gifts,
    available: [6, 3, 3, 18, 30, 30, 12],
    batchPlan: plan,
    reason: "核对七类库存",
  });
  await service.dispatch({ type: "display", displayId: "tv", prepared: true });
  await service.dispatch({
    type: "start",
    requestId: "seventh-gift",
    driver: "demo",
    language: "zh",
  });
  const sessionId = (await service.snapshot()).session!.id;
  await service.dispatch({ type: "opening", sessionId, displayId: "tv" });
  await service.dispatch({ type: "cancel", sessionId });
  const awarded = await service.snapshot();
  expect(awarded.session!.result?.rank).toBe(7);
  expect(awarded.session!.result?.gift).toEqual(gifts[6]);
  const point = (await service.checkpoints())[0]!;
  await service.dispatch({
    type: "reset",
    mode: "rehearsal",
    expectedRevision: awarded.pool.revision!,
    confirmation: "彩排",
    reason: "恢复测试",
  });
  const reset = await service.snapshot();
  expect(reset.pool.available[6]).toBe(12);
  expect(reset.pool.allocated).toEqual([0, 0, 0, 0, 0, 0, 0]);
  await service.restoreCheckpoint(
    point.id,
    "rehearsal",
    reset.pool.revision!,
    "彩排",
    "恢复第七类礼品",
  );
  const reopened = new DumplingService(client);
  const restored = await reopened.snapshot();
  expect(restored.session!.result).toEqual(awarded.session!.result);
  expect(restored.gifts[6]).toEqual(gifts[6]);
  expect(restored.pool.available[6]).toBe(11);
  expect(restored.batchSchedule![1]![6]).toBe(4);
  await reopened.dispatch({ type: "mode", mode: "formal" });
  expect((await reopened.snapshot()).pool.available).toEqual(
    initial.pool.available,
  );
});

// Keep all 500 rounds and exhaustion assertions; only the test storage changes.
test("all four batches contain exactly 500 single-item tickets, and exhaustion blocks another start", async () => {
  const { service, advance } = await setup(5, 0, "memory");
  for (let round = 0; round < 500; round++) {
    let view = await service.snapshot();
    if (view.pool.available.every((n) => n === 0))
      await service.dispatch({
        type: "batch",
        expectedBatch: view.pool.openedBatch + 1,
      });
    await service.dispatch({
      type: "display",
      displayId: "tv",
      prepared: true,
    });
    await service.dispatch({
      type: "start",
      requestId: `r-${round}`,
      driver: "demo",
      language: "zh",
    });
    const id = (await service.snapshot()).session!.id;
    await service.dispatch({ type: "opening", sessionId: id, displayId: "tv" });
    advance(5000);
    await service.dispatch({
      type: "announced",
      sessionId: id,
      displayId: "tv",
    });
    expect((await service.snapshot()).session).toMatchObject({
      status: "announcing",
      announcementKind: "goodbye",
    });
    await service.dispatch({
      type: "announced",
      sessionId: id,
      displayId: "tv",
      kind: "goodbye",
    });
    expect((await service.snapshot()).session!.status).toBe("completed");
    await service.dispatch({ type: "next", sessionId: id });
  }
  const view = await service.snapshot();
  expect(view.pool.allocated).toEqual([20, 10, 10, 60, 100, 100, 200]);
  expect(view.pool.available).toEqual([0, 0, 0, 0, 0, 0, 0]);
  await expect(
    service.dispatch({
      type: "start",
      requestId: "extra",
      driver: "demo",
      language: "zh",
    }),
  ).rejects.toThrow("全部发完");
}, 180_000);
