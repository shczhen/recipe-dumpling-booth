import { useI18n } from "@/i18n/provider";
import { useEffect, useRef, useState } from "react";
import type { Appearance } from "./appearance";
import type { DisplayCaption } from "./captions";
import type { Session } from "@/shared/model";

/** Display-only turn cues; no inference or change to the Agent's protocol. */
export function useTurnActivity(
  session: Session | undefined,
  entries: DisplayCaption[],
  speaking: boolean,
  silent: boolean,
) {
  const latest = entries.at(-1);
  const key = `${session?.id}/${latest?.id}`;
  const [finished, setFinished] = useState<string>();
  const chatting =
    session?.status === "chatting" || session?.status === "gifted";
  useEffect(() => {
    if (!chatting || !latest || latest.complete === false || finished === key)
      return;
    if (latest.speaker === "user" && speaking) {
      setFinished(key);
      return;
    }
    const delay = latest.speaker === "user" ? 8000 : silent ? 2400 : 0;
    if (!delay) return;
    const timer = setTimeout(() => setFinished(key), delay);
    return () => clearTimeout(timer);
  }, [
    chatting,
    key,
    latest?.speaker,
    latest?.complete,
    speaking,
    silent,
    finished,
  ]);
  if (speaking) return "speaking";
  if (
    latest?.speaker === "user" &&
    latest.complete !== false &&
    finished !== key
  )
    return "thinking";
  if (silent && latest?.speaker === "agent" && finished !== key)
    return "speaking";
  return "listening";
}

/** Ambient movement is optional. Conversation state remains visible without it. */
export function useSceneMotion() {
  const ref = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(true);
  const [reduced, setReduced] = useState(true);
  const [visible, setVisible] = useState(true);
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const preference = () => setReduced(query.matches);
    const visibility = () => setVisible(!document.hidden);
    preference();
    visibility();
    query.addEventListener("change", preference);
    document.addEventListener("visibilitychange", visibility);
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry.isIntersecting),
    );
    if (ref.current) observer.observe(ref.current);
    return () => {
      query.removeEventListener("change", preference);
      document.removeEventListener("visibilitychange", visibility);
      observer.disconnect();
    };
  }, []);
  return {
    ref,
    reduced,
    enabled,
    moving: enabled && !reduced && visible && inView,
    toggle: () => setEnabled((previous) => !previous),
  };
}

export function IdleInvitation({
  moving,
  lines,
}: {
  moving: boolean;
  lines: Appearance["idleInvitations"];
}) {
  const { locale } = useI18n();
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!moving || lines.length < 2) return;
    const timer = setInterval(
      () => setIndex((previous) => (previous + 1) % lines.length),
      9000,
    );
    return () => clearInterval(timer);
  }, [moving, lines.length]);
  const line = lines[index % lines.length];
  return (
    <span className="idle-invitation" key={index}>
      {line[locale]}
    </span>
  );
}
