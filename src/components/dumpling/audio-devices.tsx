import { useI18n } from "@/i18n/provider";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  audioDeviceError,
  startAudioCheck,
  type AudioCheck,
  type AudioSelection,
} from "@/voice/devices";

export function AudioDevices({
  open,
  onOpenChange,
  configured,
  onPrepare,
  onInvalid,
  active,
  ready,
  inputMode,
  onInputMode,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  configured: AudioSelection;
  onPrepare(selection: AudioSelection): Promise<void>;
  onInvalid(message: string): void;
  active: boolean;
  ready: boolean;
  inputMode: "open" | "hold";
  onInputMode(mode: "open" | "hold"): void;
}) {
  const { t, text } = useI18n();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [inputId, setInputId] = useState(configured.inputId);
  const [outputId, setOutputId] = useState(configured.outputId);
  const [granting, setGranting] = useState(false);
  const [phase, setPhase] = useState<
    | "idle"
    | "starting"
    | "recording"
    | "stopping"
    | "recorded"
    | "playing"
    | "played"
  >("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const check = useRef<AudioCheck | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  const busy =
    granting ||
    ["starting", "recording", "stopping", "playing"].includes(phase);
  const dispose = useCallback(() => {
    controller.current?.abort();
    controller.current = undefined;
    check.current?.dispose();
    check.current = undefined;
  }, []);
  const reset = useCallback(() => {
    dispose();
    setPhase("idle");
    setSeconds(0);
    setLevel(0);
    setError("");
  }, [dispose]);
  useEffect(() => {
    if (!open || active) reset();
    return dispose;
  }, [open, active, reset, dispose]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [canChooseOutput, setCanChooseOutput] = useState(false);
  const invalid = useRef(onInvalid);
  invalid.current = onInvalid;
  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      const message =
        "Your browser can't access audio devices here. Open the app on localhost or HTTPS, then check microphone permissions.";
      setError(message);
      if (ready) invalid.current(message);
      return;
    }
    try {
      const list = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.deviceId,
      );
      setDevices(list);
      setLoaded(true);
      const supportsOutput =
        typeof HTMLMediaElement.prototype.setSinkId === "function" &&
        /Chrome|Chromium|Edg\//.test(navigator.userAgent) &&
        !/Android|Mobile/.test(navigator.userAgent);
      setCanChooseOutput(supportsOutput);
      const has = (kind: MediaDeviceKind, id: string) =>
        list.some((device) => device.kind === kind && device.deviceId === id);
      const missingRequired =
        !list.some((device) => device.kind === "audioinput") ||
        (supportsOutput &&
          !list.some((device) => device.kind === "audiooutput"));
      if (
        ready &&
        (missingRequired ||
          (configured.inputId && !has("audioinput", configured.inputId)) ||
          (configured.outputId && !has("audiooutput", configured.outputId)))
      ) {
        const message =
          "An audio device was disconnected, or its permissions changed. Refresh the list, choose your devices, and test them again.";
        setError(message);
        invalid.current(message);
      }
    } catch {
      const message =
        "Couldn't load the device list. Check your browser permissions and try again.";
      setError(message);
      if (ready) invalid.current(message);
    }
  }, [configured.inputId, configured.outputId, ready]);
  useEffect(() => {
    void refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () =>
      navigator.mediaDevices?.removeEventListener("devicechange", refresh);
  }, [refresh]);
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);
  const inputs = devices.filter((device) => device.kind === "audioinput");
  const outputs = devices.filter((device) => device.kind === "audiooutput");
  const inputMissing = loaded && !inputs.length;
  const outputMissing = loaded && canChooseOutput && !outputs.length;
  const selectedMissing =
    (inputId && !inputs.some((device) => device.deviceId === inputId)) ||
    (outputId && !outputs.some((device) => device.deviceId === outputId));
  useEffect(() => {
    if (selectedMissing) reset();
  }, [selectedMissing, reset]);
  const stopRecording = useCallback(async () => {
    const sample = check.current;
    const signal = controller.current?.signal;
    if (!sample || signal?.aborted) return;
    setPhase("stopping");
    try {
      await sample.finish();
      if (!signal?.aborted) setPhase("recorded");
    } catch (error) {
      if (!signal?.aborted) {
        dispose();
        setPhase("idle");
        setError(audioDeviceError(error));
      }
    }
  }, [dispose]);
  useEffect(() => {
    if (phase !== "recording") return;
    const startedAt = performance.now();
    const timer = setInterval(() => {
      setLevel(check.current?.level() ?? 0);
      const elapsed = Math.floor((performance.now() - startedAt) / 1000);
      setSeconds(elapsed);
      if (elapsed >= 10) void stopRecording();
    }, 100);
    return () => clearInterval(timer);
  }, [phase, stopRecording]);
  async function grant() {
    reset();
    const request = new AbortController();
    controller.current = request;
    setGranting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      if (!request.signal.aborted) await refresh();
    } catch (error) {
      if (!request.signal.aborted) setError(audioDeviceError(error));
    } finally {
      setGranting(false);
    }
  }
  async function record() {
    reset();
    invalid.current("");
    const request = new AbortController();
    controller.current = request;
    setPhase("starting");
    try {
      const sample = await startAudioCheck(
        { inputId, outputId },
        request.signal,
      );
      if (request.signal.aborted) return sample.dispose();
      check.current = sample;
      setPhase("recording");
    } catch (error) {
      if (!request.signal.aborted) {
        dispose();
        setPhase("idle");
        setError(audioDeviceError(error));
      }
    }
  }
  async function playback() {
    const sample = check.current;
    const signal = controller.current?.signal;
    if (!sample || signal?.aborted) return;
    setError("");
    setPhase("playing");
    try {
      await sample.play();
      if (!signal?.aborted) setPhase("played");
    } catch (error) {
      if (!signal?.aborted) {
        setPhase("recorded");
        setError(audioDeviceError(error));
      }
    }
  }
  async function prepare() {
    if (phase !== "played" || !check.current) return;
    try {
      await onPrepare(check.current.selection);
      reset();
      onOpenChange(false);
    } catch (error) {
      setError(audioDeviceError(error));
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="audio-device-dialog"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document
            .querySelector<HTMLButtonElement>("[data-audio-devices-trigger]")
            ?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("Audio devices")}</DialogTitle>
          <DialogDescription>
            {t(
              "Choose your microphone and speakers, record a few words, then listen back. You can't switch devices during a call.",
            )}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="audio-input">{t("Microphone")}</FieldLabel>
            <NativeSelect
              className="w-full"
              id="audio-input"
              value={inputId || "system-default"}
              onChange={(event) => {
                reset();
                invalid.current("");
                setInputId(
                  event.target.value === "system-default"
                    ? ""
                    : event.target.value,
                );
              }}
              disabled={busy || active || inputMissing}
            >
              <NativeSelectOption value="system-default">
                {inputMissing
                  ? t("No microphone found. Allow access or connect one.")
                  : t("System default microphone")}
              </NativeSelectOption>
              {inputs.map((device, i) => (
                <NativeSelectOption
                  key={device.deviceId}
                  value={device.deviceId}
                >
                  {device.label ||
                    t("Microphone {number} (allow access to see its name)", {
                      number: i + 1,
                    })}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="audio-output">
              {t("Speakers or TV")}
            </FieldLabel>
            <NativeSelect
              className="w-full"
              id="audio-output"
              value={outputId || "system-default"}
              onChange={(event) => {
                reset();
                invalid.current("");
                setOutputId(
                  event.target.value === "system-default"
                    ? ""
                    : event.target.value,
                );
              }}
              disabled={busy || active || !canChooseOutput || outputMissing}
            >
              <NativeSelectOption value="system-default">
                {outputMissing
                  ? t(
                      "No speakers found. Check that your TV or speakers are connected.",
                    )
                  : t("System default output")}
              </NativeSelectOption>
              {outputs.map((device, i) => (
                <NativeSelectOption
                  key={device.deviceId}
                  value={device.deviceId}
                >
                  {device.label || t("Speaker {number}", { number: i + 1 })}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="speaking-mode">
              {t("Speaking mode")}
            </FieldLabel>
            <NativeSelect
              id="speaking-mode"
              value={inputMode}
              disabled={busy || active}
              onChange={(event) =>
                onInputMode(event.target.value as "open" | "hold")
              }
            >
              <NativeSelectOption value="open">
                {t("Hands-free conversation")}
              </NativeSelectOption>
              <NativeSelectOption value="hold">
                {t("Hold to talk (for noisy rooms)")}
              </NativeSelectOption>
            </NativeSelect>
          </Field>
          {!canChooseOutput && (
            <p>
              {t(
                "To use a different speaker, select it in your computer's sound settings. This browser can't switch outputs.",
              )}
            </p>
          )}
          <p>
            {t(
              "Record for up to 10 seconds and listen back. Check that your voice is clear and the room isn't too loud. The recording stays on this computer and is discarded when you close this panel. Demo speech uses your system's default speakers; live calls use the output selected above.",
            )}
          </p>
          {phase === "recording" && (
            <div className="grid gap-1">
              <meter
                aria-label={t("Microphone input level")}
                className="h-3 w-full"
                min={0}
                max={100}
                value={level}
              />
              <p className="text-sm text-muted-foreground">
                {t(
                  "This bar should move when you speak. If it doesn't, check that you've selected the right microphone and that it isn't muted.",
                )}
              </p>
            </div>
          )}
          <p role="status" aria-live="polite">
            {phase === "recording"
              ? t("Recording… Say a few words ({seconds} / 10 seconds)", {
                  seconds,
                })
              : phase === "stopping"
                ? t("Finishing your recording…")
                : phase === "recorded"
                  ? t(
                      "All recorded. Play it back and check that you can hear yourself.",
                    )
                  : phase === "playing"
                    ? t("Playing your recording. Can you hear it clearly?")
                    : phase === "played"
                      ? t(
                          "Could you hear yourself clearly? If so, choose Sounds good. If not, check your speakers or record another sample.",
                        )
                      : t("Start recording and speak at your usual volume.")}
          </p>
          {(error || inputMissing || outputMissing) && (
            <Alert variant="destructive">
              <AlertDescription>
                {text(error) ||
                  (inputMissing
                    ? t(
                        "No microphone found. Allow microphone access or connect one, then refresh the list.",
                      )
                    : t(
                        "No speakers found. Connect your TV or speakers, then try again.",
                      ))}
              </AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void grant()}
              disabled={busy || active}
            >
              {t("Allow access and refresh")}
            </Button>
            {phase === "recording" ? (
              <Button onClick={() => void stopRecording()}>
                {t("Stop recording")}
              </Button>
            ) : (
              <Button
                variant={phase === "idle" ? "default" : "outline"}
                onClick={() => void record()}
                disabled={
                  busy ||
                  active ||
                  !loaded ||
                  inputMissing ||
                  outputMissing ||
                  !!selectedMissing
                }
              >
                {phase === "starting"
                  ? t("Waiting for microphone…")
                  : phase === "idle"
                    ? t("Start recording")
                    : t("Record again")}
              </Button>
            )}
            {["recorded", "playing", "played"].includes(phase) && (
              <Button
                variant="outline"
                onClick={() => void playback()}
                disabled={busy || active}
              >
                {phase === "playing" ? t("Playing back…") : t("Play recording")}
              </Button>
            )}
            {phase !== "idle" && (
              <Button
                onClick={() => void prepare()}
                disabled={phase !== "played" || active}
              >
                {t("Sounds good")}
              </Button>
            )}
          </div>
        </FieldGroup>
      </DialogContent>
    </Dialog>
  );
}
