import type { StateStore } from "./store";
import { gameDefinitions } from "../shared/games";
import { gameFor } from "./prompts/games";
import { randomInt, randomUUID } from "node:crypto";
import {
  catalog,
  modeNames,
  type Gift,
  type Mode,
  type Pool,
  type Snapshot,
  isActive,
  giftTime,
  type Store,
  type Session,
  type Command,
} from "../shared/model";

const closings = {
  zh: [
    "对了，来玩还有礼品呢。抽到的是{gift}，给你留好了，找工作人员拿就行。",
    "先插一句，你的礼品抽出来了，是{gift}。找工作人员拿，别忘了。",
    "差点忘了，还有礼品呢。你抽到{gift}，我给你留着，找工作人员拿。",
  ],
  en: [
    "Oh, and I've got a gift for you: {gift}! Ask a staff member and they'll get it for you.",
    "Before I forget, I've got something for you: {gift}! Pick it up from the staff when you're ready.",
    "Hang on, there's a gift for you too: {gift}! The staff will help you collect it.",
  ],
};
export class DomainError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
interface Options {
  now?: () => number;
  random?: (max: number) => number;
  gifts?: Gift[];
  deployment?: "local" | "online";
  agoraReady?: boolean;
  demoSeconds?: number;
}
const makePool = (): Pool => ({
  revision: 0,
  available: [...catalog.batches[0]!],
  allocated: catalog.gifts.map(() => 0),
  openedBatch: 1,
  sessions: [],
});
export class DumplingService {
  private now: () => number;
  private random: (max: number) => number;
  private options: Options;
  constructor(
    private store: StateStore,
    options: Options = {},
  ) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? randomInt;
  }
  async init(recoverLocal = false) {
    await this.store.init();
    await this.transaction(() => {}, "启动恢复点", recoverLocal);
    if (recoverLocal)
      await this.transaction((state) => {
        for (const pool of Object.values(state.pools))
          for (const session of pool.sessions)
            if (isActive(session))
              this.cancel(pool, session, this.now(), "disconnect");
        state.display = undefined;
      });
  }
  private transaction<T>(
    work: (state: Store) => T,
    action = "状态自动推进",
    force = false,
  ): Promise<T> {
    return this.store.update(
      () => ({
        version: 1,
        mode: this.options.deployment === "online" ? "online" : "rehearsal",
        pools: {
          rehearsal: makePool(),
          formal: makePool(),
          online: makePool(),
        },
      }),
      (state) => {
        for (const pool of Object.values(state.pools)) {
          pool.gifts ??= structuredClone(
            this.options.gifts?.length === catalog.gifts.length
              ? this.options.gifts
              : catalog.gifts,
          );
          pool.batchPlan ??= structuredClone(catalog.batches);
        }
        this.reconcile(state);
        return work(state);
      },
      { action, now: this.now(), force },
    );
  }
  async snapshot(): Promise<Snapshot> {
    return this.transaction((state) => ({
      mode: state.mode,
      recoveryWarning: this.store.recoveryWarning,
      pool: {
        ...state.pools[state.mode],
        batchPlan: state.pools[state.mode].batchPlan!,
      },
      session: state.pools[state.mode].sessions.find(
        (s) => s.id === state.pools[state.mode].currentId,
      ),
      display: state.display,
      serverNow: this.now(),
      gifts: this.giftsFor(state),
      batchSchedule: state.pools[state.mode].batchPlan!,
      modes:
        this.options.deployment === "online"
          ? ["online"]
          : ["rehearsal", "formal"],
      agoraReady: this.options.agoraReady ?? false,
      demoSeconds: this.options.demoSeconds ?? 120,
      deployment: this.options.deployment ?? "local",
    }));
  }
  async dispatch(command: Command): Promise<void> {
    await this.transaction(
      (state) => {
        if (command.type === "checkpoint") return;
        const pool = state.pools[state.mode];
        const current = pool.sessions.find((s) => s.id === pool.currentId);
        const now = this.now();
        if (command.type === "release") {
          if (state.display?.id === command.displayId) {
            if (current && isActive(current))
              this.cancel(pool, current, now, "disconnect");
            state.display = undefined;
          }
          return;
        }
        if (command.type === "display") {
          if (
            state.display &&
            state.display.id !== command.displayId &&
            now - state.display.seenAt < 6000
          )
            throw new DomainError("另一电视页已连接，请先关闭它并等待 6 秒");
          state.display = {
            id: command.displayId,
            seenAt: now,
            prepared: command.prepared,
            audioReady: command.audioReady,
          };
          return;
        }
        if (command.type === "mode") {
          if (isActive(current)) throw new DomainError("仅局间可切换库存");
          const allowed =
            this.options.deployment === "online"
              ? ["online"]
              : ["rehearsal", "formal"];
          if (!allowed.includes(command.mode))
            throw new DomainError("此部署不支持该库存", 400);
          state.mode = command.mode;
          return;
        }
        if (command.type === "inventory" || command.type === "reset") {
          if (isActive(current))
            throw new DomainError("请先结束当前一局，再管理库存");
          if (pool.sessions.some((s) => s.agentId && !s.agentStopped))
            throw new DomainError("正在关闭语音连接，请稍后再试");
          if (
            command.mode !== state.mode ||
            command.expectedRevision !== (pool.revision ?? 0)
          )
            throw new DomainError("库存已变更，请刷新后重新核对");
          if (!command.reason.trim())
            throw new DomainError("请填写操作原因", 400);
          if (command.type === "inventory") {
            const plan = pool.batchPlan!;
            if (
              command.gifts.length !== pool.available.length ||
              command.gifts.some(
                (g) =>
                  !g.zh.trim() ||
                  !g.en.trim() ||
                  g.zh.length > 60 ||
                  g.en.length > 60,
              ) ||
              command.available.length !== pool.available.length ||
              command.available.some(
                (n) => !Number.isInteger(n) || n < 0 || n > 10000,
              ) ||
              command.batchPlan.length !== 4 ||
              command.batchPlan.some(
                (row) =>
                  row.length !== pool.available.length ||
                  row.some((n) => !Number.isInteger(n) || n < 0 || n > 10000),
              )
            )
              throw new DomainError("请核对礼品和库存数量", 400);
            if (
              JSON.stringify(command.batchPlan.slice(0, pool.openedBatch)) !==
              JSON.stringify(plan.slice(0, pool.openedBatch))
            )
              throw new DomainError("已开放批次请通过可发库存调整", 400);
            pool.stockAdjustments = command.available.map(
              (n, i) =>
                n +
                pool.allocated[i]! -
                plan
                  .slice(0, pool.openedBatch)
                  .reduce((sum, row) => sum + row[i]!, 0),
            );
            pool.available = [...command.available];
            pool.gifts = structuredClone(command.gifts);
            pool.batchPlan = structuredClone(command.batchPlan);
          } else {
            if (command.confirmation !== modeNames[state.mode])
              throw new DomainError("请输入当前库存环境名称确认重置", 400);
            pool.available = pool.available.map(
              (n, i) => n + pool.allocated[i]!,
            );
            pool.allocated = pool.allocated.map(() => 0);
            pool.sessions = [];
            pool.currentId = undefined;
          }
          pool.revision = (pool.revision ?? 0) + 1;
          return;
        }
        if (command.type === "batch") {
          if (isActive(current)) throw new DomainError("仅局间可开放批次");
          if (command.expectedBatch <= pool.openedBatch) return;
          if (
            command.expectedBatch !== pool.openedBatch + 1 ||
            command.expectedBatch > 4
          )
            throw new DomainError("请依次开放下一批");
          const batch = pool.batchPlan![pool.openedBatch]!;
          pool.available = pool.available.map((n, i) => n + batch[i]!);
          pool.openedBatch++;
          pool.revision = (pool.revision ?? 0) + 1;
          return;
        }
        if (command.type === "start") {
          if (pool.sessions.some((s) => s.requestId === command.requestId))
            return;
          if (current && !["completed", "cancelled"].includes(current.status))
            throw new DomainError("当前一局尚未结束");
          if (current) throw new DomainError("请先点击下一位");
          if (!state.display?.prepared || now - state.display.seenAt >= 6000)
            throw new DomainError("请先在电视页准备声音和麦克风");
          if (command.driver === "demo" && state.mode !== "rehearsal")
            throw new DomainError("本地演练只可使用彩排库存");
          if (command.driver === "agora" && !state.display.audioReady)
            throw new DomainError("真实通话需要电视页完成麦克风与声音准备");
          if (command.driver === "agora" && !this.options.agoraReady)
            throw new DomainError("Agora 配置尚未完成，真实通话不可用");
          if (!pool.available.some((n) => n > 0))
            throw new DomainError(
              pool.openedBatch < 4 ? "奖池为空，请开放下一批" : "礼品全部发完",
            );
          const id = randomUUID();
          const game = gameFor(
            command.gameId && command.gameId !== "random"
              ? command.gameId
              : gameDefinitions[this.random(gameDefinitions.length)]!.id,
          );
          pool.sessions.push({
            id,
            requestId: command.requestId,
            mode: state.mode,
            driver: command.driver,
            status: "connecting",
            language: command.language,
            createdAt: now,
            duration:
              command.driver === "demo"
                ? (this.options.demoSeconds ?? 120)
                : 120,
            gameId: game.id,
            opening: game[command.language],
            announcement: "pending",
            muted: false,
            failures: 0,
          });
          pool.currentId = id;
          return;
        }
        if (
          !("sessionId" in command) ||
          !current ||
          current.id !== command.sessionId
        )
          throw new DomainError("会话已变更，请刷新");
        if (command.type === "cancel") {
          this.cancel(pool, current, now, command.reason ?? "staff");
        }
        if (command.type === "next") {
          if (isActive(current)) throw new DomainError("请先结束当前一局");
          pool.currentId = undefined;
        }
        if ("displayId" in command && state.display?.id !== command.displayId)
          throw new DomainError("电视页连接已失效");
        if (
          command.type === "announced" &&
          current.result &&
          current.status === "announcing"
        ) {
          if ((command.kind ?? "gift") !== (current.announcementKind ?? "gift"))
            return;
          current.announcement = command.fallback ? "fallback" : "done";
          if (
            !command.fallback &&
            !current.exitRequested &&
            current.gameId &&
            current.announcementKind === "gift"
          ) {
            current.giftRevealedAt = now;
            current.status = "gifted";
            current.farewellAt = Math.min(current.deadline!, now + 20_000);
            if (now >= current.farewellAt) this.beginFarewell(current, now);
          } else {
            current.giftRevealedAt ??= now;
            current.status = "completed";
            current.endedAt = now;
          }
        }
        if (
          command.type === "leave" &&
          ["chatting", "gifted"].includes(current.status)
        ) {
          current.exitRequested = true;
          if (!current.result) this.settle(pool, current, now);
          else current.farewellAt = now;
        }
        if (
          command.type === "language" &&
          ["chatting", "gifted"].includes(current.status) &&
          (command.turn === undefined
            ? current.languageTurn === undefined
            : command.turn > (current.languageTurn ?? 0))
        ) {
          current.language = command.language;
          if (command.turn !== undefined) current.languageTurn = command.turn;
        }
        if (
          command.type === "violation" &&
          ["chatting", "gifted"].includes(current.status)
        ) {
          current.failures++;
          if (current.failures >= 2) this.cancel(pool, current, now, "safety");
        }
        if (command.type === "opening" && current.status === "connecting") {
          if (state.display?.id !== command.displayId)
            throw new DomainError("电视页连接已失效");
          current.status = "chatting";
          current.startedAt = now;
          current.deadline = now + current.duration * 1000;
        }
        if (command.type === "settle") {
          if (current.result) return;
          if (
            current.status !== "chatting" ||
            current.startedAt === undefined ||
            now < giftTime(current)!
          )
            throw new DomainError("尚未到时，不能结算");
          this.settle(pool, current, now);
        }
      },
      command.type +
        ("reason" in command && command.reason
          ? ` · ${command.reason}`
          : command.type === "checkpoint"
            ? ` · ${command.label}`
            : "") +
        ("sessionId" in command ? ` · #${command.sessionId.slice(0, 8)}` : "") +
        (command.type === "announced"
          ? ` · ${command.kind === "goodbye" ? "告别" : "送礼"}`
          : ""),
      command.type === "checkpoint",
    );
  }
  async checkpoints(before?: number) {
    const view = await this.snapshot();
    return this.store.checkpoints(view.mode, before);
  }
  async checkpoint(id: number) {
    const point = await this.store.checkpoint(id);
    if (!point) throw new DomainError("恢复点不存在", 404);
    return point;
  }
  async restoreCheckpoint(
    id: number,
    mode: Mode,
    expectedRevision: number,
    confirmation: string,
    reason: string,
  ) {
    const point = await this.checkpoint(id);
    if (point.mode !== mode)
      throw new DomainError("恢复点不属于当前库存环境", 400);
    if (confirmation !== modeNames[mode] || !reason.trim())
      throw new DomainError("请确认库存环境并填写恢复原因", 400);
    await this.transaction((state) => {
      const pool = state.pools[state.mode];
      const current = pool.sessions.find((s) => s.id === pool.currentId);
      if (isActive(current)) throw new DomainError("请先结束当前一局，再恢复");
      if (pool.sessions.some((s) => s.agentId && !s.agentStopped))
        throw new DomainError("正在关闭语音连接，请稍后再试");
      if (mode !== state.mode || expectedRevision !== (pool.revision ?? 0))
        throw new DomainError("库存已变更，请刷新后重新核对");
      const restored = structuredClone(point.store.pools[mode]);
      for (const session of restored.sessions) {
        const known = pool.sessions.find((s) => s.id === session.id)?.result;
        if (isActive(session) && !session.result && known) {
          const rank = known.rank - 1;
          if (!restored.available[rank])
            throw new DomainError("恢复点无法预留原礼品，请选择结算后的恢复点");
          restored.available[rank]!--;
          restored.allocated[rank]!++;
          session.result = structuredClone(known);
        }
        if (isActive(session))
          this.cancel(restored, session, this.now(), "disconnect");
        // A restored checkpoint never reconnects to historical cloud audio.
        session.agentStopped = true;
      }
      restored.revision = (pool.revision ?? 0) + 1;
      state.pools[mode] = restored;
    }, `restore #${id} · ${reason}`);
  }
  async backup() {
    return this.transaction((state) => ({
      exportedAt: this.now(),
      store: structuredClone(state),
    }));
  }
  async claimAgent(
    sessionId: string,
    displayId: string,
  ): Promise<Session | undefined> {
    return this.transaction((state) => {
      const session = state.pools[state.mode].sessions.find(
        (s) => s.id === state.pools[state.mode].currentId,
      );
      if (
        !session ||
        session.id !== sessionId ||
        state.display?.id !== displayId ||
        session.status !== "connecting" ||
        session.driver !== "agora"
      )
        throw new DomainError("会话已变更");
      if (session.agentOperation) return;
      session.agentOperation = this.now();
      return structuredClone(session);
    });
  }
  async attachAgent(sessionId: string, agentId: string): Promise<boolean> {
    return this.transaction((state) => {
      const session = Object.values(state.pools)
        .flatMap((pool) => pool.sessions)
        .find((s) => s.id === sessionId);
      if (!session) return false;
      session.agentId = agentId;
      return isActive(session);
    });
  }
  async claimAnnouncement(
    sessionId: string,
    displayId: string,
    kind: "gift" | "goodbye" = "gift",
  ): Promise<Session | undefined> {
    return this.transaction((state) => {
      const session = state.pools[state.mode].sessions.find(
        (s) => s.id === sessionId,
      );
      if (
        !session ||
        state.display?.id !== displayId ||
        session.status !== "announcing" ||
        !session.result ||
        !session.agentId
      )
        throw new DomainError("会话已变更");
      if ((session.announcementKind ?? "gift") !== kind)
        throw new DomainError("播报阶段已变更");
      if (session.announcement !== "pending") return;
      session.announcement = "playing";
      return structuredClone(session);
    });
  }
  async agentStopped(sessionId: string) {
    return this.transaction((state) => {
      const session = Object.values(state.pools)
        .flatMap((pool) => pool.sessions)
        .find((s) => s.id === sessionId);
      if (session) session.agentStopped = true;
    });
  }
  private cancel(pool: Pool, session: Session, now: number, reason: string) {
    if (session.status === "completed" || session.status === "cancelled")
      return;
    // Participation earns a gift even if the game or audio ends early.
    if (session.startedAt !== undefined && !session.result)
      this.settle(pool, session, now);
    session.status = session.result ? "completed" : "cancelled";
    if (session.result && !session.giftRevealedAt)
      session.announcement = "fallback";
    session.muted = true;
    session.reason = reason;
    session.endedAt = now;
  }
  private reconcile(state: Store) {
    const pool = state.pools[state.mode];
    const current = pool.sessions.find((s) => s.id === pool.currentId);
    if (!current || !isActive(current)) return;
    const now = this.now();
    const lostAt = state.display ? state.display.seenAt + 6000 : 0;
    if (
      !current.result &&
      now >= lostAt &&
      (!current.deadline || lostAt < current.deadline)
    ) {
      this.cancel(pool, current, now, "disconnect");
      return;
    }
    if (
      current.status === "chatting" &&
      current.deadline &&
      now >= (current.gameId ? giftTime(current)! : current.deadline)
    )
      this.settle(pool, current, now);
    if (current.status === "gifted" && now >= current.farewellAt!)
      this.beginFarewell(current, now);
    if (
      current.status === "announcing" &&
      current.result &&
      now - (current.announcementStartedAt ?? current.result.settledAt) > 30_000
    )
      this.cancel(pool, current, now, "playback");
    else if (!state.display || now - state.display.seenAt >= 6000)
      this.cancel(pool, current, now, "disconnect");
    else if (
      current.status === "connecting" &&
      now - current.createdAt >= 30_000
    )
      this.cancel(pool, current, now, "playback");
  }
  private giftsFor(state: Store) {
    return state.pools[state.mode].gifts!;
  }
  private beginFarewell(session: Session, now: number) {
    session.status = "announcing";
    session.announcementKind = "goodbye";
    session.announcement = "pending";
    session.announcementStartedAt = now;
    session.farewell =
      session.language === "zh"
        ? "好啦，我得招呼下一位了。谢谢来玩，礼品记得拿，回头见！"
        : "Thanks for stopping by! Don't forget to pick up your gift. See you around!";
  }
  private settle(pool: Pool, session: Session, now: number) {
    let ticket = this.random(pool.available.reduce((a, b) => a + b, 0));
    const rankIndex = pool.available.findIndex((n) => {
      ticket -= n;
      return ticket < 0;
    });
    if (rankIndex < 0) throw new DomainError("奖池为空");
    pool.available[rankIndex]!--;
    pool.allocated[rankIndex]!++;
    const gift = structuredClone(pool.gifts![rankIndex]!);
    pool.revision = (pool.revision ?? 0) + 1;
    session.result = {
      rank: rankIndex + 1,
      gift,
      settledAt: now,
      closing: closings[session.language][
        pool.sessions.length % closings[session.language].length
      ]!.replace("{gift}", gift[session.language]),
    };
    if (session.exitRequested)
      session.result.closing +=
        session.language === "zh"
          ? "谢谢来玩，回头见！"
          : " Thanks for playing. See you!";
    session.status = "announcing";
    session.announcementKind = "gift";
    session.announcementStartedAt = now;
  }
}
