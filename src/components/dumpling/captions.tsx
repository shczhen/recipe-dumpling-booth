import { useI18n } from "@/i18n/provider";
import { useCallback, useRef, useState } from "react";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { cn } from "@/lib/utils";

export interface DisplayCaption {
  id: number;
  text: string;
  speaker: "user" | "agent";
  turnId?: string;
  complete?: boolean;
}

/** Upserts filtered streaming captions in place; never persists conversation. */
export function useDisplayCaptions(sessionId?: string) {
  const [entries, setEntries] = useState<
    (DisplayCaption & { sessionId?: string })[]
  >([]);
  const sequence = useRef(0);
  const owner = useRef(sessionId);
  owner.current = sessionId;
  const setCaption = useCallback((next?: Omit<DisplayCaption, "id">) => {
    if (!next) {
      setEntries([]);
      return;
    }
    if (!next.text.trim()) return;
    const entry = { ...next, id: ++sequence.current, sessionId: owner.current };
    // Functional updates preserve bursts delivered within a single React batch.
    setEntries((previous) => {
      const existing = entry.turnId
        ? previous.findIndex(
            (item) =>
              item.sessionId === entry.sessionId &&
              item.turnId === entry.turnId,
          )
        : -1;
      if (existing < 0) return [...previous, entry].slice(-3);
      return previous.map((item, index) =>
        index === existing ? { ...entry, id: item.id } : item,
      );
    });
  }, []);
  return {
    entries: entries.filter((entry) => entry.sessionId === sessionId),
    setCaption,
  };
}

export function CaptionRack({ entries }: { entries: DisplayCaption[] }) {
  const { t } = useI18n();
  const latest = entries.at(-1);
  // Keep the last exchange; consecutive host announcements replace each other.
  const visible =
    entries.at(-2)?.speaker === latest?.speaker
      ? entries.slice(-1)
      : entries.slice(-2);
  return (
    <section
      className="caption-rack"
      aria-label={t("Live captions")}
      role="log"
      aria-live="off"
    >
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller>
          <MessageScrollerViewport
            className="caption-viewport"
            tabIndex={0}
            aria-label={t("Recent conversation. Scroll to read more.")}
          >
            <MessageScrollerContent
              className="caption-stack"
              aria-live="off"
              role="presentation"
            >
              {visible.map((entry) => {
                const current = entry.id === latest?.id;
                return (
                  <MessageScrollerItem
                    key={entry.id}
                    messageId={String(entry.id)}
                  >
                    <Message
                      className={cn(
                        "caption-entry",
                        current ? "caption-current" : "caption-previous",
                      )}
                      data-caption-entry
                      data-current={current}
                    >
                      <span className="caption-speaker">
                        {t(entry.speaker === "agent" ? "Host" : "You")}
                      </span>
                      <MessageContent>
                        <p
                          className={cn(
                            "caption-text",
                            entry.text.length > 120 && "caption-long",
                          )}
                          dir="auto"
                          lang={
                            /[\u3400-\u9fff]/u.test(entry.text) ? "zh-CN" : "en"
                          }
                          aria-live={current ? "polite" : "off"}
                          aria-atomic="true"
                        >
                          {entry.text}
                        </p>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                );
              })}
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
    </section>
  );
}
