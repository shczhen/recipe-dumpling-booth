import { afterEach, expect, test, vi } from "vitest";
import { createApi } from "../src/server/api";
import { DumplingService } from "../src/server/service";
import { localStore } from "../src/server/store";
import { gameDefinitions } from "../src/shared/games";

const stores: ReturnType<typeof localStore>[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
async function booth(gameId?: string, random = (max: number) => 0 % max) {
  const store = localStore(":memory:");
  stores.push(store);
  const service = new DumplingService(store, { random });
  await service.init();
  const api = createApi(service, { deployment: "local" });
  const post = (path: string, body: unknown) =>
    api(
      new Request(`http://localhost/api/${path}`, {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );
  await post("command", { type: "display", displayId: "tv", prepared: true });
  const start = await post("command", {
    type: "start",
    requestId: "start",
    driver: "demo",
    language: "en",
    gameId,
  });
  return { post, service, start };
}

test.each(
  gameDefinitions.flatMap(({ id }, index) =>
    [undefined, "random"].map((selection) => ({ id, index, selection })),
  ),
)(
  "$selection chooses $id once through the start API",
  async ({ id, index, selection }) => {
    const random = vi.fn((max: number) => index % max);
    const { start, post, service } = await booth(selection, random);
    expect(start.status).toBe(200);
    const { session } = await start.json();
    expect(session.gameId).toBe(id);
    expect(session).not.toHaveProperty("game");
    const calls = random.mock.calls.length;
    await post("command", {
      type: "start",
      requestId: "start",
      driver: "demo",
      language: "en",
      gameId: "wrong-answers",
    });
    expect((await service.snapshot()).session?.id).toBe(session.id);
    expect((await service.snapshot()).session?.gameId).toBe(id);
    expect(random.mock.calls.length).toBe(calls);
  },
);

test.each(gameDefinitions)(
  "staff can explicitly select $id",
  async ({ id }) => {
    const { start, service } = await booth(id);
    expect(start.status).toBe(200);
    expect((await service.snapshot()).session?.gameId).toBe(id);
  },
);

test("old game IDs and per-turn experimental endpoints are not part of the recipe API", async () => {
  const { post, start } = await booth("retired-experiment");
  expect(start.status).toBe(400);
  for (const path of ["rehearse", "game-action", "game-turn"]) {
    expect((await post(path, {})).status).toBe(404);
  }
  expect(
    (
      await post("command", {
        type: "game-complete",
        sessionId: "old",
        displayId: "tv",
      })
    ).status,
  ).toBe(400);
});
