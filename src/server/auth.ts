import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
export type Role = "admin" | "display";
export interface AccessConfig {
  deployment: "local" | "online";
  secret?: string;
  adminPasscode?: string;
  displayPasscode?: string;
}
const localSecret = randomBytes(32).toString("hex");
const equal = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export function access(config: AccessConfig) {
  const secret = config.secret ?? localSecret;
  const sign = (value: string) =>
    createHmac("sha256", secret).update(value).digest("hex");
  return {
    role(request: Request): Role | undefined {
      if (
        config.deployment === "local" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(
          new URL(request.url).hostname,
        )
      )
        return "admin";
      const token = request.headers
        .get("cookie")
        ?.split("; ")
        .find((c) => c.startsWith("dumpling="))
        ?.slice(9);
      if (!token) return;
      const [role, expires, signature] = token.split(".");
      if (
        (role !== "admin" && role !== "display") ||
        !expires ||
        !signature ||
        Date.now() > Number(expires)
      )
        return;
      return equal(signature, sign(`${role}.${expires}`)) ? role : undefined;
    },
    login(role: Role, passcode: string, secure: boolean) {
      const expected =
        role === "admin" ? config.adminPasscode : config.displayPasscode;
      if (!expected || !equal(passcode, expected)) return;
      const payload = `${role}.${Date.now() + 12 * 3600_000}`;
      return `dumpling=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure ? "; Secure" : ""}`;
    },
  };
}
