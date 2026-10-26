/** Browser speech is used only by the explicitly labelled local rehearsal. */
export function speak(
  text: string,
  language: "zh" | "en",
  onStart?: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!("speechSynthesis" in window)) {
      reject(new Error("浏览器不支持朗读，请使用无声演练"));
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language === "zh" ? "zh-CN" : "en-US";
    const voice = speechSynthesis
      .getVoices()
      .find((voice) => voice.lang.startsWith(language));
    if (voice) utterance.voice = voice;
    let started = false;
    const timer = setTimeout(() => {
      if (!started) {
        speechSynthesis.cancel();
        reject(new Error("朗读未启动，请使用无声演练或检查声音设置"));
      }
    }, 5000);
    const finishTimer = setTimeout(() => {
      speechSynthesis.cancel();
      reject(new Error("朗读超时"));
    }, 25000);
    utterance.onstart = () => {
      started = true;
      clearTimeout(timer);
      onStart?.();
    };
    utterance.onend = () => {
      clearTimeout(timer);
      clearTimeout(finishTimer);
      resolve();
    };
    utterance.onerror = () => {
      clearTimeout(timer);
      clearTimeout(finishTimer);
      reject(new Error("朗读中断或声音不可用"));
    };
    speechSynthesis.speak(utterance);
  });
}
export function stopSpeech() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
