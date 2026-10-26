import { useCallback, useEffect, useRef, useState } from "react";
import type { Command, Snapshot } from "../shared/model";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function apiCall<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(data.error ?? "请求失败", response.status);
  return data;
}
export function useDemoState(
  role: "admin" | "display",
  displayId?: string,
  prepared = false,
  audioReady = false,
) {
  const [view, setView] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const accept = useCallback((data: Snapshot) => {
    if (alive.current)
      setView((previous) =>
        !previous || data.serverNow >= previous.serverNow ? data : previous,
      );
  }, []);
  const fail = useCallback(
    (error: unknown) => {
      if (!alive.current) return;
      if (error instanceof ApiError && error.status === 401) {
        window.location.assign(`/login?role=${role}`);
        return;
      }
      setError(
        error instanceof ApiError
          ? error.message
          : "连接中断，正在重试。请检查服务。",
      );
    },
    [role],
  );
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    async function poll() {
      try {
        const data = displayId
          ? await apiCall<Snapshot>("command", {
              type: "display",
              displayId,
              prepared,
              audioReady,
            })
          : await apiCall<Snapshot>("state");
        if (!cancelled) {
          accept(data);
          setError("");
        }
      } catch (error) {
        if (!cancelled) fail(error);
      }
      if (!cancelled) timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => {
      alive.current = false;
      cancelled = true;
      clearTimeout(timer);
    };
  }, [displayId, prepared, audioReady, accept, fail]);
  const command = useCallback(
    async (command: Command) => {
      setBusy(true);
      setError("");
      try {
        const data = await apiCall<Snapshot>("command", command);
        accept(data);
        return data;
      } catch (error) {
        fail(error);
        return undefined;
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [accept, fail],
  );
  return { view, error, busy, command, setError, accept };
}
export function broadcast(message: unknown) {
  const bus = new BroadcastChannel("dumpling-display");
  bus.postMessage(message);
  bus.close();
}
export function useClock(serverNow?: number) {
  const offset = useRef(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (serverNow) {
      offset.current = serverNow - Date.now();
      setNow(serverNow);
    }
  }, [serverNow]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + offset.current), 200);
    return () => clearInterval(timer);
  }, []);
  return now;
}
export function secondsLeft(
  deadline: number | undefined,
  now: number,
  duration: number,
) {
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : duration;
}
export function timeLabel(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
