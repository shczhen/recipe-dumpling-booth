export interface AudioSelection {
  inputId: string;
  outputId: string;
}

export function audioDeviceError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NoAudioError")
    return "没有录到声音，或声音太轻。请确认选对麦克风、没有静音，靠近话筒说几句话再试。";
  if (name === "PlaybackError")
    return "录音回放失败。请检查所选输出设备和 Chrome 的声音权限，再点回放重试。";
  if (name === "NotFoundError")
    return "未检测到麦克风或输出设备。请连接话筒和扬声器后刷新设备。";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "麦克风或声音权限被拒绝。请在浏览器地址栏允许权限，再重试。";
  if (name === "NotReadableError")
    return "麦克风无法读取，可能被其他应用占用。请检查连接并关闭占用它的应用。";
  if (name === "NotSupportedError")
    return "此浏览器不支持录音回放。请使用桌面版 Chrome 或 Edge。";
  if (name === "OverconstrainedError")
    return "所选麦克风已不可用。请刷新设备并重新选择。";
  return "设备准备或声音测试失败。请检查所选话筒、电视/扬声器和系统音量后重试。";
}

export interface AudioCheck {
  selection: AudioSelection;
  level(): number;
  finish(): Promise<void>;
  play(): Promise<void>;
  dispose(): void;
}

/** A disposable local sample, never uploaded or used for Agent speech. */
export async function startAudioCheck(
  selection: AudioSelection,
  signal: AbortSignal,
): Promise<AudioCheck> {
  signal.throwIfAborted();
  if (!navigator.mediaDevices?.getUserMedia)
    throw new DOMException("Unavailable", "SecurityError");
  if (typeof MediaRecorder === "undefined")
    throw new DOMException("Recording unavailable", "NotSupportedError");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: selection.inputId ? { exact: selection.inputId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    },
  });
  const audio = new Audio();
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let recorder: MediaRecorder | undefined;
  let disposed = false;
  let url: string | undefined;
  let finishPlayback: ((error?: unknown) => void) | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", dispose);
    finishPlayback?.(new DOMException("Cancelled", "AbortError"));
    audio.pause();
    audio.removeAttribute("src");
    source?.disconnect();
    if (context && context.state !== "closed") void context.close();
    if (url) URL.revokeObjectURL(url);
    if (recorder?.state !== "inactive") recorder?.stop();
    stream.getTracks().forEach((track) => track.stop());
  };
  signal.addEventListener("abort", dispose, { once: true });
  try {
    signal.throwIfAborted();
    const track = stream.getAudioTracks()[0];
    if (!track) throw new DOMException("No microphone", "NotFoundError");
    const inputId = track.getSettings().deviceId ?? selection.inputId;
    context = new AudioContext();
    await context.resume();
    signal.throwIfAborted();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    const samples = new Float32Array(analyser.fftSize);
    source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    if (selection.outputId) {
      if (typeof audio.setSinkId !== "function")
        throw new DOMException("Output unavailable", "NotAllowedError");
      await audio.setSinkId(selection.outputId);
    }
    signal.throwIfAborted();
    recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    let failure: DOMException | undefined;
    let finishing = false;
    const finished = new Promise<void>((resolve, reject) => {
      recorder!.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder!.onerror = () => {
        failure = new DOMException("Recording failed", "NotReadableError");
        reject(failure);
      };
      recorder!.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        if (disposed)
          return reject(new DOMException("Cancelled", "AbortError"));
        if (failure) return reject(failure);
        const blob = new Blob(chunks, { type: recorder!.mimeType });
        if (!blob.size)
          return reject(
            new DOMException("Empty recording", "NotReadableError"),
          );
        try {
          const buffer = await context!.decodeAudioData(
            await blob.arrayBuffer(),
          );
          signal.throwIfAborted();
          let peak = 0;
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            for (const sample of buffer.getChannelData(channel))
              peak = Math.max(peak, Math.abs(sample));
          }
          // A non-empty Opus file can contain only silence. Check the decoded
          // recording, not file size or microphone permission, before playback.
          if (peak < 0.001)
            throw new DOMException("No audible recording", "NoAudioError");
          url = URL.createObjectURL(blob);
          audio.src = url;
          source?.disconnect();
          await context!.close();
          resolve();
        } catch (error) {
          reject(error);
        }
      };
    });
    // Cancellation can happen before the caller presses Stop.
    void finished.catch(() => {});
    recorder.start();
    return {
      selection: { inputId, outputId: selection.outputId },
      level() {
        if (disposed || context?.state !== "running") return 0;
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, value) => sum + value * value, 0) /
            samples.length,
        );
        return rms > 0
          ? Math.max(0, Math.min(100, ((20 * Math.log10(rms) + 60) / 60) * 100))
          : 0;
      },
      finish() {
        if (!finishing) {
          finishing = true;
          if (track.readyState !== "live")
            failure = new DOMException(
              "Microphone disconnected",
              "NotFoundError",
            );
          if (recorder!.state !== "inactive") recorder!.stop();
        }
        return finished;
      },
      async play() {
        signal.throwIfAborted();
        await finished;
        signal.throwIfAborted();
        finishPlayback?.(new DOMException("Playback replaced", "AbortError"));
        audio.currentTime = 0;
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const done = (error?: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (finishPlayback === done) {
              audio.onended = null;
              audio.onerror = null;
              finishPlayback = undefined;
              if (error) audio.pause();
            }
            if (error) reject(error);
            else resolve();
          };
          const timeout = setTimeout(
            () => done(new DOMException("Playback stalled", "PlaybackError")),
            20000,
          );
          finishPlayback = done;
          audio.onended = () => done();
          audio.onerror = () =>
            done(new DOMException("Playback failed", "PlaybackError"));
          void audio
            .play()
            .catch(() =>
              done(new DOMException("Playback denied", "PlaybackError")),
            );
        });
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
