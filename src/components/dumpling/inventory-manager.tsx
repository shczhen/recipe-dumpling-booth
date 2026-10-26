import { operationLabel } from "@/i18n/operation";
import { modeLabel } from "@/i18n/locale";
import { useI18n } from "@/i18n/provider";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { apiCall } from "@/lib/client";
import {
  availableCount,
  batches,
  isActive,
  modeNames,
  type Checkpoint,
  type Command,
  type Snapshot,
  type Store,
} from "@/shared/model";

type Draft = {
  gifts: Snapshot["gifts"];
  available: number[];
  batchPlan: number[][];
  revision: number;
};
type Recovery = Checkpoint & { store: Store };
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "That didn't work. Please try again.";

export function InventoryManager({
  view,
  busy,
  command,
  panel,
  visible,
}: {
  view: Snapshot;
  panel: "inventory" | "recovery";
  visible: boolean;
  busy: boolean;
  command(command: Command): Promise<Snapshot | undefined>;
}) {
  const { locale, t, text, words, tag } = useI18n();
  const [draft, setDraft] = useState<Draft>();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [limit, setLimit] = useState(10);
  const [points, setPoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [resetRevision, setResetRevision] = useState<number>();
  const [recovery, setRecovery] = useState<Recovery>();
  const [restoreRevision, setRestoreRevision] = useState(0);
  const [confirmation, setConfirmation] = useState("");
  const [operationReason, setOperationReason] = useState("");
  const active = isActive(view.session);
  const locked = active || busy || pending;
  const revision = view.pool.revision ?? 0;
  const plan = view.pool.batchPlan ?? view.batchSchedule ?? batches;
  const future = plan.slice(view.pool.openedBatch);
  const restored = recovery
    ? structuredClone(recovery.store.pools[view.mode])
    : undefined;
  let unsettled = 0;
  for (const session of restored?.sessions ?? []) {
    if (!isActive(session) || session.result || session.startedAt === undefined)
      continue;
    const known = view.pool.sessions.find((s) => s.id === session.id)?.result;
    if (known) {
      restored!.available[known.rank - 1]!--;
      restored!.allocated[known.rank - 1]!++;
    } else unsettled++;
  }
  async function load(older = false) {
    setLoading(true);
    try {
      const before = older ? points.at(-1)?.id : undefined;
      const data = await apiCall<{ checkpoints: Checkpoint[] }>(
        `checkpoints${before ? `?before=${before}` : ""}`,
      );
      setPoints((old) =>
        older ? [...old, ...data.checkpoints] : data.checkpoints,
      );
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (visible && panel === "recovery") void load();
  }, [visible, panel, view.mode, revision, view.session?.status]);
  async function choose(point: Checkpoint) {
    setPending(true);
    setMessage("");
    try {
      const detail = await apiCall<Recovery>(`checkpoint?id=${point.id}`);
      setRecovery(detail);
      setRestoreRevision(revision);
      setConfirmation("");
      setOperationReason("");
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      {message && (
        <p role="status" className="mb-4 text-sm">
          {text(message)}
        </p>
      )}
      <div hidden={panel !== "inventory"}>
        <Card>
          <CardHeader>
            <CardTitle>{t("Gift inventory")}</CardTitle>
            <CardDescription>
              {t(
                "{available} available · {allocated} allocated · {opened}/{total} batches open",
                {
                  available: availableCount(view.pool),
                  allocated: view.pool.allocated.reduce((a, b) => a + b, 0),
                  opened: view.pool.openedBatch,
                  total: plan.length,
                },
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!draft ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={locked}
                  onClick={() => {
                    setDraft({
                      gifts: structuredClone(view.gifts),
                      available: [...view.pool.available],
                      batchPlan: structuredClone(plan),
                      revision,
                    });
                    setReason("");
                    setMessage("");
                  }}
                >
                  {t("Edit gifts and inventory")}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      disabled={locked || view.pool.openedBatch >= plan.length}
                    >
                      {view.pool.openedBatch >= plan.length
                        ? t("All batches are open")
                        : t("Open batch {batch} (add {count})", {
                            batch: view.pool.openedBatch + 1,
                            count:
                              plan[view.pool.openedBatch]?.reduce(
                                (a, b) => a + b,
                                0,
                              ) ?? 0,
                          })}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("Open the next gift batch?")}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t(
                          "Add this batch to the {mode} inventory. Any remaining gifts stay available. Each batch can only be opened once.",
                          { mode: modeLabel(locale, view.mode) },
                        )}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                      <AlertDialogAction
                        disabled={locked}
                        onClick={() =>
                          void command({
                            type: "batch",
                            expectedBatch: view.pool.openedBatch + 1,
                          })
                        }
                      >
                        {t("Open batch")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ) : (
              <form
                className="flex flex-col gap-4"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setPending(true);
                  try {
                    const saved = await command({
                      type: "inventory",
                      mode: view.mode,
                      expectedRevision: draft.revision,
                      gifts: draft.gifts,
                      available: draft.available,
                      batchPlan: draft.batchPlan,
                      reason,
                    });
                    if (saved) {
                      setDraft(undefined);
                      setMessage(
                        "Saved. You can restore the inventory to before or after this change.",
                      );
                    }
                  } finally {
                    setPending(false);
                  }
                }}
              >
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("Tier")}</TableHead>
                        <TableHead>{t("Chinese name")}</TableHead>
                        <TableHead>{t("English name")}</TableHead>
                        <TableHead>{t("Available")}</TableHead>
                        {future.map((_, i) => (
                          <TableHead key={i}>
                            {t("Batch {batch}", {
                              batch: view.pool.openedBatch + i + 1,
                            })}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {draft.gifts.map((gift, rank) => (
                        <TableRow key={rank}>
                          <TableCell>
                            {t("Tier {tier}", { tier: rank + 1 })}
                          </TableCell>
                          {(["zh", "en"] as const).map((language) => (
                            <TableCell key={language}>
                              <Input
                                required
                                maxLength={60}
                                className="min-w-36"
                                aria-label={t("Tier {tier} {language} name", {
                                  tier: rank + 1,
                                  language: t(
                                    language === "zh" ? "Chinese" : "English",
                                  ),
                                })}
                                value={gift[language]}
                                onChange={(event) =>
                                  setDraft({
                                    ...draft,
                                    gifts: draft.gifts.map((g, i) =>
                                      i === rank
                                        ? {
                                            ...g,
                                            [language]: event.target.value,
                                          }
                                        : g,
                                    ),
                                  })
                                }
                              />
                            </TableCell>
                          ))}
                          <TableCell>
                            <Input
                              required
                              type="number"
                              min={0}
                              max={10000}
                              step={1}
                              className="w-24"
                              aria-label={t("Tier {tier} available stock", {
                                tier: rank + 1,
                              })}
                              value={draft.available[rank]}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  available: draft.available.map((n, i) =>
                                    i === rank ? event.target.valueAsNumber : n,
                                  ),
                                })
                              }
                            />
                          </TableCell>
                          {future.map((_, i) => {
                            const batch = view.pool.openedBatch + i;
                            return (
                              <TableCell key={batch}>
                                <Input
                                  required
                                  type="number"
                                  min={0}
                                  max={10000}
                                  step={1}
                                  className="w-24"
                                  aria-label={t(
                                    "Tier {tier} batch {batch} stock",
                                    { tier: rank + 1, batch: batch + 1 },
                                  )}
                                  value={draft.batchPlan[batch]![rank]}
                                  onChange={(event) =>
                                    setDraft({
                                      ...draft,
                                      batchPlan: draft.batchPlan.map(
                                        (row, b) =>
                                          b === batch
                                            ? row.map((n, r) =>
                                                r === rank
                                                  ? event.target.valueAsNumber
                                                  : n,
                                              )
                                            : row,
                                      ),
                                    })
                                  }
                                />
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <label className="text-sm">
                  {t("Adjustment reason")}
                  <Input
                    required
                    maxLength={120}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t(
                      "For example: stock count, 180 stickers remaining",
                    )}
                  />
                </label>
                {revision !== draft.revision && (
                  <p role="alert">
                    {t(
                      "The inventory changed while you were editing. Cancel this edit and check the latest counts.",
                    )}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={
                      locked || revision !== draft.revision || !reason.trim()
                    }
                  >
                    {t("Save inventory")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDraft(undefined)}
                  >
                    {t("Cancel editing")}
                  </Button>
                </div>
              </form>
            )}
            {!draft && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Gift")}</TableHead>
                    <TableHead>{t("Available")}</TableHead>
                    <TableHead>{t("Allocated")}</TableHead>
                    <TableHead>{t("Unopened")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.gifts.map((gift, i) => (
                    <TableRow key={i}>
                      <TableCell>{words(gift)}</TableCell>
                      <TableCell>{view.pool.available[i]}</TableCell>
                      <TableCell>{view.pool.allocated[i]}</TableCell>
                      <TableCell>
                        {future.reduce((sum, row) => sum + row[i]!, 0)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="text-xs text-muted-foreground">
              {t(
                "Allocated gifts are reserved for guests, even if they haven't been handed over yet. Make inventory changes between sessions.",
              )}
            </p>
          </CardContent>
        </Card>
      </div>
      <div hidden={panel !== "recovery"}>
        <Card>
          <CardHeader>
            <CardTitle>{t("Logs and recovery")}</CardTitle>
            <CardDescription>
              {t(
                "Important changes are saved as checkpoints. Restore and reset only affect the {mode} inventory.",
                { mode: modeLabel(locale, view.mode) },
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                disabled={locked}
                onClick={() => {
                  setResetRevision(revision);
                  setConfirmation("");
                  setOperationReason("");
                }}
              >
                {t("Reset {mode} inventory", {
                  mode: modeLabel(locale, view.mode),
                })}
              </Button>
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => void load()}
              >
                {t("Refresh logs")}
              </Button>
              <Button
                variant="outline"
                disabled={locked}
                onClick={async () => {
                  const saved = await command({
                    type: "checkpoint",
                    label: t("Saved by staff"),
                  });
                  if (saved) {
                    setMessage("Checkpoint saved.");
                    void load();
                  }
                }}
              >
                {t("Save checkpoint")}
              </Button>
              <Button variant="outline" asChild>
                <a href="/api/backup" download>
                  {t("Download backup")}
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href="/api/logs" download>
                  {t("Download operation log")}
                </a>
              </Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Time / ID")}</TableHead>
                    <TableHead>{t("Action")}</TableHead>
                    <TableHead>{t("Checkpoint")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {points.slice(0, limit).map((point) => (
                    <TableRow key={point.id}>
                      <TableCell className="whitespace-nowrap">
                        {new Date(point.createdAt).toLocaleString(tag)}
                        <br />#{point.id}
                      </TableCell>
                      <TableCell>
                        {operationLabel(locale, point.action)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={locked}
                            onClick={() => void choose(point)}
                          >
                            {t("Preview and restore")}
                          </Button>
                          <Button variant="ghost" size="sm" asChild>
                            <a href={`/api/checkpoint?id=${point.id}`} download>
                              {t("Download")}
                            </a>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {points.length >= limit && (
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => {
                  if (limit >= points.length) void load(true);
                  setLimit(limit + 10);
                }}
              >
                {t("Load more")}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
      <AlertDialog
        open={resetRevision !== undefined || !!recovery}
        onOpenChange={(open) => {
          if (!open && !pending) {
            setResetRevision(undefined);
            setRecovery(undefined);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {recovery
                ? t("Restore checkpoint #{id}?", { id: recovery.id })
                : t("Reset {mode} inventory?", {
                    mode: modeLabel(locale, view.mode),
                  })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {recovery
                ? t(
                    "Restore this inventory's stock counts, gift settings, and session history from the checkpoint. Later log entries will be kept. Old voice connections will be closed.",
                  )
                : t(
                    "Move all allocated gifts back into available stock and clear the session list. Gift settings and logs will be kept.",
                  )}{" "}
              {t(
                "Check any gifts already handed out before you continue. This only changes the records; it doesn't return the gifts. Other inventories are unaffected.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Tier")}</TableHead>
                <TableHead>{t("Available: now → after")}</TableHead>
                <TableHead>{t("Allocated: now → after")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.gifts.map((_, i) => (
                <TableRow key={i}>
                  <TableCell>{t("Tier {tier}", { tier: i + 1 })}</TableCell>
                  <TableCell>
                    {view.pool.available[i]} →{" "}
                    {restored
                      ? restored.available[i]
                      : view.pool.available[i]! + view.pool.allocated[i]!}
                  </TableCell>
                  <TableCell>
                    {view.pool.allocated[i]} →{" "}
                    {restored ? restored.allocated[i] : 0}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {unsettled > 0 && (
            <p className="text-sm" role="note">
              {t(
                "Gifts needed for unfinished sessions: {count}. Restoring this checkpoint will reserve one per guest. This isn't included in the preview above.",
                { count: unsettled },
              )}
            </p>
          )}
          {recovery && (
            <p className="text-sm">
              {t("Gifts after restore:")}{" "}
              {(recovery.store.pools[view.mode].gifts ?? view.gifts)
                .map(words)
                .join(locale === "zh" ? "、" : ", ")}
            </p>
          )}
          <label className="text-sm">
            {t("Type “{mode}” to confirm", {
              mode: modeLabel(locale, view.mode),
            })}
            <Input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              aria-label={t("Confirm inventory")}
            />
          </label>
          <label className="text-sm">
            {t("Reason for this change")}
            <Input
              maxLength={120}
              value={operationReason}
              onChange={(e) => setOperationReason(e.target.value)}
              aria-label={t("Reason for this change")}
            />
          </label>
          {message && (
            <p role="alert" className="text-sm">
              {text(message)}
            </p>
          )}
          {revision !== (recovery ? restoreRevision : resetRevision) && (
            <p role="alert">
              {t(
                "The inventory has changed. Cancel and check the latest counts.",
              )}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t("Cancel")}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={
                locked ||
                confirmation !== modeLabel(locale, view.mode) ||
                !operationReason.trim() ||
                revision !== (recovery ? restoreRevision : resetRevision)
              }
              onClick={async () => {
                setPending(true);
                setMessage("");
                try {
                  if (recovery)
                    await apiCall("restore", {
                      id: recovery.id,
                      mode: view.mode,
                      expectedRevision: restoreRevision,
                      confirmation: modeNames[view.mode],
                      reason: operationReason,
                    });
                  else if (
                    !(await command({
                      type: "reset",
                      mode: view.mode,
                      expectedRevision: resetRevision!,
                      confirmation: modeNames[view.mode],
                      reason: operationReason,
                    }))
                  )
                    return;
                  setResetRevision(undefined);
                  setRecovery(undefined);
                  setMessage("Done. The change has been logged.");
                  void load();
                } catch (error) {
                  setMessage(errorText(error));
                } finally {
                  setPending(false);
                }
              }}
            >
              {t(recovery ? "Confirm restore" : "Confirm reset")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
