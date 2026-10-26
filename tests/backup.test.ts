import { expect, test } from "vitest";
import { mkdtemp, writeFile, rm, rename, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { localStore } from "../src/server/store";
import { DumplingService } from "../src/server/service";
test("an exported backup restores stock into a new directory and refuses an overwrite", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dumpling-backup-"));
  const store = localStore(join(dir, "source.db"));
  let restored: ReturnType<typeof localStore> | undefined;
  try {
    const service = new DumplingService(store);
    await service.init();
    await service.dispatch({ type: "batch", expectedBatch: 2 });
    const file = join(dir, "backup.json");
    await writeFile(file, JSON.stringify(await service.backup()));
    const target = join(dir, "restored");
    const run = () =>
      spawnSync(process.execPath, ["scripts/restore.mjs", file, target], {
        encoding: "utf8",
      });
    expect(run().status).toBe(0);
    restored = localStore(join(target, "dumpling.sqlite"));
    const reopened = new DumplingService(restored);
    expect((await reopened.snapshot()).pool.available).toEqual([
      12, 6, 6, 36, 60, 60, 200,
    ]);
    expect(run().status).toBe(1);
  } finally {
    restored?.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("automatic checkpoint files restore edited stock and an already revealed gift after the source is gone", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dumpling-recovery-"));
  const database = join(dir, "source.sqlite");
  const store = localStore(database);
  let closed = false;
  let restored: ReturnType<typeof localStore> | undefined;
  try {
    let now = Date.now();
    const service = new DumplingService(store, {
      random: () => 0,
      now: () => now,
    });
    await service.init();
    const view = await service.snapshot();
    await service.dispatch({
      type: "inventory",
      mode: "rehearsal",
      expectedRevision: 0,
      gifts: view.gifts.map((g, i) =>
        i ? g : { zh: "测试耳机", en: "Test headphones" },
      ),
      available: [9, 3, 3, 18, 30, 30, 200],
      batchPlan: view.pool.batchPlan!,
      reason: "盘点补货",
    });
    await service.dispatch({
      type: "display",
      displayId: "tv",
      prepared: true,
    });
    await service.dispatch({
      type: "start",
      requestId: "checkpoint",
      driver: "demo",
      language: "zh",
    });
    const sessionId = (await service.snapshot()).session!.id;
    await service.dispatch({ type: "opening", sessionId, displayId: "tv" });
    for (let i = 0; i < 90; i++) {
      now += 1000;
      await service.dispatch({
        type: "display",
        displayId: "tv",
        prepared: true,
      });
    }
    await service.dispatch({ type: "announced", sessionId, displayId: "tv" });
    const point = (await service.checkpoints())[0]!;
    const file = join(
      `${database}.recovery`,
      `checkpoint-${String(point.id).padStart(8, "0")}.json`,
    );
    store.close();
    closed = true;
    await rm(database);
    const target = join(dir, "restored");
    const run = spawnSync(
      process.execPath,
      ["scripts/restore.mjs", file, target],
      { encoding: "utf8" },
    );
    expect(run.status, run.stderr).toBe(0);
    restored = localStore(join(target, "dumpling.sqlite"));
    const recovered = new DumplingService(restored);
    await recovered.init();
    const state = await recovered.snapshot();
    expect(state.pool.available).toEqual([8, 3, 3, 18, 30, 30, 200]);
    expect(state.pool.allocated).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(state.gifts[0]?.zh).toBe("测试耳机");
    expect(state.session?.status).toBe("completed");
    expect(state.session?.result?.gift.zh).toBe("测试耳机");
    expect(state.session?.agentStopped).toBe(true);
  } finally {
    if (!closed) store.close();
    restored?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("offline recovery still gives an interrupted participant exactly one gift", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dumpling-participant-"));
  const store = localStore(join(dir, "source.sqlite"));
  let restored: ReturnType<typeof localStore> | undefined;
  try {
    const service = new DumplingService(store);
    await service.init();
    await service.dispatch({
      type: "display",
      displayId: "tv",
      prepared: true,
    });
    await service.dispatch({
      type: "start",
      requestId: "participated",
      driver: "demo",
      language: "zh",
    });
    const sessionId = (await service.snapshot()).session!.id;
    await service.dispatch({ type: "opening", sessionId, displayId: "tv" });
    const file = join(dir, "backup.json");
    await writeFile(file, JSON.stringify(await service.backup()));
    const target = join(dir, "restored");
    const run = spawnSync(
      process.execPath,
      ["scripts/restore.mjs", file, target],
      { encoding: "utf8" },
    );
    expect(run.status, run.stderr).toBe(0);
    restored = localStore(join(target, "dumpling.sqlite"));
    const recovered = new DumplingService(restored, { random: () => 0 });
    await recovered.init(true);
    const first = await recovered.snapshot();
    expect(first.session?.status).toBe("completed");
    expect(first.session?.result?.rank).toBe(1);
    expect(first.pool.allocated).toEqual([1, 0, 0, 0, 0, 0, 0]);
    await recovered.init(true);
    expect((await recovered.snapshot()).session?.result).toEqual(
      first.session?.result,
    );
    expect((await recovered.snapshot()).pool.available).toEqual([
      5, 3, 3, 18, 30, 30, 200,
    ]);
  } finally {
    store.close();
    restored?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a recovered disk retries every missed checkpoint before clearing the warning", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dumpling-disk-"));
  const database = join(dir, "source.sqlite");
  const store = localStore(database);
  try {
    const service = new DumplingService(store);
    await service.init();
    const recovery = `${database}.recovery`;
    await rename(recovery, `${recovery}.saved`);
    await writeFile(recovery, "blocked");
    await service.dispatch({ type: "checkpoint", label: "磁盘故障期间" });
    expect((await service.snapshot()).recoveryWarning).toBeTruthy();
    const missed = (await service.checkpoints())[0]!;
    await rm(recovery);
    await rename(`${recovery}.saved`, recovery);
    await service.dispatch({ type: "checkpoint", label: "磁盘恢复后" });
    expect((await service.snapshot()).recoveryWarning).toBeUndefined();
    const file = join(
      recovery,
      `checkpoint-${String(missed.id).padStart(8, "0")}.json`,
    );
    expect(JSON.parse(await readFile(file, "utf8")).id).toBe(missed.id);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
