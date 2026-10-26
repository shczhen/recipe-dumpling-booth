import type { Language } from "./model";
export interface SafeCaption {
  text: string;
  language: Language;
  blocked: boolean;
}
const unsafe =
  /操你|傻[逼比]|妈的|色情|做爱|法轮|共产党|习近平|台独|fuck|\bshit\b|porn|blowjob|\bsex\b|communist party|taiwan independence/i;
export function safeCaption(raw: string): SafeCaption {
  const language: Language = /[\u3400-\u9fff]/u.test(raw) ? "zh" : "en";
  const blocked = unsafe.test(raw);
  if (blocked)
    return {
      language,
      blocked,
      text:
        language === "zh"
          ? "咱们聊点轻松的，饺子和生活都行。"
          : "Let’s keep our chat friendly. Tell me about your day.",
    };
  const text = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 320);
  return { text, language, blocked };
}
export function demoReply(
  language: Language,
  blocked: boolean,
  gameId?: string,
  gifted = false,
) {
  if (blocked)
    return language === "zh"
      ? "咱们换个轻松的话题吧。"
      : "Let’s keep it friendly.";
  if (gifted)
    return language === "zh"
      ? "这份心意收好，今天来逛得怎么样？"
      : "Hope you like it! What else have you checked out today?";
  return language === "zh" ? "这轮流程演练先接着聊。" : "Go on, I'm listening.";
}
