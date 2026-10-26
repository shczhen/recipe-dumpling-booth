import { DatabaseSync } from "node:sqlite";
import { createClient } from "@libsql/client/web";
import { mkdirSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Checkpoint, Store } from "../shared/model";

interface Change {
  action: string;
  now: number;
  force?: boolean;
}
export interface SavedCheckpoint extends Checkpoint {
  store: Store;
}
export interface StateStore {
  init(): Promise<void>;
  update<T>(
    initial: () => Store,
    work: (state: Store) => T,
    change?: Change,
  ): Promise<T>;
  checkpoints(mode: string, before?: number): Promise<Checkpoint[]>;
  checkpoint(id: number): Promise<SavedCheckpoint | undefined>;
  recoveryWarning?: string;
  close(): void;
}
const schema =
  "CREATE TABLE IF NOT EXISTS store (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)";
const historySchema =
  "CREATE TABLE IF NOT EXISTS checkpoints (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, action TEXT NOT NULL, mode TEXT NOT NULL, data TEXT NOT NULL)";
const upsert =
  "INSERT INTO store(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data";
// Heartbeats and device preparation must never create a checkpoint every second.
const meaningful = (state?: Store) =>
  state ? JSON.stringify({ ...state, display: undefined }) : "";
const saved = (row: Record<string, unknown>): SavedCheckpoint => ({
  id: Number(row.id),
  createdAt: Number(row.created_at),
  action: String(row.action),
  mode: row.mode as Checkpoint["mode"],
  store: JSON.parse(String(row.data)),
});
const metadata = ({ store: _store, ...point }: SavedCheckpoint): Checkpoint =>
  point;

/** State and recovery history commit together. Local immutable files survive a damaged main DB. */
export function localStore(path: string): StateStore {
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=2000",
  );
  const recoveryDir = path === ":memory:" ? undefined : `${path}.recovery`;
  const pending = new Set<number>();
  const publish = (point: SavedCheckpoint) => {
    if (!recoveryDir) return;
    const file = join(
      recoveryDir,
      `checkpoint-${String(point.id).padStart(8, "0")}.json`,
    );
    if (existsSync(file)) return;
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(point), {
      mode: 0o600,
      flush: true,
    });
    renameSync(temporary, file);
  };
  const publishPending = () => {
    for (const id of pending) {
      try {
        mkdirSync(recoveryDir!, { recursive: true, mode: 0o700 });
        const row = db.prepare("SELECT * FROM checkpoints WHERE id=?").get(id);
        if (row) publish(saved(row));
        pending.delete(id);
      } catch {
        // Keep every missed file pending, even when a newer file succeeds.
      }
    }
    store.recoveryWarning = pending.size
      ? "独立恢复文件写入失败；数据库内日志仍保留，请立即导出备份并检查磁盘。"
      : undefined;
  };
  const store: StateStore = {
    async init() {
      db.exec(schema);
      db.exec(historySchema);
      if (recoveryDir) {
        // Repair a file missed by a process crash immediately after SQLite commit.
        for (const row of db
          .prepare("SELECT id FROM checkpoints ORDER BY id")
          .iterate())
          pending.add(Number(row.id));
        publishPending();
      }
    },
    async update(
      initial,
      work,
      change = { action: "状态自动推进", now: Date.now() },
    ) {
      db.exec("BEGIN IMMEDIATE");
      let point: SavedCheckpoint | undefined;
      let result;
      try {
        const row = db.prepare("SELECT data FROM store WHERE id=1").get();
        const state: Store = row ? JSON.parse(String(row.data)) : initial();
        const before = row ? meaningful(state) : "";
        result = work(state);
        const data = JSON.stringify(state);
        db.prepare(upsert).run(data);
        if (change.force || before !== meaningful(state)) {
          const inserted = db
            .prepare(
              "INSERT INTO checkpoints(created_at,action,mode,data) VALUES(?,?,?,?)",
            )
            .run(change.now, change.action, state.mode, data);
          point = {
            id: Number(inserted.lastInsertRowid),
            createdAt: change.now,
            action: change.action,
            mode: state.mode,
            store: state,
          };
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      if (point && recoveryDir) pending.add(point.id);
      if (recoveryDir) publishPending();
      return result;
    },
    async checkpoints(mode, before = Number.MAX_SAFE_INTEGER) {
      return db
        .prepare(
          "SELECT id,created_at,action,mode FROM checkpoints WHERE mode=? AND id<? ORDER BY id DESC LIMIT 50",
        )
        .all(mode, before)
        .map((row) => ({
          id: Number(row.id),
          createdAt: Number(row.created_at),
          action: String(row.action),
          mode: row.mode as Checkpoint["mode"],
        }));
    },
    async checkpoint(id) {
      const row = db.prepare("SELECT * FROM checkpoints WHERE id=?").get(id);
      return row ? saved(row) : undefined;
    },
    close() {
      db.close();
    },
  };
  return store;
}

/** Remote deployments use the same atomic state/history transaction. */
export function remoteStore(url: string, authToken: string): StateStore {
  const client = createClient({ url, authToken });
  return {
    async init() {
      await client.batch([schema, historySchema], "write");
    },
    async update(
      initial,
      work,
      change = { action: "状态自动推进", now: Date.now() },
    ) {
      const tx = await client.transaction("write");
      try {
        const row = (await tx.execute("SELECT data FROM store WHERE id=1"))
          .rows[0];
        const state: Store = row ? JSON.parse(String(row.data)) : initial();
        const before = row ? meaningful(state) : "";
        const result = work(state);
        const data = JSON.stringify(state);
        await tx.execute({ sql: upsert, args: [data] });
        if (change.force || before !== meaningful(state))
          await tx.execute({
            sql: "INSERT INTO checkpoints(created_at,action,mode,data) VALUES(?,?,?,?)",
            args: [change.now, change.action, state.mode, data],
          });
        await tx.commit();
        return result;
      } catch (error) {
        await tx.rollback();
        throw error;
      } finally {
        tx.close();
      }
    },
    async checkpoints(mode, before = Number.MAX_SAFE_INTEGER) {
      return (
        await client.execute({
          sql: "SELECT * FROM checkpoints WHERE mode=? AND id<? ORDER BY id DESC LIMIT 50",
          args: [mode, before],
        })
      ).rows.map((row) => metadata(saved(row)));
    },
    async checkpoint(id) {
      const row = (
        await client.execute({
          sql: "SELECT * FROM checkpoints WHERE id=?",
          args: [id],
        })
      ).rows[0];
      return row ? saved(row) : undefined;
    },
    close() {
      client.close();
    },
  };
}
