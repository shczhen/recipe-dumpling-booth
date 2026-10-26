import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { connectAgora, type VoiceCallbacks } from "../src/voice/agora-client";

// Replace only the public RTC/RTM/Toolkit and HTTP boundaries. The real adapter
// receives subscription events and controls the remote track, including replay.
const sdk = vi.hoisted(() => {
  const events = new Map<string, (...args: unknown[]) => unknown>();
  const toolkitEvents = new Map<string, (...args: unknown[]) => unknown>();
  const rtc = {
    on: (name: string, callback: (...args: unknown[]) => unknown) =>
      events.set(name, callback),
    subscribe: async () => {},
    join: async () => {},
    publish: async () => {},
    unpublish: async () => {},
    leave: async () => {},
    removeAllListeners: () => events.clear(),
  };
  const microphone = {
    on() {},
    stop() {},
    close() {},
    setEnabled: vi.fn(async () => {}),
    setMuted: vi.fn(async (_muted: boolean) => {}),
  };
  const createMicrophone = vi.fn(async (_options: unknown) => microphone);
  return { events, toolkitEvents, rtc, microphone, createMicrophone };
});
vi.mock("agora-rtc-sdk-ng", () => ({
  default: {
    setLogLevel() {},
    setParameter() {},
    createClient: () => sdk.rtc,
    createMicrophoneAudioTrack: sdk.createMicrophone,
  },
}));
vi.mock("agora-rtm-sdk", () => ({
  default: {
    RTM: class {
      async login() {}
      async subscribe() {}
      async unsubscribe() {}
      async logout() {}
    },
  },
}));
vi.mock("agora-agent-client-toolkit", () => ({
  AgoraVoiceAI: {
    init: async () => ({
      on: (name: string, callback: (...args: unknown[]) => unknown) =>
        sdk.toolkitEvents.set(name, callback),
      subscribeMessage() {},
      unsubscribe() {},
      destroy() {},
    }),
  },
  AgoraVoiceAIEvents: {
    AGENT_ERROR: "error",
    AGENT_SPEAKING_CHANGED: "speaking",
    TRANSCRIPT_UPDATED: "transcript",
  },
  TranscriptHelperMode: { TEXT: "TEXT" },
  TurnStatus: {
    END: "END",
    INTERRUPTED: "INTERRUPTED",
    IN_PROGRESS: "IN_PROGRESS",
  },
}));

let stop: (() => Promise<void>) | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        appId: "synthetic",
        channel: "test",
        token: "synthetic",
        uid: "1",
        agentUid: "2",
      }),
    ),
  );
});
afterEach(async () => {
  await stop?.();
  stop = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function remoteTrack() {
  let element = false;
  let volume = 100;
  let sink = "default";
  let decoded: (() => void) | undefined;
  const audible: string[] = [];
  const routes: { resolve(): void; reject(): void }[] = [];
  const track = {
    isPlaying: false,
    level: 0,
    on(_name: string, listener: () => void) {
      decoded = listener;
    },
    setVolume(next: number) {
      volume = next;
      if (element && volume > 0) audible.push(sink);
    },
    play() {
      element = true;
      track.isPlaying = true;
      if (volume > 0) audible.push(sink);
      decoded?.();
    },
    stop() {
      element = false;
      track.isPlaying = false;
      sink = "default";
    },
    getVolumeLevel: () => track.level,
    setPlaybackDevice(id: string) {
      // RTC 4.24.9 cannot await the actual sink until play creates its element.
      if (!element) {
        sink = id;
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) =>
        routes.push({
          resolve() {
            sink = id;
            resolve();
          },
          reject() {
            reject(new Error("synthetic output unavailable"));
          },
        }),
      );
    },
  };
  return { track, routes, audible };
}
async function connected(mode: "open" | "hold" = "open") {
  const callbacks: VoiceCallbacks = {
    opening: vi.fn(),
    caption: vi.fn(),
    utterance: vi.fn(),
    speaking: vi.fn(),
    announced: vi.fn(),
    fault: vi.fn(),
  };
  const voice = await connectAgora(
    "round",
    "tv",
    callbacks,
    new AbortController().signal,
    {
      inputId: "usb-mic",
      outputId: "hdmi-tv",
      mode,
    },
  );
  stop = voice.stop;
  const remote = remoteTrack();
  const publish = () =>
    Promise.resolve(
      sdk.events.get("user-published")?.(
        {
          uid: "2",
          audioTrack: remote.track,
        },
        "audio",
      ),
    );
  return { voice, callbacks, publish, ...remote };
}

test("opening and controlled closing wait for the selected output before becoming audible", async () => {
  vi.useFakeTimers();
  const { voice, callbacks, publish, routes, audible, track } =
    await connected();
  const opening = publish();
  await vi.waitFor(() => expect(routes).toHaveLength(1));
  expect(audible).toEqual([]);
  expect(callbacks.opening).not.toHaveBeenCalled();
  routes[0].resolve();
  await opening;
  expect(audible).toEqual(["hdmi-tv"]);
  expect(callbacks.opening).toHaveBeenCalledTimes(1);
  await voice.freeze();
  const closing = voice.close("保存的受控收尾");
  await vi.waitFor(() => expect(routes).toHaveLength(2));
  expect(audible).toEqual(["hdmi-tv"]);
  routes[1].resolve();
  await closing;
  expect(audible).toEqual(["hdmi-tv", "hdmi-tv"]);
  sdk.toolkitEvents.get("transcript")?.([
    {
      uid: "2",
      text: "保存的受控收尾",
      metadata: { turn_status: "END", start_ms: 0, duration_ms: 500 },
    },
  ]);
  sdk.toolkitEvents.get("speaking")?.("2", false);
  sdk.events.get("audio-pts")?.(500);
  track.level = 0.1;
  await vi.advanceTimersByTimeAsync(250);
  track.level = 0;
  await vi.advanceTimersByTimeAsync(2000);
  expect(callbacks.announced).toHaveBeenCalledTimes(1);
  // A delayed subscription after evidence completes must not restart the player.
  await publish();
  expect(routes).toHaveLength(2);
  expect(track.isPlaying).toBe(false);
  expect(callbacks.announced).toHaveBeenCalledWith("gift");
  const resume = voice.resume();
  await vi.waitFor(() => expect(routes).toHaveLength(3));
  expect(audible).toEqual(["hdmi-tv", "hdmi-tv"]);
  routes[2].resolve();
  await resume;
  expect(audible).toEqual(["hdmi-tv", "hdmi-tv", "hdmi-tv"]);
  const goodbye = voice.close("单独告别", "goodbye");
  await vi.waitFor(() => expect(routes).toHaveLength(4));
  routes[3].resolve();
  await goodbye;
  expect(audible).toEqual(["hdmi-tv", "hdmi-tv", "hdmi-tv", "hdmi-tv"]);
});

test("hold-to-talk keeps noise processing, starts muted and cannot reopen while frozen", async () => {
  const { voice } = await connected("hold");
  expect(sdk.createMicrophone).toHaveBeenCalledWith(
    expect.objectContaining({
      microphoneId: "usb-mic",
      AEC: true,
      ANS: true,
      AGC: false,
    }),
  );
  expect(sdk.microphone.setMuted).toHaveBeenLastCalledWith(true);
  await voice.setTalking(true);
  expect(sdk.microphone.setMuted).toHaveBeenLastCalledWith(false);
  await voice.setTalking(false);
  expect(sdk.microphone.setMuted).toHaveBeenLastCalledWith(true);
  await voice.freeze();
  sdk.microphone.setMuted.mockClear();
  await voice.setTalking(true);
  expect(sdk.microphone.setMuted).not.toHaveBeenCalled();
});

test("a gift interrupts an audible reply immediately without waiting for silence", async () => {
  vi.useFakeTimers();
  const { voice, publish, routes, track } = await connected();
  const opening = publish();
  await vi.waitFor(() => expect(routes).toHaveLength(1));
  routes[0].resolve();
  await opening;
  track.level = 0.1;
  sdk.toolkitEvents.get("speaking")?.("2", true);
  const closing = voice.close("先给你抽个奖。保存的礼品。", "gift");
  expect(track.isPlaying).toBe(false);
  await vi.waitFor(() =>
    expect(sdk.microphone.setEnabled).toHaveBeenLastCalledWith(false),
  );
  await vi.waitFor(() => expect(routes).toHaveLength(2));
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([path]) => String(path).includes("agora-close")),
  ).toBe(true);
  routes[1].resolve();
  await closing;
});

test("an unavailable selected output stays silent and reports a recoverable fault", async () => {
  const { callbacks, publish, routes, audible, track } = await connected();
  const opening = publish();
  await vi.waitFor(() => expect(routes).toHaveLength(1));
  routes[0].reject();
  await opening;
  expect(audible).toEqual([]);
  expect(track.isPlaying).toBe(false);
  expect(callbacks.opening).not.toHaveBeenCalled();
  expect(callbacks.fault).toHaveBeenCalledWith(
    "无法播放老板娘语音，请检查所选电视或输出设备",
  );
});

test("stopping while the microphone freezes cancels the pending announcement", async () => {
  vi.useFakeTimers();
  const { voice, publish, routes, track } = await connected();
  const opening = publish();
  await vi.waitFor(() => expect(routes).toHaveLength(1));
  routes[0].resolve();
  await opening;
  track.level = 0.1;
  sdk.toolkitEvents.get("speaking")?.("2", true);
  let release!: () => void;
  sdk.microphone.setEnabled.mockImplementationOnce(
    () => new Promise<void>((resolve) => (release = resolve)),
  );
  const closing = voice.close("保存的礼品");
  await vi.waitFor(() =>
    expect(sdk.microphone.setEnabled).toHaveBeenLastCalledWith(false),
  );
  const stopped = voice.stop();
  release();
  await stopped;
  await closing;
  await vi.advanceTimersByTimeAsync(7000);
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([path]) => String(path).includes("agora-close")),
  ).toBe(false);
  expect(track.isPlaying).toBe(false);
});

test("partial captions display immediately; only completed utterances reach the server once", async () => {
  vi.useFakeTimers();
  const { callbacks } = await connected();
  let finish!: () => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = () =>
          resolve(
            Response.json({
              text: "我想吃饺子",
              language: "zh",
              blocked: false,
            }),
          );
      }),
  );
  const transcript = sdk.toolkitEvents.get("transcript")!;
  const user = {
    uid: "1",
    stream_id: 1,
    turn_id: 1,
    text: "我想",
    metadata: { final: false },
  };
  transcript([user]);
  expect(callbacks.caption).toHaveBeenLastCalledWith(
    { text: "我想", language: "zh", blocked: false },
    "user",
    "1/1/1",
    false,
  );
  expect(fetch).toHaveBeenCalledTimes(2); // connection + start, no partial HTTP request
  transcript([{ ...user, text: "我想吃饺子", metadata: { final: true } }]);
  expect(callbacks.caption).toHaveBeenLastCalledWith(
    { text: "我想吃饺子", language: "zh", blocked: false },
    "user",
    "1/1/1",
    true,
  );
  expect(callbacks.utterance).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(3); // no 650 ms or HTTP wait for the displayed text
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(callbacks.utterance).toHaveBeenCalledTimes(1);
  transcript([{ ...user, text: "我想吃饺子", metadata: { final: true } }]);
  expect(callbacks.caption).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledTimes(3);
});

test("agent text streams before the turn ends and partial captions retain content filtering", async () => {
  const { callbacks } = await connected();
  const transcript = sdk.toolkitEvents.get("transcript")!;
  const agent = {
    uid: "2",
    stream_id: 2,
    turn_id: 1,
    text: "来啦",
    metadata: { turn_status: "IN_PROGRESS" },
  };
  transcript([agent]);
  transcript([{ ...agent, text: "来啦，里面坐！" }]);
  expect(callbacks.caption).toHaveBeenCalledTimes(2);
  expect(callbacks.caption).toHaveBeenLastCalledWith(
    { text: "来啦，里面坐！", language: "zh", blocked: false },
    "agent",
    "2/2/1",
    false,
  );
  transcript([
    {
      uid: "1",
      stream_id: 1,
      turn_id: 2,
      text: "fuck",
      metadata: { final: false },
    },
  ]);
  expect(callbacks.caption).toHaveBeenLastCalledWith(
    expect.objectContaining({
      blocked: true,
      text: "Let’s keep our chat friendly. Tell me about your day.",
    }),
    "user",
    "1/1/2",
    false,
  );
  expect(callbacks.utterance).not.toHaveBeenCalled();
});

test("a late completed-caption response cannot update a stopped round", async () => {
  vi.useFakeTimers();
  const { voice, callbacks } = await connected();
  let finish!: () => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = () =>
          resolve(
            Response.json({ text: "bye", language: "en", blocked: false }),
          );
      }),
  );
  sdk.toolkitEvents.get("transcript")?.([
    {
      uid: "1",
      stream_id: 1,
      turn_id: 1,
      text: "bye",
      metadata: { final: true },
    },
  ]);
  expect(callbacks.caption).toHaveBeenCalledTimes(1);
  await voice.stop();
  finish();
  await vi.advanceTimersByTimeAsync(1000);
  expect(callbacks.utterance).not.toHaveBeenCalled();
  expect(callbacks.caption).toHaveBeenCalledTimes(1);
});

test("old text and pending final actions cannot reappear after a gift and resume", async () => {
  vi.useFakeTimers();
  const { voice, callbacks } = await connected();
  let finish!: () => void;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = () =>
          resolve(
            Response.json({ text: "bye", language: "en", blocked: false }),
          );
      }),
  );
  const transcript = sdk.toolkitEvents.get("transcript")!;
  const user = {
    uid: "1",
    stream_id: 1,
    turn_id: 1,
    text: "bye",
    metadata: { final: true },
  };
  const agent = {
    uid: "2",
    stream_id: 2,
    turn_id: 1,
    text: "这句话将被打断",
    metadata: { turn_status: "IN_PROGRESS" },
  };
  transcript([user, agent]);
  expect(callbacks.caption).toHaveBeenCalledTimes(2);
  await voice.close("保存的礼品");
  await voice.resume();
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(5);
  expect(callbacks.utterance).not.toHaveBeenCalled();
  transcript([user, { ...agent, text: "迟到的旧话" }]);
  expect(callbacks.caption).toHaveBeenCalledTimes(2);
  transcript([{ ...agent, turn_id: 2, text: "咱们接着聊" }]);
  expect(callbacks.caption).toHaveBeenCalledTimes(3);
  expect(callbacks.caption).toHaveBeenLastCalledWith(
    expect.objectContaining({ text: "咱们接着聊" }),
    "agent",
    "2/2/2",
    false,
  );
});

test("a late route after stop cannot restart or unmute audio", async () => {
  const { voice, callbacks, publish, routes, audible, track } =
    await connected();
  const opening = publish();
  await vi.waitFor(() => expect(routes).toHaveLength(1));
  await voice.stop();
  routes[0].resolve();
  await opening;
  expect(audible).toEqual([]);
  expect(track.isPlaying).toBe(false);
  expect(callbacks.opening).not.toHaveBeenCalled();
});

test("a stale opening route failure cannot stop a newer controlled closing", async () => {
  const { voice, callbacks, publish, routes, audible, track } =
    await connected();
  const opening = publish();
  await vi.waitFor(() => expect(routes).toHaveLength(1));
  await voice.freeze();
  const closing = voice.close("保存的受控收尾");
  await vi.waitFor(() => expect(routes).toHaveLength(2));
  routes[1].resolve();
  await closing;
  routes[0].reject();
  await opening;
  expect(audible).toEqual(["hdmi-tv"]);
  expect(track.isPlaying).toBe(true);
  expect(callbacks.fault).not.toHaveBeenCalled();
  expect(callbacks.opening).not.toHaveBeenCalled();
});

test("out-of-order completed replies retain user turn order without losing older safety events", async () => {
  vi.useFakeTimers();
  const { callbacks } = await connected();
  const received: {
    language: string;
    blocked: boolean;
    turn: number | undefined;
  }[] = [];
  callbacks.utterance = (caption, _speaker, turn) => {
    received.push({
      language: caption.language,
      blocked: caption.blocked,
      turn,
    });
  };
  let old!: (response: Response) => void;
  let latest!: (response: Response) => void;
  vi.mocked(fetch)
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          old = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          latest = resolve;
        }),
    );
  const transcript = sdk.toolkitEvents.get("transcript")!;
  transcript([
    {
      uid: "1",
      stream_id: 1,
      turn_id: 1,
      text: "妈的",
      metadata: { final: true },
    },
  ]);
  transcript([
    {
      uid: "1",
      stream_id: 1,
      turn_id: 2,
      text: "Let’s speak English",
      metadata: { final: true },
    },
  ]);
  latest(
    Response.json({
      text: "Let’s speak English",
      language: "en",
      blocked: false,
    }),
  );
  await vi.advanceTimersByTimeAsync(0);
  old(Response.json({ text: "咱们聊点轻松的", language: "zh", blocked: true }));
  await vi.advanceTimersByTimeAsync(0);
  expect(received).toEqual([
    { language: "en", blocked: false, turn: 2 },
    { language: "zh", blocked: true, turn: 1 },
  ]);
});
