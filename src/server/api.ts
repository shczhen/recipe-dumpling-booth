import { z } from "zod";
import { access, type AccessConfig } from "./auth";
import { commandSchema } from "./commands";
import { DomainError, type DumplingService } from "./service";
import { isActive, type Session, type Snapshot } from "../shared/model";
import { safeCaption } from "../shared/captions";
import type { AgoraGateway } from "./agora";
import { wantsToLeave } from "./conversation";
const binding = z.object({
  sessionId: z.string().min(1).max(100),
  displayId: z.string().min(1).max(100),
});
function publicView(view: Snapshot, staff: boolean) {
  const clean = (session: Session) => {
    const { agentId: _id, agentOperation: _op, ...rest } = session;
    return rest;
  };
  return {
    ...view,
    pool: {
      ...view.pool,
      sessions: staff ? view.pool.sessions.slice(-100).map(clean) : [],
    },
    session: view.session ? clean(view.session) : undefined,
  };
}
export function createApi(
  service: DumplingService,
  config: AccessConfig,
  gateway?: AgoraGateway,
) {
  const auth = access(config);
  const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
    Response.json(body, {
      status,
      headers: { "Cache-Control": "no-store", ...headers },
    });
  const readJson = async (request: Request) => {
    const text = await request.text();
    if (text.length > 8000) throw new DomainError("请求过长", 413);
    try {
      return JSON.parse(text);
    } catch {
      throw new DomainError("请求格式错误", 400);
    }
  };
  async function stopEnded(view: Snapshot) {
    if (!gateway) return;
    for (const session of view.pool.sessions.filter(
      (s) => s.agentId && !s.agentStopped && !isActive(s),
    )) {
      try {
        await gateway.stop(session.agentId!);
        await service.agentStopped(session.id);
      } catch {
        /* Retry on the next staff/display poll; local audio remains stopped. */
      }
    }
  }
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const path = url.pathname.slice("/api/".length);
      if (
        request.method === "POST" &&
        (request.headers.get("origin") !== new URL(request.url).origin ||
          !request.headers.get("content-type")?.startsWith("application/json"))
      )
        return json({ error: "请求来源不受信任" }, 403);
      if (path === "login" && request.method === "POST") {
        const input = z
          .object({
            role: z.enum(["admin", "display"]),
            passcode: z.string().max(200),
          })
          .parse(await readJson(request));
        const cookie = auth.login(
          input.role,
          input.passcode,
          new URL(request.url).protocol === "https:",
        );
        return cookie
          ? json({ ok: true }, 200, { "Set-Cookie": cookie })
          : json({ error: "口令不正确" }, 401);
      }
      const role = auth.role(request);
      if (!role) return json({ error: "请输入访问口令" }, 401);
      if (path === "state" && request.method === "GET") {
        const view = await service.snapshot();
        await stopEnded(view);
        return json({
          ...publicView(view, role === "admin"),
          canManage: role === "admin",
        });
      }
      if (path === "logs" && request.method === "GET") {
        if (role !== "admin") return json({ error: "需要管理权限" }, 403);
        const entries = [];
        let before: number | undefined;
        for (;;) {
          const page = await service.checkpoints(before);
          entries.push(...page);
          if (page.length < 50) break;
          before = page.at(-1)!.id;
        }
        return json({ exportedAt: Date.now(), entries }, 200, {
          "Content-Disposition":
            'attachment; filename="dumpling-operation-log.json"',
        });
      }
      if (path === "checkpoints" && request.method === "GET") {
        if (role !== "admin") return json({ error: "需要管理权限" }, 403);
        const before = url.searchParams.has("before")
          ? z.coerce
              .number()
              .int()
              .positive()
              .parse(url.searchParams.get("before"))
          : undefined;
        return json({ checkpoints: await service.checkpoints(before) });
      }
      if (path === "checkpoint" && request.method === "GET") {
        if (role !== "admin") return json({ error: "需要管理权限" }, 403);
        const id = z.coerce
          .number()
          .int()
          .positive()
          .parse(url.searchParams.get("id"));
        return json(await service.checkpoint(id), 200, {
          "Content-Disposition": `attachment; filename="dumpling-checkpoint-${id}.json"`,
        });
      }
      if (path === "backup" && request.method === "GET") {
        if (role !== "admin") return json({ error: "需要管理权限" }, 403);
        return json(await service.backup(), 200, {
          "Content-Disposition": 'attachment; filename="dumpling-backup.json"',
        });
      }
      if (request.method !== "POST") return json({ error: "未找到接口" }, 404);
      const input = await readJson(request);
      if (path === "restore") {
        if (role !== "admin") return json({ error: "需要管理权限" }, 403);
        const data = z
          .object({
            id: z.number().int().positive(),
            mode: z.enum(["rehearsal", "formal", "online"]),
            expectedRevision: z.number().int().nonnegative(),
            confirmation: z.string().max(20),
            reason: z.string().trim().min(1).max(120),
          })
          .parse(input);
        await stopEnded(await service.snapshot());
        await service.restoreCheckpoint(
          data.id,
          data.mode,
          data.expectedRevision,
          data.confirmation,
          data.reason,
        );
        return json({ ok: true });
      }
      if (path === "command") {
        const command = commandSchema.parse(input);
        if (
          role !== "admin" &&
          [
            "start",
            "mode",
            "batch",
            "next",
            "inventory",
            "reset",
            "checkpoint",
          ].includes(command.type)
        )
          return json({ error: "需要管理权限" }, 403);
        if (["reset", "inventory"].includes(command.type))
          await stopEnded(await service.snapshot());
        await service.dispatch(command);
        const view = await service.snapshot();
        await stopEnded(view);
        return json({
          ...publicView(view, role === "admin"),
          canManage: role === "admin",
        });
      }
      if (
        [
          "caption",
          "agora-connection",
          "agora-start",
          "agora-close",
          "agora-resume",
        ].includes(path)
      ) {
        const bind = binding.parse(input);
        const view = await service.snapshot();
        const session = view.session;
        if (
          !session ||
          session.id !== bind.sessionId ||
          view.display?.id !== bind.displayId ||
          !isActive(session)
        )
          throw new DomainError("会话已变更");
        if (path === "caption") {
          if (!["chatting", "gifted"].includes(session.status))
            return json({
              text: "",
              blocked: false,
              language: session.language,
            });
          const { text, speaker } = z
            .object({
              text: z.string().max(4000),
              speaker: z.enum(["user", "agent"]).default("user"),
            })
            .parse(input);
          const safe = safeCaption(text);
          if (!safe.blocked && speaker === "user" && wantsToLeave(text))
            await service.dispatch({
              type: "leave",
              sessionId: session.id,
              displayId: bind.displayId,
            });
          return json(safe);
        }
        if (!gateway || session.driver !== "agora" || !view.agoraReady)
          throw new DomainError("Agora 尚未配置", 503);
        if (path === "agora-connection")
          return json(gateway.connection(session));
        if (path === "agora-resume") {
          if (session.status !== "gifted")
            throw new DomainError("尚未揭晓礼品");
          await gateway.resume(session);
          return json({ ok: true });
        }
        if (path === "agora-start") {
          const claimed = await service.claimAgent(session.id, bind.displayId);
          if (claimed) {
            try {
              const agentId = await gateway.start(claimed);
              if (!(await service.attachAgent(claimed.id, agentId)))
                await gateway.stop(agentId);
            } catch {
              await service.dispatch({
                type: "cancel",
                sessionId: session.id,
                reason: "disconnect",
              });
              throw new DomainError("Agora 启动失败，请检查会前配置", 502);
            }
          }
          return json({ ok: true });
        }
        if (path === "agora-close") {
          const claimed = await service.claimAnnouncement(
            session.id,
            bind.displayId,
            z
              .object({ kind: z.enum(["gift", "goodbye"]).default("gift") })
              .parse(input).kind,
          );
          if (claimed) {
            try {
              await gateway.close(claimed);
            } catch {
              await service.dispatch({
                type: "announced",
                sessionId: session.id,
                displayId: bind.displayId,
                fallback: true,
                kind: claimed.announcementKind,
              });
              throw new DomainError("播报失败，已保留同一礼品结果", 502);
            }
          }
          return json({ ok: true });
        }
      }
      return json({ error: "未找到接口" }, 404);
    } catch (error) {
      if (error instanceof DomainError)
        return json({ error: error.message }, error.status);
      if (error instanceof z.ZodError)
        return json({ error: "请求参数错误" }, 400);
      // No provider errors, tokens or raw dialogue are written to logs or returned.
      return json({ error: "服务暂不可用，请检查本地数据目录或服务配置" }, 500);
    }
  };
}
