import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import catalog from "./catalog.json" with { type: "json" };
export function restoreBackup(file, directory) {
  const backup = JSON.parse(readFileSync(file, "utf8"));
  const state = backup.store;
  const fail = () => {
    throw new Error(
      "Backup format or inventory validation failed. No data was restored.",
    );
  };
  if (
    state?.version !== 1 ||
    !["rehearsal", "formal", "online"].includes(state.mode)
  )
    fail();
  const { batches, gifts } = catalog;
  for (const mode of ["rehearsal", "formal", "online"]) {
    const pool = state.pools?.[mode];
    if (
      !pool ||
      !Number.isInteger(pool.openedBatch) ||
      pool.openedBatch < 1 ||
      pool.openedBatch > 4 ||
      !Array.isArray(pool.sessions) ||
      pool.sessions.length > 10000
    )
      fail();
    if (
      ![pool.available, pool.allocated].every(
        (list) =>
          Array.isArray(list) &&
          list.length === gifts.length &&
          list.every((n) => Number.isInteger(n) && n >= 0),
      )
    )
      fail();
    const plan = pool.batchPlan ?? batches;
    const adjustments = pool.stockAdjustments ?? gifts.map(() => 0);
    if (
      !Array.isArray(plan) ||
      plan.length !== 4 ||
      plan.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== gifts.length ||
          row.some((n) => !Number.isInteger(n) || n < 0 || n > 10000),
      ) ||
      !Array.isArray(adjustments) ||
      adjustments.length !== gifts.length ||
      adjustments.some((n) => !Number.isInteger(n)) ||
      (pool.gifts &&
        (!Array.isArray(pool.gifts) ||
          pool.gifts.length !== gifts.length ||
          pool.gifts.some(
            (g) =>
              typeof g.zh !== "string" ||
              !g.zh ||
              g.zh.length > 60 ||
              typeof g.en !== "string" ||
              !g.en ||
              g.en.length > 60,
          )))
    )
      fail();
    for (let rank = 0; rank < gifts.length; rank++) {
      const opened = plan
        .slice(0, pool.openedBatch)
        .reduce((n, batch) => n + batch[rank], 0);
      if (
        pool.available[rank] + pool.allocated[rank] !==
        opened + adjustments[rank]
      )
        fail();
      if (
        pool.sessions.filter((s) => s.result?.rank === rank + 1).length !==
        pool.allocated[rank]
      )
        fail();
    }
    const ids = new Set();
    for (const session of pool.sessions) {
      if (
        typeof session.id !== "string" ||
        ids.has(session.id) ||
        session.mode !== mode ||
        !["demo", "agora"].includes(session.driver) ||
        !["zh", "en"].includes(session.language) ||
        ![
          "connecting",
          "chatting",
          "announcing",
          "gifted",
          "completed",
          "cancelled",
        ].includes(session.status)
      )
        fail();
      ids.add(session.id);
      if (
        !Number.isFinite(session.createdAt) ||
        !Number.isInteger(session.duration) ||
        session.duration < 5 ||
        session.duration > 120
      )
        fail();
      if (
        session.result &&
        (!Number.isInteger(session.result.rank) ||
          session.result.rank < 1 ||
          session.result.rank > gifts.length ||
          typeof session.result.gift?.zh !== "string" ||
          typeof session.result.gift?.en !== "string" ||
          typeof session.result.closing !== "string")
      )
        fail();
      if (
        ["connecting", "chatting", "announcing", "gifted"].includes(
          session.status,
        )
      ) {
        // Started participants without a saved result are settled by the service
        // on startup, using the same atomic inventory path as live interruptions.
        if (session.result || session.startedAt === undefined)
          session.status = session.result ? "completed" : "cancelled";
        session.muted = true;
        session.reason = "disconnect";
        session.endedAt = Date.now();
        if (session.result) session.announcement = "fallback";
      }
      // A restored process never resumes an old cloud audio connection.
      session.agentStopped = true;
    }
    if (pool.currentId && !ids.has(pool.currentId)) fail();
  }
  state.display = undefined;
  const target = resolve(directory);
  mkdirSync(target, { recursive: true });
  const databaseFile = join(target, "dumpling.sqlite");
  if (existsSync(databaseFile))
    throw new Error(
      "The target database already exists. Restore into a new directory.",
    );
  const db = new DatabaseSync(databaseFile);
  try {
    db.exec(
      "CREATE TABLE store (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)",
    );
    db.prepare("INSERT INTO store(id,data) VALUES(1,?)").run(
      JSON.stringify(state),
    );
  } catch (error) {
    db.close();
    rmSync(databaseFile, { force: true });
    throw error;
  }
  db.close();
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  try {
    if (!process.argv[2] || !process.argv[3])
      throw new Error(
        "Usage: node scripts/restore.mjs backup.json new-data-directory",
      );
    restoreBackup(process.argv[2], process.argv[3]);
    console.log(
      "Backup restored. Set DATA_DIR to the new directory before starting. The original data is unchanged.",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
