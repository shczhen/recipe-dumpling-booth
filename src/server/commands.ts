import { z } from "zod";
import { gameIds } from "../shared/games";
const id = z.string().min(1).max(100);
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("checkpoint"),
    label: z.string().trim().min(1).max(120),
  }),
  z.object({
    type: z.literal("inventory"),
    mode: z.enum(["rehearsal", "formal", "online"]),
    expectedRevision: z.number().int().nonnegative(),
    gifts: z
      .array(
        z.object({
          zh: z.string().trim().min(1).max(60),
          en: z.string().trim().min(1).max(60),
        }),
      )
      .length(7),
    available: z.array(z.number().int().min(0).max(10000)).length(7),
    batchPlan: z
      .array(z.array(z.number().int().min(0).max(10000)).length(7))
      .length(4),
    reason: z.string().trim().min(1).max(120),
  }),
  z.object({
    type: z.literal("reset"),
    mode: z.enum(["rehearsal", "formal", "online"]),
    expectedRevision: z.number().int().nonnegative(),
    confirmation: z.string().max(20),
    reason: z.string().trim().min(1).max(120),
  }),
  z.object({
    type: z.literal("mode"),
    mode: z.enum(["rehearsal", "formal", "online"]),
  }),
  z.object({
    type: z.literal("display"),
    displayId: id,
    prepared: z.boolean(),
    audioReady: z.boolean().optional(),
  }),
  z.object({ type: z.literal("release"), displayId: id }),
  z.object({
    type: z.literal("start"),
    requestId: id,
    driver: z.enum(["demo", "agora"]),
    gameId: z.enum(["random", ...gameIds]).optional(),
    language: z.enum(["zh", "en"]),
  }),
  z.object({ type: z.literal("opening"), sessionId: id, displayId: id }),
  z.object({ type: z.literal("settle"), sessionId: id }),
  z.object({ type: z.literal("leave"), sessionId: id, displayId: id }),
  z.object({
    type: z.literal("announced"),
    sessionId: id,
    displayId: id,
    fallback: z.boolean().optional(),
    kind: z.enum(["gift", "goodbye"]).optional(),
  }),
  z.object({
    type: z.literal("cancel"),
    sessionId: id,
    reason: z.enum(["staff", "disconnect", "safety", "playback"]).optional(),
  }),
  z.object({ type: z.literal("next"), sessionId: id }),
  z.object({
    type: z.literal("batch"),
    expectedBatch: z.number().int().min(1).max(4),
  }),
  z.object({
    type: z.literal("language"),
    sessionId: id,
    displayId: id,
    language: z.enum(["zh", "en"]),
    turn: z.number().int().positive().optional(),
  }),
  z.object({ type: z.literal("violation"), sessionId: id, displayId: id }),
]);
