import { useI18n } from "@/i18n/provider";
import { useCallback, useEffect, useRef, useState } from "react";
import { DumplingDisplay } from "@/components/dumpling/display";
import { useDisplayCaptions } from "@/components/dumpling/captions";
import { useDemoState, useClock, secondsLeft, apiCall } from "@/lib/client";
import { isActive, announcementText, type Session } from "@/shared/model";
import { demoReply, type SafeCaption } from "@/shared/captions";
import { speak, stopSpeech } from "@/voice/speech";
import type { LiveVoice } from "@/voice/agora-client";
import { AudioDevices } from "@/components/dumpling/audio-devices";
import { type AudioSelection } from "@/voice/devices";

export function Experience() {
  const { t } = useI18n();
  const [displayId, setDisplayId] = useState<string>();
  const [prepared, setPrepared] = useState<"silent" | "audio">();
  const { view, error, busy, command, setError } = useDemoState(
    "display",
    displayId,
    !!prepared,
    prepared === "audio",
  );
  const { entries, setCaption } = useDisplayCaptions(view?.session?.id);
  const [speaking, setSpeaking] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [inputMode, setInputMode] = useState<"open" | "hold">("open");
  const [talking, setTalking] = useState(false);
  const [localStopped, setLocalStopped] = useState(false);
  const [localFault, setLocalFault] = useState("");
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [devices, setDevices] = useState<AudioSelection>({
    inputId: "",
    outputId: "",
  });
  const latest = useRef<{
    session?: Session;
    displayId?: string;
    prepared?: "silent" | "audio";
  }>({});
  latest.current = { session: view?.session, displayId, prepared };
  const voice = useRef<LiveVoice | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  const started = useRef<string | undefined>(undefined);
  const closed = useRef<string | undefined>(undefined);
  const resumed = useRef<string | undefined>(undefined);
  const feedbackBusy = useRef(false);
  const stoppedSession = useRef<string | undefined>(undefined);
  const now = useClock(view?.serverNow);
  const mute = useCallback(() => {
    stoppedSession.current = latest.current.session?.id;
    setLocalStopped(true);
    setCaption(undefined);
    setSpeaking(false);
    setTalking(false);
    stopSpeech();
    voice.current?.mute();
    abort.current?.abort();
  }, []);
  const fault = useCallback(
    (message: string) => {
      mute();
      setLocalFault(message);
      const session = latest.current.session;
      if (session && isActive(session))
        void command({
          type: "cancel",
          sessionId: session.id,
          reason: "playback",
        });
    },
    [command, mute],
  );
  useEffect(() => {
    setDisplayId(crypto.randomUUID());
  }, []);
  const holdToTalk = useCallback(
    (value: boolean) => {
      setTalking(value);
      void voice.current
        ?.setTalking(value)
        .catch(() =>
          fault("Couldn't switch the microphone. Set up audio again."),
        );
    },
    [fault],
  );
  useEffect(() => {
    const release = () => holdToTalk(false);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", release);
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", release);
    };
  }, [holdToTalk]);
  useEffect(() => {
    const bus = new BroadcastChannel("dumpling-display");
    bus.onmessage = (event) => {
      const message = event.data;
      const { session, displayId, prepared } = latest.current;
      if (!session || message?.sessionId !== session.id) return;
      if (message.type === "stop") {
        mute();
        return;
      }
      if (
        message.type !== "utterance" ||
        typeof message.text !== "string" ||
        message.text.length > 1000 ||
        session.driver !== "demo" ||
        !["chatting", "gifted"].includes(session.status) ||
        !displayId ||
        feedbackBusy.current
      )
        return;
      feedbackBusy.current = true;
      void (async () => {
        try {
          const safe = await apiCall<SafeCaption>("caption", {
            sessionId: session.id,
            displayId,
            text: message.text,
          });
          if (
            abort.current?.signal.aborted ||
            latest.current.session?.id !== session.id ||
            !["chatting", "gifted"].includes(
              latest.current.session?.status ?? "",
            )
          )
            return;
          setCaption({ text: safe.text, speaker: "user" });
          await command({
            type: "language",
            sessionId: session.id,
            displayId,
            language: safe.language,
          });
          if (safe.blocked)
            await command({
              type: "violation",
              sessionId: session.id,
              displayId,
            });
          if (
            abort.current?.signal.aborted ||
            !["chatting", "gifted"].includes(
              latest.current.session?.status ?? "",
            )
          )
            return;
          const text = demoReply(
            safe.language,
            safe.blocked,
            session.gameId,
            session.status === "gifted",
          );
          if (!text) return;
          await new Promise((resolve) => setTimeout(resolve, 1200));
          if (
            abort.current?.signal.aborted ||
            !["chatting", "gifted"].includes(
              latest.current.session?.status ?? "",
            )
          )
            return;
          setCaption({ text, speaker: "agent" });
          setSpeaking(true);
          if (prepared === "audio") {
            stopSpeech();
            await speak(text, safe.language);
          }
          setSpeaking(false);
        } catch {
          /* Failed/late rehearsal text is never rendered raw. */
        } finally {
          feedbackBusy.current = false;
        }
      })();
    };
    return () => bus.close();
  }, [command, mute]);
  useEffect(() => {
    const release = () => {
      mute();
      if (displayId)
        void fetch("/api/command", {
          method: "POST",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "release", displayId }),
        });
    };
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("pagehide", release);
      abort.current?.abort();
      stopSpeech();
    };
  }, [displayId, mute]);
  const session = view?.session;
  useEffect(() => {
    if (
      !session ||
      !displayId ||
      !prepared ||
      session.status !== "connecting" ||
      started.current === session.id
    )
      return;
    stoppedSession.current = undefined;
    started.current = session.id;
    closed.current = undefined;
    resumed.current = undefined;
    setCaption(undefined);
    setLocalStopped(false);
    setLocalFault("");
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const opening = () => {
      if (!controller.signal.aborted) {
        setSpeaking(true);
        void command({ type: "opening", sessionId: session.id, displayId });
      }
    };
    if (session.driver === "demo") {
      setCaption({ text: session.opening, speaker: "agent" });
      if (prepared === "silent") {
        opening();
        setSpeaking(false);
      } else
        void speak(session.opening, session.language, opening)
          .then(() => {
            if (!controller.signal.aborted) setSpeaking(false);
          })
          .catch((error) => {
            if (!controller.signal.aborted) fault(error.message);
          });
    } else {
      void import("../voice/agora-client")
        .then((module) =>
          module.connectAgora(
            session.id,
            displayId,
            {
              opening,
              caption(safe, speaker, turnId, complete) {
                if (controller.signal.aborted) return;
                setCaption({ text: safe.text, speaker, turnId, complete });
              },
              utterance(safe, speaker, userTurn) {
                if (controller.signal.aborted) return;
                if (speaker === "user") {
                  // The server rejects older turns even if either HTTP hop
                  // arrives out of order. Safety events still apply per turn.
                  void command({
                    type: "language",
                    sessionId: session.id,
                    displayId,
                    language: safe.language,
                    turn: userTurn,
                  });
                  if (safe.blocked)
                    void command({
                      type: "violation",
                      sessionId: session.id,
                      displayId,
                    });
                }
              },
              speaking(value) {
                if (!controller.signal.aborted) setSpeaking(value);
              },
              announcing(text) {
                if (controller.signal.aborted) return;
                setCaption({ text, speaker: "agent" });
                setSpeaking(true);
              },
              announced(kind) {
                if (
                  controller.signal.aborted ||
                  latest.current.session?.id !== session.id ||
                  latest.current.session?.status !== "announcing"
                )
                  return;
                setSpeaking(false);
                void command({
                  type: "announced",
                  sessionId: session.id,
                  displayId,
                  kind,
                });
              },
              fault,
            },
            controller.signal,
            { ...devices, mode: inputMode },
          ),
        )
        .then((connection) => {
          if (controller.signal.aborted) void connection.stop();
          else voice.current = connection;
        })
        .catch(() => {
          if (!controller.signal.aborted)
            fault(
              "Couldn't start the call. Ask a staff member to check the Agora settings.",
            );
        });
    }
  }, [session, displayId, prepared, command, fault, devices, inputMode]);
  useEffect(() => {
    if (
      !session ||
      session.status !== "announcing" ||
      !session.result ||
      !displayId ||
      closed.current ===
        `${session.id}/${session.announcementKind ?? "gift"}` ||
      localStopped
    )
      return;
    closed.current = `${session.id}/${session.announcementKind ?? "gift"}`;
    setTalking(false);
    stopSpeech();
    const text = announcementText(session)!;
    const kind = session.announcementKind ?? "gift";
    if (session.driver === "agora") {
      void voice.current
        ?.close(text, kind)
        .catch(() =>
          fault("The announcement didn't play. Your gift is still reserved."),
        );
      return;
    }
    setCaption({ text, speaker: "agent" });
    setSpeaking(true);
    const controller = abort.current;
    void (async () => {
      try {
        if (prepared === "audio") await speak(text, session.language);
        else await new Promise((resolve) => setTimeout(resolve, 3500));
        if (!controller?.signal.aborted)
          await command({
            type: "announced",
            sessionId: session.id,
            displayId,
            kind,
          });
      } catch {
        if (!controller?.signal.aborted)
          await command({
            type: "announced",
            sessionId: session.id,
            displayId,
            fallback: true,
            kind,
          });
      }
    })();
  }, [session, displayId, prepared, command, localStopped, fault]);
  useEffect(() => {
    if (
      session?.status !== "gifted" ||
      session.driver !== "agora" ||
      resumed.current === session.id ||
      localStopped
    )
      return;
    resumed.current = session.id;
    void voice.current
      ?.resume()
      .catch(() =>
        fault("Your gift is reserved, but we couldn't reconnect the call."),
      );
  }, [session, localStopped, fault]);
  useEffect(() => {
    if (!session || !isActive(session)) {
      abort.current?.abort();
      void voice.current?.stop();
      voice.current = undefined;
      stopSpeech();
      setSpeaking(false);
      setCaption(undefined);
      if (!session) {
        setLocalStopped(false);
        started.current = undefined;
        closed.current = undefined;
      }
    } else if (session.muted) mute();
  }, [session?.id, session?.status, session?.muted, mute]);
  // Fail closed on transport loss rather than letting stale audio continue.
  useEffect(() => {
    if (error && isActive(latest.current.session)) mute();
  }, [error, mute]);
  useEffect(() => {
    if (
      session &&
      ["chatting", "gifted"].includes(session.status) &&
      session.driver === "agora" &&
      session.deadline &&
      now >= session.deadline + 6000
    )
      voice.current?.freeze();
  }, [session?.id, session?.status, session?.deadline, session?.driver, now]);
  useEffect(() => {
    if (
      localStopped &&
      session &&
      stoppedSession.current === session.id &&
      isActive(session)
    )
      void command({
        type: "cancel",
        sessionId: session.id,
        reason: "disconnect",
      });
  }, [localStopped, session, command]);
  async function prepareAudio(selection: AudioSelection) {
    if (isActive(latest.current.session))
      throw new Error("End this session before changing devices.");
    setPreparing(true);
    setPrepared(undefined);
    setLocalFault("");
    setError("");
    try {
      setDevices(selection);
      setPrepared("audio");
      setLocalStopped(false);
    } finally {
      setPreparing(false);
    }
  }
  const left = secondsLeft(
    session?.farewellAt ?? session?.deadline,
    now,
    session?.duration ?? 120,
  );
  return (
    <>
      <DumplingDisplay
        view={view}
        seconds={left}
        entries={entries}
        speaking={speaking}
        prepared={prepared}
        preparing={preparing}
        localStopped={localStopped}
        error={error || localFault}
        busy={busy}
        talkControl={
          prepared === "audio" &&
          session?.driver === "agora" &&
          inputMode === "hold" &&
          ["chatting", "gifted"].includes(session.status) &&
          !localStopped ? (
            <button
              className="hold-to-talk"
              aria-pressed={talking}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                holdToTalk(true);
              }}
              onPointerUp={() => holdToTalk(false)}
              onPointerCancel={() => holdToTalk(false)}
              onLostPointerCapture={() => holdToTalk(false)}
              onKeyDown={(e) => {
                if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                  e.preventDefault();
                  holdToTalk(true);
                }
              }}
              onKeyUp={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  holdToTalk(false);
                }
              }}
              onBlur={() => holdToTalk(false)}
            >
              {talking ? t("Listening… Release to stop") : t("Hold to talk")}
            </button>
          ) : undefined
        }
        onPrepare={() => setDevicesOpen(true)}
        onDevices={() => setDevicesOpen(true)}
        onSilent={() => {
          setPrepared("silent");
          setLocalFault("");
        }}
        onFullscreen={() => {
          if (!document.fullscreenElement)
            void document.documentElement
              .requestFullscreen()
              .catch(() => setLocalFault("Use the browser's fullscreen menu"));
          else void document.exitFullscreen();
        }}
      />
      <AudioDevices
        open={devicesOpen}
        onOpenChange={setDevicesOpen}
        configured={devices}
        ready={prepared === "audio"}
        active={isActive(session)}
        inputMode={inputMode}
        onInputMode={(mode) => {
          setInputMode(mode);
          setPrepared(undefined);
        }}
        onPrepare={prepareAudio}
        onInvalid={(message) => {
          setPrepared(undefined);
          if (isActive(latest.current.session)) fault(message);
          else setLocalFault(message);
        }}
      />
    </>
  );
}
