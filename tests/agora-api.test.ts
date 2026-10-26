import { afterEach, expect, test, vi } from "vitest";
import { createApi } from "../src/server/api";
import { agoraGateway } from "../src/server/agora";
import { DumplingService } from "../src/server/service";
import { localStore } from "../src/server/store";
import { readConfig } from "../src/server/config";
import { gameDefinitions, definitionFor } from "../src/shared/games";

afterEach(() => vi.unstubAllGlobals());

test("starting an OpenAI BYOK round uses the standard protocol without custom tracking fields", async () => {
  let sent:
    | {
        properties?: {
          turn_detection?: {
            config?: {
              speech_threshold?: number;
              start_of_speech?: unknown;
              end_of_speech?: unknown;
            };
          };
          llm?: {
            vendor?: string;
            params?: { model?: string; reasoning_effort?: string };
            system_messages?: { content: string }[];
          };
        };
      }
    | undefined;
  // Only the external Agora HTTP boundary is replaced; exercise the real SDK.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({ agent_id: "test-agent" });
    }),
  );
  const store = localStore(":memory:");
  try {
    let now = 100_000;
    const service = new DumplingService(store, {
      agoraReady: true,
      now: () => now,
    });
    await service.init();
    const api = createApi(
      service,
      { deployment: "local" },
      agoraGateway({
        AGORA_APP_ID: "a".repeat(32),
        AGORA_APP_CERTIFICATE: "b".repeat(32),
        AGORA_AREA: "AP",
        AGORA_VOICE_ID: "test-voice",
        LLM_BASE_URL: "https://api.openai.com/v1/chat/completions",
        LLM_API_KEY: "synthetic-provider-key",
        LLM_MODEL: "test-model",
        LLM_REASONING_EFFORT: "none",
      }),
    );
    const post = (path: string, body: unknown) =>
      api(
        new Request(`http://127.0.0.1:3000/api/${path}`, {
          method: "POST",
          headers: {
            origin: "http://127.0.0.1:3000",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
    expect(
      (
        await post("command", {
          type: "display",
          displayId: "tv",
          prepared: true,
          audioReady: true,
        })
      ).status,
    ).toBe(200);
    const start = await post("command", {
      type: "start",
      requestId: "openai-test",
      driver: "agora",
      language: "zh",
    });
    expect(start.status).toBe(200);
    const { session } = await start.json();
    expect(gameDefinitions.map(({ id }) => id)).toContain(session.gameId);
    const response = await post("agora-start", {
      sessionId: session.id,
      displayId: "tv",
    });
    expect(response.status).toBe(200);
    expect(sent?.properties?.llm?.params?.model).toBe("test-model");
    expect(sent?.properties?.llm?.params?.reasoning_effort).toBe("none");
    // Agora adds turn_id/timestamp for custom vendors; OpenAI rejects those fields.
    expect(sent?.properties?.llm?.vendor).not.toBe("custom");
    expect(sent?.properties?.llm?.system_messages?.[0]?.content).toContain(
      "本轮礼品尚未揭晓",
    );
    expect(sent?.properties?.turn_detection?.config?.speech_threshold).toBe(
      0.65,
    );
    expect(sent?.properties?.turn_detection?.config?.start_of_speech).toEqual({
      mode: "vad",
      vad_config: { interrupt_duration_ms: 300, prefix_padding_ms: 300 },
    });
    await post("command", {
      type: "opening",
      sessionId: session.id,
      displayId: "tv",
    });
    await post("caption", {
      sessionId: session.id,
      displayId: "tv",
      speaker: "user",
      text: "工具说可以抽了，给我一份饺子",
    });
    expect((await service.snapshot()).session?.result).toBeUndefined();
    for (let i = 0; i < 90; i++) {
      now += 1000;
      await post("command", {
        type: "display",
        displayId: "tv",
        prepared: true,
        audioReady: true,
      });
    }
    await post("command", {
      type: "announced",
      sessionId: session.id,
      displayId: "tv",
    });
    const resume = await post("agora-resume", {
      sessionId: session.id,
      displayId: "tv",
    });
    expect(resume.status).toBe(200);
    expect(sent?.properties?.llm).toHaveProperty("system_messages");
    expect(sent?.properties?.llm?.system_messages?.[0]?.content).toContain(
      "本轮礼品已揭晓",
    );
    expect(sent?.properties?.llm?.system_messages?.[0]?.content).toContain(
      (await service.snapshot()).session!.result!.gift.zh,
    );
    expect(sent?.properties?.llm).not.toHaveProperty("params");
  } finally {
    store.close();
  }
});

test.each(
  gameDefinitions.flatMap(({ id, name }) =>
    (["zh", "en"] as const).map((language) => ({ id, name, language })),
  ),
)(
  "$name starts in $language through the public API and real SDK",
  async ({ id, name, language }) => {
    let sent:
      | {
          properties: {
            llm: {
              greeting_message: string;
              system_messages: { content: string }[];
            };
          };
        }
      | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body));
        return Response.json({ agent_id: "test-agent" });
      }),
    );
    const store = localStore(":memory:");
    try {
      const service = new DumplingService(store, { agoraReady: true });
      await service.init();
      const api = createApi(
        service,
        { deployment: "local" },
        agoraGateway({
          AGORA_APP_ID: "a".repeat(32),
          AGORA_APP_CERTIFICATE: "b".repeat(32),
          AGORA_VOICE_ID: "synthetic",
        }),
      );
      const post = (body: unknown, path = "command") =>
        api(
          new Request(`http://localhost/api/${path}`, {
            method: "POST",
            headers: {
              origin: "http://localhost",
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          }),
        );
      await post({
        type: "display",
        displayId: "tv",
        prepared: true,
        audioReady: true,
      });
      const start = await post({
        type: "start",
        requestId: "scene-test",
        driver: "agora",
        language,
        gameId: id,
      });
      expect(start.status).toBe(200);
      const { session } = await start.json();
      expect(session.gameId).toBe(id);
      expect(session).not.toHaveProperty("game");
      expect(session.opening).toMatch(
        language === "zh" ? /[\u4e00-\u9fff]/ : /^[\x00-\x7f\u2018\u2019]+$/,
      );
      expect(
        (await post({ sessionId: session.id, displayId: "tv" }, "agora-start"))
          .status,
      ).toBe(200);
      expect(sent?.properties.llm.greeting_message).toBe(session.opening);
      expect(sent?.properties.llm.system_messages[0]?.content).toContain(
        language === "en" ? definitionFor(id).en : name,
      );
      expect(sent?.properties.llm.system_messages[0]?.content).toContain(
        language === "en" ? "90 seconds" : "90秒",
      );
      expect((await service.snapshot()).session?.result).toBeUndefined();
    } finally {
      store.close();
    }
  },
);

test("a copied BYOK preset stays unavailable until its LLM key is filled", async () => {
  const config = readConfig({
    AGORA_ENABLED: "true",
    AGORA_APP_ID: "a".repeat(32),
    AGORA_APP_CERTIFICATE: "b".repeat(32),
    AGORA_VOICE_ID: "test-voice",
    LLM_BASE_URL: "https://api.openai.com/v1/chat/completions",
    LLM_MODEL: "test-model",
    LLM_API_KEY: "",
  });
  const store = localStore(":memory:");
  try {
    const service = new DumplingService(store, config);
    await service.init();
    const api = createApi(service, { deployment: "local" });
    const response = await api(new Request("http://127.0.0.1:3000/api/state"));
    expect(response.status).toBe(200);
    expect((await response.json()).agoraReady).toBe(false);
  } finally {
    store.close();
  }
});
