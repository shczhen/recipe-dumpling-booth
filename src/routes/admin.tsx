import { createFileRoute } from "@tanstack/react-router";
import { Admin } from "../views/admin";
export const Route = createFileRoute("/admin")({ component: Admin });
