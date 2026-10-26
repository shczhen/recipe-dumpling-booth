import type { GameId, GameSelection } from "./games";
export type Mode = "rehearsal" | "formal" | "online";
export type Driver = "demo" | "agora";
export type Language = "zh" | "en";
export type Status =
  | "connecting"
  | "chatting"
  | "announcing"
  | "gifted"
  | "completed"
  | "cancelled";
export const batches = catalog.batches;
export const modeNames: Record<Mode, string> = {
  rehearsal: "彩排",
  formal: "正式",
  online: "线上测试",
};
export const statusNames: Record<Status, string> = {
  connecting: "等待开场",
  chatting: "交谈中",
  announcing: "正在送礼",
  gifted: "礼品已揭晓 · 继续聊",
  completed: "已完成",
  cancelled: "已取消",
};
export interface Gift {
  zh: string;
  en: string;
}
export const defaultGifts: Gift[] = catalog.gifts;
export interface Session {
  id: string;
  requestId: string;
  mode: Mode;
  driver: Driver;
  status: Status;
  language: Language;
  languageTurn?: number;
  createdAt: number;
  startedAt?: number;
  deadline?: number;
  endedAt?: number;
  duration: number;
  opening: string;
  gameId?: GameId;
  giftRevealedAt?: number;
  farewellAt?: number;
  announcementKind?: "gift" | "goodbye";
  announcementStartedAt?: number;
  farewell?: string;
  exitRequested?: boolean;
  result?: { rank: number; gift: Gift; settledAt: number; closing: string };
  announcement: "pending" | "playing" | "done" | "fallback";
  muted: boolean;
  reason?: string;
  agentId?: string;
  agentOperation?: number;
  agentStopped?: boolean;
  failures: number;
}
export interface Pool {
  revision?: number;
  gifts?: Gift[];
  batchPlan?: number[][];
  stockAdjustments?: number[];
  currentId?: string;
  available: number[];
  allocated: number[];
  openedBatch: number;
  sessions: Session[];
}
export interface DisplayLease {
  id: string;
  seenAt: number;
  prepared: boolean;
  audioReady?: boolean;
}
export interface Store {
  version: 1;
  mode: Mode;
  pools: Record<Mode, Pool>;
  display?: DisplayLease;
}
export interface Snapshot {
  batchSchedule?: number[][];
  canManage?: boolean;
  recoveryWarning?: string;
  mode: Mode;
  pool: Pool;
  session?: Session;
  display?: DisplayLease;
  serverNow: number;
  gifts: Gift[];
  modes: Mode[];
  agoraReady: boolean;
  demoSeconds: number;
  deployment: "local" | "online";
}
export interface Checkpoint {
  id: number;
  createdAt: number;
  action: string;
  mode: Mode;
}
export type Command =
  | { type: "checkpoint"; label: string }
  | {
      type: "inventory";
      mode: Mode;
      expectedRevision: number;
      gifts: Gift[];
      available: number[];
      batchPlan: number[][];
      reason: string;
    }
  | {
      type: "reset";
      mode: Mode;
      expectedRevision: number;
      confirmation: string;
      reason: string;
    }
  | { type: "mode"; mode: Mode }
  | {
      type: "display";
      displayId: string;
      prepared: boolean;
      audioReady?: boolean;
    }
  | { type: "release"; displayId: string }
  | {
      type: "start";
      requestId: string;
      driver: Driver;
      language: Language;
      gameId?: GameSelection;
    }
  | { type: "opening"; sessionId: string; displayId: string }
  | { type: "settle"; sessionId: string }
  | { type: "leave"; sessionId: string; displayId: string }
  | {
      type: "announced";
      sessionId: string;
      displayId: string;
      fallback?: boolean;
      kind?: "gift" | "goodbye";
    }
  | {
      type: "cancel";
      sessionId: string;
      reason?: "staff" | "disconnect" | "safety" | "playback";
    }
  | { type: "next"; sessionId: string }
  | { type: "batch"; expectedBatch: number }
  | {
      type: "language";
      sessionId: string;
      displayId: string;
      language: Language;
      turn?: number;
    }
  | { type: "violation"; sessionId: string; displayId: string };
export const isActive = (s?: Session) =>
  !!s && ["connecting", "chatting", "announcing", "gifted"].includes(s.status);
export const giftTime = (session: Session) =>
  session.startedAt === undefined
    ? undefined
    : session.startedAt + session.duration * 750;
export const availableCount = (pool: Pool) =>
  pool.available.reduce((a, b) => a + b, 0);
import catalog from "../../scripts/catalog.json";
export { catalog };
export const announcementText = (session: Session) =>
  session.announcementKind === "goodbye"
    ? session.farewell
    : session.result?.closing;
