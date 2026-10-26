import { createFileRoute } from "@tanstack/react-router";
import { getApi } from "../server/runtime";
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: async ({ request }) => (await getApi())(request),
      POST: async ({ request }) => (await getApi())(request),
    },
  },
});
