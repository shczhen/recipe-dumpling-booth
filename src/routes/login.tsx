import { LanguageSwitcher } from "@/components/dumpling/language-switcher";
import { useI18n } from "@/i18n/provider";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { FieldGroup, Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiCall } from "@/lib/client";
export const Route = createFileRoute("/login")({ component: Login });
function Login() {
  const { t, text } = useI18n();
  const [role, setRole] = useState<"admin" | "display">("display");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("role") === "admin")
      setRole("admin");
  }, []);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="grid min-h-svh place-items-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <LanguageSwitcher />
          <CardTitle>{t("Dumpling Booth · Access code")}</CardTitle>
          <CardDescription>
            {t(
              "Choose the guest screen or staff controls, then enter the access code.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              try {
                await apiCall("login", { role, passcode });
                window.location.assign(role === "admin" ? "/admin" : "/");
              } catch {
                setError("Invalid code or service unavailable");
                setBusy(false);
              }
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel>{t("Entry")}</FieldLabel>
                <ToggleGroup
                  aria-label={t("Entry")}
                  type="single"
                  value={role}
                  onValueChange={(value) => {
                    if (value === "admin" || value === "display")
                      setRole(value);
                  }}
                  variant="outline"
                >
                  <ToggleGroupItem value="display">
                    {t("Guest display")}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="admin">
                    {t("Staff controls")}
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field data-invalid={!!error}>
                <FieldLabel htmlFor="passcode">{t("Access code")}</FieldLabel>
                <Input
                  id="passcode"
                  type="password"
                  autoComplete="current-password"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  required
                  aria-invalid={!!error}
                />
              </Field>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{text(error)}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={busy}>
                {busy ? t("Checking…") : t("Enter")}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
