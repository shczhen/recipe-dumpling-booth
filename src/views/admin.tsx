import { LanguageSwitcher } from "@/components/dumpling/language-switcher";
import { modeLabel, statusLabel } from "@/i18n/locale";
import { useI18n } from "@/i18n/provider";
import {
  gameDefinitions,
  type GameSelection,
  definitionFor,
} from "@/shared/games";
import { InventoryManager } from "@/components/dumpling/inventory-manager";
import { useState } from "react";
import { Play, Square, SkipForward, Monitor, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Field, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDemoState,
  useClock,
  secondsLeft,
  timeLabel,
  broadcast,
} from "@/lib/client";
import {
  availableCount,
  isActive,
  type Driver,
  type Language,
  type Mode,
} from "@/shared/model";

const panels = {
  reception: "Reception",
  inventory: "Gift inventory",
  recovery: "Logs and recovery",
} as const;
type Panel = keyof typeof panels;

export function Admin() {
  const { locale, t, text, words, tag } = useI18n();
  const { view, error, busy, command } = useDemoState("admin");
  const [panel, setPanel] = useState<Panel>("reception");
  const [driver, setDriver] = useState<Driver>();
  const [gameId, setGameId] = useState<GameSelection>("random");
  const [language, setLanguage] = useState<Language>();
  const [input, setInput] = useState("");
  const now = useClock(view?.serverNow);
  if (!view)
    return (
      <main className="admin-shell">
        <h1>{t("Dumpling Booth · Staff")}</h1>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{text(error)}</AlertDescription>
          </Alert>
        )}
        <Skeleton className="h-64 w-full" />
      </main>
    );
  if (view.canManage === false)
    return (
      <main className="admin-shell">
        <h1>{t("Staff access required")}</h1>
        <Button asChild>
          <a href="/login?role=admin">{t("Staff sign in")}</a>
        </Button>
      </main>
    );
  const session = view.session;
  const active = isActive(session);
  const remaining = availableCount(view.pool);
  const selectedDriver =
    view.mode === "rehearsal"
      ? (session?.driver ?? driver ?? (view.agoraReady ? "agora" : "demo"))
      : "agora";
  const ready = view.display?.prepared && now - view.display.seenAt < 6000;
  const left = secondsLeft(session?.deadline, now, session?.duration ?? 120);
  const startBlocked = !ready
    ? t("Set up the microphone and speakers on the guest screen first.")
    : remaining === 0
      ? t("No gifts available. Open another batch or update the stock count.")
      : selectedDriver === "agora" && !view.agoraReady
        ? t(
            "Live voice isn't set up yet. Check your settings or switch to Demo mode.",
          )
        : selectedDriver === "agora" && !view.display?.audioReady
          ? t(
              "The guest screen is in silent mode. Set up audio before starting a live call.",
            )
          : "";
  const stop = () => {
    if (!session) return;
    broadcast({ type: "stop", sessionId: session.id });
    void command({ type: "cancel", sessionId: session.id, reason: "staff" });
  };
  const status =
    session?.status === "announcing" && session.announcementKind === "goodbye"
      ? t("Saying goodbye")
      : session
        ? statusLabel(locale, session.status)
        : t("Ready for the next guest");
  return (
    <main className="admin-shell">
      <header className="admin-header">
        <h1>
          {t("Dumpling Booth")}{" "}
          <span className="text-muted-foreground">{t("Staff controls")}</span>
        </h1>
        <div className="admin-header-actions">
          <LanguageSwitcher />
          <ToggleGroup
            aria-label={t("Inventory")}
            type="single"
            variant="outline"
            value={view.mode}
            disabled={active || busy}
            onValueChange={(mode) => {
              if (mode) void command({ type: "mode", mode: mode as Mode });
            }}
          >
            {view.modes.map((mode) => (
              <ToggleGroupItem key={mode} value={mode}>
                {modeLabel(locale, mode)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button variant="outline" asChild>
            <a href="/" target="dumpling-tv">
              <Monitor data-icon="inline-start" />
              {t("Open guest screen")}
            </a>
          </Button>
        </div>
      </header>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t("Couldn't complete that action")}</AlertTitle>
          <AlertDescription>{text(error)}</AlertDescription>
        </Alert>
      )}
      {view.recoveryWarning && (
        <Alert variant="destructive">
          <AlertDescription>{text(view.recoveryWarning)}</AlertDescription>
        </Alert>
      )}
      <nav className="admin-nav" aria-label={t("Staff tools")}>
        {(Object.entries(panels) as [Panel, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-current={panel === key ? "page" : undefined}
            onClick={() => setPanel(key)}
          >
            {text(label)}
          </button>
        ))}
      </nav>
      <div hidden={panel !== "reception"}>
        <Card>
          <CardHeader>
            <div className="admin-session-heading">
              <CardTitle>{status}</CardTitle>
              {active && ["chatting", "gifted"].includes(session!.status) && (
                <strong
                  className="admin-countdown"
                  aria-label={t("Session time remaining")}
                >
                  {timeLabel(left)}
                </strong>
              )}
              {!session && (
                <Badge variant={ready ? "secondary" : "outline"}>
                  {ready
                    ? t("Guest screen ready")
                    : t("Guest screen not ready")}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {!session && (
              <>
                <div className="admin-start-settings">
                  {view.mode === "rehearsal" && (
                    <Field>
                      <FieldLabel>{t("Session mode")}</FieldLabel>
                      <ToggleGroup
                        aria-label={t("Session mode")}
                        type="single"
                        variant="outline"
                        value={selectedDriver}
                        disabled={busy}
                        onValueChange={(value) => {
                          if (value === "demo" || value === "agora")
                            setDriver(value);
                        }}
                      >
                        <ToggleGroupItem value="agora">
                          {t("Live voice")}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="demo">
                          {t("Demo mode")}
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </Field>
                  )}
                  <Field>
                    <FieldLabel>{t("Greeting language")}</FieldLabel>
                    <ToggleGroup
                      aria-label={t("Greeting language")}
                      type="single"
                      variant="outline"
                      value={language ?? locale}
                      disabled={busy}
                      onValueChange={(value) => {
                        if (value === "zh" || value === "en")
                          setLanguage(value);
                      }}
                    >
                      <ToggleGroupItem value="zh">
                        {t("Mandarin")}
                      </ToggleGroupItem>
                      <ToggleGroupItem value="en">English</ToggleGroupItem>
                    </ToggleGroup>
                  </Field>
                </div>
                <Field>
                  <FieldLabel>{t("Game")}</FieldLabel>
                  <ToggleGroup
                    aria-label={t("Game")}
                    type="single"
                    variant="outline"
                    value={gameId}
                    disabled={busy}
                    className="flex flex-wrap justify-start"
                    onValueChange={(value) => {
                      if (
                        value === "random" ||
                        gameDefinitions.some((game) => game.id === value)
                      )
                        setGameId(value as GameSelection);
                    }}
                  >
                    <ToggleGroupItem value="random">
                      {t("Random game")}
                    </ToggleGroupItem>
                    {gameDefinitions.map((game) => (
                      <ToggleGroupItem key={game.id} value={game.id}>
                        {locale === "en" ? game.en : game.name}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>
                {selectedDriver === "demo" && (
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "Try the full flow with scripted replies and your browser's voice.",
                    )}
                  </p>
                )}
                {startBlocked && (
                  <p role="status" className="text-sm text-muted-foreground">
                    {startBlocked}
                  </p>
                )}
              </>
            )}
            {session && (
              <>
                {session.result ? (
                  <div className="admin-result">
                    <span>{t("This guest's gift")}</span>
                    <strong>{words(session.result.gift)}</strong>
                    <p>
                      {session.announcement === "fallback"
                        ? t(
                            "This gift is reserved. A staff member can hand it over.",
                          )
                        : session.giftRevealedAt || !active
                          ? t("Hand this gift to the current guest.")
                          : t(
                              "The gift is reserved. It will appear on the guest screen after the announcement.",
                            )}
                    </p>
                  </div>
                ) : session.status === "cancelled" ? (
                  <p className="text-muted-foreground">
                    {t("The greeting never started, so no gift was allocated.")}
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    {session.status === "connecting"
                      ? t(
                          "Connecting. The timer starts when the greeting plays.",
                        )
                      : t("The gift will be announced automatically.")}
                  </p>
                )}
                {session.gameId && (
                  <p className="text-sm">
                    {locale === "en"
                      ? definitionFor(session.gameId).en
                      : definitionFor(session.gameId).name}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {t("Session")} {session.id.slice(0, 8)} ·{" "}
                  {session.driver === "demo" ? t("Demo mode") : t("Live voice")}
                </p>
              </>
            )}
          </CardContent>
          <CardFooter className="flex flex-wrap gap-3">
            {!session ? (
              <Button
                size="lg"
                disabled={busy || !!startBlocked}
                onClick={() =>
                  void command({
                    type: "start",
                    requestId: crypto.randomUUID(),
                    driver: selectedDriver,
                    language: language ?? locale,
                    gameId,
                  })
                }
              >
                <Play data-icon="inline-start" />
                {t("Start session")}
              </Button>
            ) : active ? (
              <Button variant="destructive" size="lg" onClick={stop}>
                <Square data-icon="inline-start" />
                {t("Emergency stop")}
              </Button>
            ) : (
              <Button
                size="lg"
                disabled={busy}
                onClick={() =>
                  void command({ type: "next", sessionId: session.id })
                }
              >
                <SkipForward data-icon="inline-start" />
                {t("Next guest")}
              </Button>
            )}
            <span className="text-sm text-muted-foreground">
              {t("Gifts available: {count}", { count: remaining })}
            </span>
          </CardFooter>
        </Card>
        {session?.driver === "demo" && active && (
          <form
            className="admin-demo-input"
            onSubmit={(event) => {
              event.preventDefault();
              if (input.trim()) {
                broadcast({
                  type: "utterance",
                  sessionId: session.id,
                  text: input,
                });
                setInput("");
              }
            }}
          >
            <label htmlFor="demo-input">{t("Test message")}</label>
            <div className="flex gap-2">
              <Input
                id="demo-input"
                maxLength={1000}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t("Type a guest message")}
                disabled={!["chatting", "gifted"].includes(session.status)}
              />
              <Button
                type="submit"
                disabled={
                  !["chatting", "gifted"].includes(session.status) ||
                  !input.trim()
                }
              >
                <Mic data-icon="inline-start" />
                {t("Send")}
              </Button>
            </div>
          </form>
        )}
        <details className="admin-history">
          <summary>
            {t("Recent sessions ({count})", {
              count: Math.min(20, view.pool.sessions.length),
            })}
          </summary>
          {view.pool.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("No sessions yet.")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Time / Session")}</TableHead>
                  <TableHead>{t("Status")}</TableHead>
                  <TableHead>{t("Gift")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.pool.sessions
                  .slice(-20)
                  .reverse()
                  .map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        {new Date(s.createdAt).toLocaleTimeString(tag)}{" "}
                        <span className="text-xs text-muted-foreground">
                          {s.id.slice(0, 8)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {s.status === "announcing" &&
                        s.announcementKind === "goodbye"
                          ? t("Saying goodbye")
                          : statusLabel(locale, s.status)}
                      </TableCell>
                      <TableCell>
                        {s.result ? words(s.result.gift) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </details>
      </div>
      <div hidden={panel === "reception"}>
        <InventoryManager
          key={view.mode}
          view={view}
          busy={busy}
          command={command}
          panel={panel === "inventory" ? "inventory" : "recovery"}
          visible={panel !== "reception"}
        />
      </div>
    </main>
  );
}
