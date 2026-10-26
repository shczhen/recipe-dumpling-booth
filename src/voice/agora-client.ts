import type { IRemoteAudioTrack } from "agora-rtc-sdk-ng";
import type { RTMClient } from "agora-rtm-sdk";
import type { RTCEngine } from "agora-agent-client-toolkit";
import { apiCall } from "../lib/client";
import { safeCaption, type SafeCaption } from "../shared/captions";
import type { AudioSelection } from "./devices";
export interface VoiceCallbacks {
  opening(): void;
  caption(
    caption: SafeCaption,
    speaker: "user" | "agent",
    turnId?: string,
    complete?: boolean,
  ): void;
  /** Complete utterances only: language, moderation and other server actions. */
  utterance?(
    caption: SafeCaption,
    speaker: "user" | "agent",
    userTurn?: number,
  ): void;
  speaking(value: boolean): void;
  announced(kind: "gift" | "goodbye"): void;
  announcing?(text: string): void;
  fault(message: string): void;
}
interface Connection {
  appId: string;
  channel: string;
  token: string;
  uid: string;
  agentUid: string;
}
// RTM 2.3 rejects a second instance for the same app/user even after logout.
// Keep the page's identity, but clear its channel, listeners and login each round.
const messagingClients = new Map<string, RTMClient>();
let activeStop: (() => Promise<void>) | undefined;
/** Only imported in the browser once a real Agora round starts. */
export async function connectAgora(
  sessionId: string,
  displayId: string,
  callbacks: VoiceCallbacks,
  signal: AbortSignal,
  devices: AudioSelection & { mode?: "open" | "hold" } = {
    inputId: "",
    outputId: "",
  },
) {
  const [rtcModule, rtmModule, toolkitModule] = await Promise.all([
    import("agora-rtc-sdk-ng"),
    import("agora-rtm-sdk"),
    import("agora-agent-client-toolkit"),
  ]);
  signal.throwIfAborted();
  const config = await apiCall<Connection>("agora-connection", {
    sessionId,
    displayId,
  });
  signal.throwIfAborted();
  await activeStop?.();
  signal.throwIfAborted();
  const AgoraRTC = rtcModule.default;
  AgoraRTC.setLogLevel(4);
  // RTC 4.24.9 names this flag ENABLE_AUDIO_PTS (older Toolkit docs say
  // ENABLE_AUDIO_PTS_METADATA). It is omitted from RTC's declarations.
  (
    AgoraRTC as typeof AgoraRTC & {
      setParameter(name: "ENABLE_AUDIO_PTS", enabled: boolean): void;
    }
  ).setParameter("ENABLE_AUDIO_PTS", true);
  const rtc = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
  const identity = `${config.appId}/${config.uid}`;
  const rtm =
    messagingClients.get(identity) ??
    new rtmModule.default.RTM(config.appId, config.uid, { logLevel: "none" });
  messagingClients.set(identity, rtm);
  const { AgoraVoiceAI, AgoraVoiceAIEvents, TranscriptHelperMode, TurnStatus } =
    toolkitModule;
  let toolkit: Awaited<ReturnType<typeof AgoraVoiceAI.init>> | undefined;
  let microphone:
    Awaited<ReturnType<typeof AgoraRTC.createMicrophoneAudioTrack>> | undefined;
  let stopped = false;
  let toolkitCleaned = false;
  let closing = false;
  let opened = false;
  let frozen = false;
  let closingPlayback = false;
  let freezePromise: Promise<void> | undefined;
  let playbackTimer: ReturnType<typeof setInterval> | undefined;
  let talking = false;
  let transition = 0;
  let microphoneQueue: Promise<unknown> = Promise.resolve();
  const withMicrophone = (work: () => Promise<void>) => {
    const operation = microphoneQueue
      .catch(() => {})
      .then(async () => {
        if (!stopped) await work();
      });
    microphoneQueue = operation;
    return trackOperation(operation);
  };
  let closingEvidence:
    | {
        text: string;
        complete: boolean;
        endPts?: number;
        playedPts?: number;
        heardAudio: boolean;
        silentAt?: number;
        silentSamples: number;
        checkedAt: number;
        speaking?: boolean;
        kind: "gift" | "goodbye";
      }
    | undefined;
  const normalizeClosing = (text: string) =>
    text
      .normalize("NFKC")
      .replace(/[\p{P}\p{Z}\s]/gu, "")
      .toLowerCase();
  const tracks = new Set<IRemoteAudioTrack>();
  const generations = new Map<IRemoteAudioTrack, number>();
  const routed = new Set<IRemoteAudioTrack>();
  const decoded = new Set<IRemoteAudioTrack>();
  const stopTrack = (track: IRemoteAudioTrack) => {
    generations.set(track, (generations.get(track) ?? 0) + 1);
    routed.delete(track);
    track.stop();
  };
  const announceOpening = (track: IRemoteAudioTrack) => {
    if (
      !opened &&
      !stopped &&
      !frozen &&
      routed.has(track) &&
      decoded.has(track)
    ) {
      opened = true;
      callbacks.opening();
    }
  };
  const playTrack = async (track: IRemoteAudioTrack) => {
    const generation = (generations.get(track) ?? 0) + 1;
    generations.set(track, generation);
    routed.delete(track);
    const current = () => !stopped && generations.get(track) === generation;
    try {
      // RTC creates its audio element in play(), and deletes its cached sink on
      // stop(). Initialize muted and await routing on every playback/replay.
      track.setVolume(0);
      track.play();
      if (devices.outputId) await track.setPlaybackDevice(devices.outputId);
      if (!current()) return;
      track.setVolume(100);
      routed.add(track);
      announceOpening(track);
    } catch (error) {
      if (!current()) return; // A late result cannot affect a newer playback.
      stopTrack(track);
      throw error;
    }
  };
  const seen = new Set<string>();
  let latestUserTurn = 0;
  const scenes = new Map<
    string,
    {
      text?: string;
      complete?: boolean;
    }
  >();
  let inFlight: Promise<unknown> = Promise.resolve();
  let stopping: Promise<void> | undefined;
  const trackOperation = <T>(operation: Promise<T>) => {
    inFlight = operation;
    return operation;
  };
  const stop = () => {
    stopped = true;
    closingPlayback = false;
    microphone?.stop();
    microphone?.close();
    for (const track of tracks) stopTrack(track);
    clearInterval(playbackTimer);
    playbackTimer = undefined;
    return (stopping ??= (async () => {
      // Leave immediately to interrupt a pending RTC join. Wait for late SDK
      // resources before final cleanup; the next round waits for this promise.
      const leaving = rtc.leave().catch(() => {});
      await inFlight.catch(() => {});
      microphone?.stop();
      microphone?.close();
      if (toolkit && !toolkitCleaned) {
        toolkit.unsubscribe();
        toolkit.destroy();
        toolkitCleaned = true;
      }
      rtc.removeAllListeners();
      await rtm.unsubscribe(config.channel).catch(() => {});
      await rtm.logout().catch(() => {});
      await leaving;
      if (activeStop === stop) activeStop = undefined;
    })());
  };
  activeStop = stop;
  signal.addEventListener(
    "abort",
    () => {
      void stop();
    },
    { once: true },
  );
  try {
    signal.throwIfAborted();
    const mediaClock: RTCEngine = rtc;
    mediaClock.on("audio-pts", (pts) => {
      if (stopped || !routed.size || !Number.isFinite(pts) || pts <= 0) return;
      if (!closingEvidence) return;
      // PTS advances with received media, unlike wall time during an RTC stall.
      closingEvidence.playedPts = Math.max(closingEvidence.playedPts ?? 0, pts);
    });
    AgoraRTC.onAudioAutoplayFailed = () => {
      if (!stopped)
        callbacks.fault("声音播放被浏览器阻止，请急停并重新准备声音");
    };
    rtc.on("connection-state-change", (state) => {
      if (state === "DISCONNECTED" && !stopped)
        callbacks.fault("Agora 连接中断");
    });
    rtc.on("user-published", async (user, type) => {
      if (String(user.uid) !== config.agentUid || type !== "audio" || stopped)
        return;
      try {
        await rtc.subscribe(user, "audio");
        if (stopped || !user.audioTrack) return;
        const track = user.audioTrack;
        tracks.add(track);
        track.on("first-frame-decoded", () => {
          decoded.add(track);
          announceOpening(track);
        });
        if (!frozen || closingPlayback) await playTrack(track);
      } catch {
        if (!stopped)
          callbacks.fault("无法播放老板娘语音，请检查所选电视或输出设备");
      }
    });
    toolkit = await trackOperation(
      AgoraVoiceAI.init({
        rtcEngine: rtc,
        rtmEngine: rtm,
        renderMode: TranscriptHelperMode.TEXT,
        enableLog: false,
        enableAgoraMetrics: false,
      }),
    );
    signal.throwIfAborted();
    toolkit.on(AgoraVoiceAIEvents.AGENT_ERROR, (uid, error) => {
      if (String(uid) !== config.agentUid || stopped) return;
      const module = ["asr", "llm", "mllm", "tts"].includes(error.type)
        ? error.type.toUpperCase()
        : "Agora";
      const code = Number.isFinite(error.code) ? `，代码 ${error.code}` : "";
      // Provider messages can contain request details; expose only module and code.
      callbacks.fault(`${module} 语音服务异常${code}，请工作人员检查配置。`);
    });
    toolkit.on(AgoraVoiceAIEvents.AGENT_SPEAKING_CHANGED, (uid, value) => {
      if (String(uid) !== config.agentUid || stopped) return;
      if (closingEvidence) closingEvidence.speaking = value;
      callbacks.speaking(value);
    });
    toolkit.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (items) => {
      if (stopped) return;
      for (const item of items) {
        const key = `${item.uid}/${item.stream_id}/${item.turn_id}`;
        if (!scenes.has(key)) scenes.set(key, {});
        if (scenes.size > 128) scenes.delete(scenes.keys().next().value!);
        // TEXT mode marks every update END, including unfinished ASR/LLM text.
        // The provider's metadata is the authority for utterance completion.
        const metadata = item.metadata;
        const isAgent = String(item.uid) === config.agentUid;
        if (closing) {
          // History emitted again after resume must not revive interrupted text.
          seen.add(key);
          if (
            closingEvidence &&
            isAgent &&
            metadata &&
            "turn_status" in metadata &&
            metadata.turn_status === TurnStatus.END &&
            normalizeClosing(item.text) === closingEvidence.text &&
            typeof metadata.duration_ms === "number" &&
            Number.isFinite(metadata.duration_ms) &&
            metadata.duration_ms > 0 &&
            typeof metadata.start_ms === "number" &&
            Number.isFinite(metadata.start_ms) &&
            metadata.start_ms >= 0
          ) {
            closingEvidence.complete = true;
            closingEvidence.endPts = metadata.start_ms + metadata.duration_ms;
          }
          continue;
        }
        const complete = isAgent
          ? metadata &&
            "turn_status" in metadata &&
            [TurnStatus.END, TurnStatus.INTERRUPTED].includes(
              metadata.turn_status ?? TurnStatus.IN_PROGRESS,
            )
          : metadata && "final" in metadata && metadata.final === true;
        if (seen.has(key)) continue;
        const scene = scenes.get(key)!;
        const caption = safeCaption(item.text);
        if (scene.text !== caption.text || scene.complete !== !!complete) {
          scene.text = caption.text;
          scene.complete = !!complete;
          // Render incremental text locally, without a debounce or HTTP wait.
          callbacks.caption(
            caption,
            isAgent ? "agent" : "user",
            key,
            !!complete,
          );
        }
        if (!complete) continue;
        seen.add(key);
        const userTurn = isAgent ? undefined : ++latestUserTurn;
        const phase = transition;
        // Only final utterances can trigger server-side leave and safety actions.
        void (async () => {
          try {
            const caption = await apiCall<SafeCaption>("caption", {
              sessionId,
              displayId,
              text: item.text,
              speaker: isAgent ? "agent" : "user",
            });
            if (!stopped && !closing && phase === transition) {
              callbacks.utterance?.(
                caption,
                isAgent ? "agent" : "user",
                userTurn,
              );
            }
          } catch {
            /* Final actions may fail; local captions need no HTTP response. */
          }
        })();
      }
    });
    toolkit.subscribeMessage(config.channel);
    await trackOperation(rtm.login({ token: config.token }));
    signal.throwIfAborted();
    await trackOperation(rtm.subscribe(config.channel));
    signal.throwIfAborted();
    await trackOperation(
      rtc.join(config.appId, config.channel, config.token, Number(config.uid)),
    );
    signal.throwIfAborted();
    microphone = await trackOperation(
      AgoraRTC.createMicrophoneAudioTrack({
        microphoneId: devices.inputId || undefined,
        AEC: true,
        ANS: true,
        AGC: false,
        encoderConfig: "speech_standard",
      }),
    );
    signal.throwIfAborted();
    microphone.on("track-ended", () => {
      if (!stopped && !closing)
        callbacks.fault("麦克风已断开，请重新选择设备并测试声音");
    });
    if (devices.mode === "hold") await microphone.setMuted(true);
    await trackOperation(rtc.publish(microphone));
    signal.throwIfAborted();
    await trackOperation(apiCall("agora-start", { sessionId, displayId }));
    const freeze = () => {
      if (stopped) return Promise.resolve();
      if (freezePromise) return freezePromise;
      frozen = true;
      for (const track of tracks) stopTrack(track);
      freezePromise = withMicrophone(async () => {
        await microphone?.setEnabled(false);
      });
      void freezePromise.catch(() => {
        if (!stopped) callbacks.fault("无法停止麦克风，请急停");
      });
      return freezePromise;
    };
    return {
      stop,
      freeze,
      async setTalking(value: boolean) {
        talking = value;
        if (devices.mode === "hold")
          await withMicrophone(async () => {
            if (!closing && !frozen) await microphone!.setMuted(!talking);
          });
      },
      async resume() {
        if (stopped) return;
        const phase = ++transition;
        await trackOperation(apiCall("agora-resume", { sessionId, displayId }));
        if (stopped || phase !== transition) return;
        await withMicrophone(async () => {
          if (phase !== transition) return;
          await microphone!.setEnabled(true);
          if (stopped || phase !== transition) return;
          if (devices.mode === "hold") await microphone!.setMuted(true);
          if (stopped || phase !== transition) return;
          await rtc.publish(microphone!);
          if (stopped || phase !== transition) return;
          talking = false;
          closing = false;
          closingEvidence = undefined;
          freezePromise = undefined;
          frozen = false;
          for (const track of tracks) {
            await playTrack(track);
            if (stopped || phase !== transition) return;
          }
        });
      },
      async close(text: string, kind: "gift" | "goodbye" = "gift") {
        if (stopped || (closing && closingEvidence?.kind === kind)) return;
        const phase = ++transition;
        closing = true;
        for (const key of scenes.keys()) seen.add(key);
        talking = false;
        closingPlayback = false;
        clearInterval(playbackTimer);
        playbackTimer = undefined;
        callbacks.announcing?.(text);
        freezePromise = undefined;
        closingEvidence = {
          text: normalizeClosing(text),
          complete: false,
          heardAudio: false,
          silentSamples: 0,
          checkedAt: performance.now(),
          kind,
        };
        // Stop the old reply immediately; the server replaces it with an
        // INTERRUPT announcement. Completion still requires playback evidence.
        await freeze();
        if (stopped || phase !== transition) return;
        await withMicrophone(async () => {
          if (phase === transition && microphone)
            await rtc.unpublish(microphone);
        });
        if (stopped || phase !== transition) return;
        await trackOperation(
          apiCall("agora-close", { sessionId, displayId, kind }),
        );
        // Resume receiving only after the server accepted the saved controlled closing.
        if (stopped || phase !== transition) return;
        closingPlayback = true;
        for (const track of tracks) {
          await playTrack(track);
          if (stopped || phase !== transition) return;
        }
        closingEvidence.checkedAt = performance.now();
        playbackTimer = setInterval(() => {
          const evidence = closingEvidence;
          if (!evidence || stopped || !routed.size || phase !== transition)
            return;
          const now = performance.now();
          const audible = [...routed].some(
            (track) => track.isPlaying && track.getVolumeLevel() > 0.01,
          );
          // A suspended/hidden page has no continuous silence evidence.
          if (now - evidence.checkedAt > 1500) {
            evidence.silentAt = undefined;
            evidence.silentSamples = 0;
          }
          evidence.checkedAt = now;
          if (audible) {
            evidence.heardAudio = true;
            evidence.silentAt = undefined;
            evidence.silentSamples = 0;
          } else {
            evidence.silentAt ??= now;
            evidence.silentSamples++;
          }
          // Match this closing's media endpoint before observing the drained
          // track. Neither wall time nor server speaking=false proves playback.
          if (
            evidence.complete &&
            evidence.speaking === false &&
            evidence.heardAudio &&
            evidence.endPts !== undefined &&
            evidence.playedPts !== undefined &&
            evidence.playedPts >= evidence.endPts &&
            evidence.silentAt !== undefined &&
            now - evidence.silentAt >= 1500 &&
            evidence.silentSamples >= 4
          ) {
            closingPlayback = false;
            clearInterval(playbackTimer);
            playbackTimer = undefined;
            for (const track of tracks) stopTrack(track);
            callbacks.announced(evidence.kind);
          }
        }, 250);
      },
      mute() {
        ++transition;
        frozen = true;
        closingPlayback = false;
        microphone?.close();
        for (const track of tracks) stopTrack(track);
      },
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
export type LiveVoice = Awaited<ReturnType<typeof connectAgora>>;
