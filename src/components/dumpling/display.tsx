import { useI18n } from "@/i18n/provider";
import { modeLabel } from "@/i18n/locale";
import { LanguageSwitcher } from "./language-switcher";
import type { ReactNode, CSSProperties } from "react";
import {
  Maximize,
  Volume2,
  VolumeX,
  Pause,
  Play,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { timeLabel } from "@/lib/client";
import { isActive, type Snapshot } from "@/shared/model";
import { Artwork, GiftArtwork } from "./artwork";
import {
  defaultAppearance,
  useAppearance,
  type Appearance,
} from "./appearance";
import { CaptionRack, type DisplayCaption } from "./captions";
import { IdleInvitation, useSceneMotion, useTurnActivity } from "./scene";

function ChallengeTimer({
  seconds,
  appearance,
  compact = false,
}: {
  compact?: boolean;
  seconds: number;
  appearance: Appearance;
}) {
  const { t } = useI18n();
  return (
    <div
      className={cn("challenge-clock", compact && "challenge-clock-compact")}
      role="timer"
      aria-label={t("Time remaining")}
      aria-live="off"
    >
      {!compact && (
        <Artwork
          src={appearance.clock}
          fallback={defaultAppearance.clock}
          alt=""
          className="clock-art"
        />
      )}
      <div className="clock-face">
        <span>{t("Time remaining")}</span>
        <strong>{timeLabel(Math.max(0, seconds))}</strong>
      </div>
    </div>
  );
}

function GiftShelf({
  view,
  appearance,
}: {
  view: Snapshot;
  appearance: Appearance;
}) {
  const { t, words } = useI18n();
  return (
    <section
      className="gift-shelf"
      aria-label={t("Gifts")}
      style={{ "--gift-count": view.gifts.length } as CSSProperties}
    >
      {view.gifts.map((gift, index) => (
        <figure className="gift-slot" key={index}>
          <figcaption>
            <span className="gift-title" title={words(gift)}>
              {words(gift)}
            </span>
          </figcaption>
          <GiftArtwork
            rank={index + 1}
            appearance={appearance}
            giftCount={view.gifts.length}
          />
        </figure>
      ))}
    </section>
  );
}

interface DisplayProps {
  view?: Snapshot;
  seconds: number;
  entries: DisplayCaption[];
  speaking: boolean;
  prepared?: "silent" | "audio";
  preparing: boolean;
  localStopped: boolean;
  error: string;
  busy: boolean;
  audioSettings?: ReactNode;
  talkControl?: ReactNode;
  onPrepare(): void;
  onDevices(): void;
  onSilent(): void;
  onFullscreen(): void;
}

export function DumplingDisplay({
  view,
  seconds,
  entries,
  speaking,
  prepared,
  preparing,
  localStopped,
  error,
  busy,
  audioSettings,
  talkControl,
  onPrepare,
  onDevices,
  onSilent,
  onFullscreen,
}: DisplayProps) {
  const { t, text, words, locale } = useI18n();
  const appearance = useAppearance();
  const motion = useSceneMotion();
  const session = view?.session;
  const turn = useTurnActivity(
    session,
    entries,
    speaking,
    session?.driver === "demo" && prepared === "silent",
  );
  const result =
    session && (session.giftRevealedAt || session.status === "completed")
      ? session.result
      : undefined;
  const resultRank = t("Your gift");
  const cancelled =
    session?.status === "cancelled" || (localStopped && !result);
  const ambient = motion.moving && !cancelled && !error;
  const state = !view
    ? "loading"
    : cancelled
      ? "cancelled"
      : (session?.status ?? "waiting");
  const welcome = state === "waiting";
  const active =
    state === "chatting" ||
    state === "gifted" ||
    state === "announcing" ||
    state === "connecting";
  const activity = cancelled
    ? "paused"
    : welcome
      ? "idle"
      : result && !active
        ? "celebrating"
        : state === "announcing"
          ? "drawing"
          : state === "chatting" || state === "gifted"
            ? turn
            : "connecting";
  const pose = cancelled
    ? "paused"
    : state === "announcing" || (result && !active)
      ? "gifting"
      : activity === "thinking"
        ? "thinking"
        : activity === "speaking"
          ? "speaking"
          : state === "chatting" || state === "gifted"
            ? "listening"
            : "welcome";
  const heading = result
    ? words(result.gift)
    : t(
        cancelled
          ? "One moment.\nBe right back."
          : state === "announcing"
            ? "I've got\na gift for you."
            : state === "chatting"
              ? "Hu's Dumpling Shop"
              : state === "connecting"
                ? "I'll be right\nwith you."
                : "Come on in.\nGrab a seat.",
      );
  const subtitle = result
    ? t("Thanks for stopping by!")
    : t(
        cancelled
          ? "We will be right back."
          : state === "announcing"
            ? "Let's see what you got."
            : state === "connecting"
              ? "Make yourself at home."
              : "Play a game. Take home a gift.",
      );

  return (
    <main
      className="shop-page"
      data-state={state}
      data-result={!!result}
      data-activity={activity}
      data-motion={ambient}
      style={
        {
          "--shop-frame": `url(${JSON.stringify(appearance.frame)})`,
          "--shop-swash": `url(${JSON.stringify(appearance.swash)})`,
        } as CSSProperties
      }
    >
      <div className="shop-paper" aria-hidden="true" />
      <header className="shop-header">
        <span>{t("Dumpling Booth")}</span>
        <span className="header-rule" aria-hidden="true" />
        <span className="recipe-brand">Agora Recipes</span>
        <div className="header-actions">
          <LanguageSwitcher />
          <Button
            variant="ghost"
            size="icon"
            data-audio-devices-trigger
            aria-label={t("Audio devices")}
            disabled={!view || active}
            onClick={onDevices}
          >
            <SlidersHorizontal />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              motion.reduced
                ? t("Reduced motion")
                : motion.enabled
                  ? t("Pause motion")
                  : t("Enable motion")
            }
            aria-pressed={!motion.enabled || motion.reduced}
            disabled={motion.reduced}
            onClick={motion.toggle}
          >
            {motion.enabled && !motion.reduced ? <Pause /> : <Play />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Full screen")}
            onClick={onFullscreen}
          >
            <Maximize />
          </Button>
        </div>
      </header>
      <section className="shop-stage" aria-label={t("Experience")}>
        <div className="shop-story">
          <h1
            className={cn(
              "shop-heading",
              result && "gift-heading",
              result && words(result.gift).length > 16 && "gift-heading-long",
            )}
          >
            {heading}
          </h1>
          <p className="shop-english">{subtitle}</p>
          {(state === "chatting" || state === "gifted") && !result && (
            <p
              className="host-status"
              role="status"
              aria-label={t("Host activity")}
              aria-live="polite"
            >
              <span className="activity-mark" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>
                {t(
                  {
                    listening: "Listening",
                    thinking: "Thinking",
                    speaking: "Speaking",
                  }[turn] as "Listening" | "Thinking" | "Speaking",
                )}
              </span>
            </p>
          )}
          {["chatting", "gifted", "announcing"].includes(state) && (
            <ChallengeTimer
              seconds={seconds}
              appearance={appearance}
              compact={!!result}
            />
          )}
          {welcome && prepared && (
            <div className="waiting-notice" role="status">
              <span>
                {t("Take a seat. A staff member will get you started.")}
              </span>
            </div>
          )}
          {welcome && view && !prepared && (
            <div
              className="audio-setup"
              role="group"
              aria-label={t("Staff setup")}
            >
              {audioSettings}
              <div>
                <Button onClick={onPrepare} disabled={preparing || busy}>
                  <Volume2 data-icon="inline-start" />
                  {preparing ? t("Preparing…") : t("Set up audio")}
                </Button>
                {view.mode === "rehearsal" && (
                  <Button
                    variant="outline"
                    onClick={onSilent}
                    disabled={preparing || busy}
                  >
                    <VolumeX data-icon="inline-start" />
                    {t("Test without audio")}
                  </Button>
                )}
              </div>
            </div>
          )}
          {talkControl}
          {result && (
            <div className="gift-reveal">
              <GiftArtwork
                rank={result.rank}
                appearance={appearance}
                giftCount={view!.gifts.length}
              />
              <p>{t("Ask a staff member for your gift.")}</p>
            </div>
          )}
          {cancelled && (
            <p className="staff-message">{t("We'll be with you shortly.")}</p>
          )}
          {!view && <Skeleton className="h-12 w-3/4" />}
        </div>
        <div className="host-scene" data-pose={pose} ref={motion.ref}>
          <div className="host-figure" key={pose}>
            <Artwork
              src={appearance.hosts[pose]}
              fallback={defaultAppearance.hosts[pose]}
              alt={t("Your host welcomes you to her dumpling shop.")}
              className="host-art"
            />
          </div>
          {welcome && (
            <div className="host-bubble" aria-hidden="true">
              <Artwork
                src={appearance.bubble}
                fallback={defaultAppearance.bubble}
                alt=""
                className="bubble-art"
              />
              <p>
                <IdleInvitation
                  moving={ambient}
                  lines={appearance.idleInvitations}
                />
              </p>
            </div>
          )}
          {welcome && view && (
            <div
              className="waiting-clock"
              role="img"
              aria-label={t("Duration: {seconds} seconds", {
                seconds: view.demoSeconds,
              })}
            >
              <Artwork
                src={appearance.clock}
                fallback={defaultAppearance.clock}
                alt=""
                className="clock-art"
              />
              <span>
                <strong>
                  {view.demoSeconds % 60 === 0
                    ? view.demoSeconds / 60
                    : view.demoSeconds}
                </strong>
                <small>
                  {view.demoSeconds % 60 === 0 ? t("MIN") : t("SEC")}
                </small>
              </span>
            </div>
          )}
        </div>
      </section>
      {welcome && view ? (
        <GiftShelf view={view} appearance={appearance} />
      ) : active ? (
        <CaptionRack
          key={session!.id}
          entries={
            state === "announcing"
              ? entries.slice(-1)
              : result
                ? entries.filter((entry) => entry.text !== result.closing)
                : entries
          }
        />
      ) : !result ? (
        <section className="closing-note" aria-label={t("Reception notice")}>
          <p>
            {t(
              cancelled
                ? "We’ll be here when you’re ready."
                : "Come have a chat.",
            )}
          </p>
          <span>
            {cancelled
              ? t("Come back for a chat anytime.")
              : t("Come on over. Let's talk.")}
          </span>
        </section>
      ) : null}
      <footer className="shop-footer">
        <span>
          {t("English / Mandarin")} <span aria-hidden="true">·</span>{" "}
          {t("Conversations aren’t recorded")}
        </span>
        <span className="display-context">
          {view && (
            <Badge variant="outline">{modeLabel(locale, view.mode)}</Badge>
          )}
          {session?.driver === "demo" && <span>{t("Demo mode")}</span>}
          {prepared === "silent" && <span>{t("Silent")}</span>}
          {(welcome || result) && (
            <span>{t("Actual gifts may differ from the pictures")}</span>
          )}
        </span>
      </footer>
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {result &&
          `${resultRank}: ${words(result.gift)}. ${t("Ask a staff member for your gift.")} ${session?.announcement === "fallback" ? t("Ask a staff member for help") : ""}`}
      </div>
      {error && (
        <Alert className="display-alert" variant="destructive">
          <AlertTitle>{t("Ask a staff member for help")}</AlertTitle>
          <AlertDescription>{text(error)}</AlertDescription>
        </Alert>
      )}
    </main>
  );
}
