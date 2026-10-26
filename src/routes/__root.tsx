import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import css from "../styles.css?url";
import { LocaleProvider, useI18n } from "@/i18n/provider";
import { LanguageSwitcher } from "@/components/dumpling/language-switcher";
import { useEffect, type ReactNode } from "react";

function Document({ children }: { children: ReactNode }) {
  const { locale, t } = useI18n();
  useEffect(() => {
    document.title = t("Dumpling Booth");
  }, [locale, t]);
  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
function RouteNotice({ missing = false }: { missing?: boolean }) {
  const { t } = useI18n();
  return (
    <main className="p-10">
      <LanguageSwitcher />
      <h1>{t(missing ? "Page not found" : "We couldn't load this page")}</h1>
      {!missing && (
        <p>
          {t(
            "Check that the app is running and your settings are correct, then refresh this page.",
          )}
        </p>
      )}
      <a href="/admin">{t("Back to staff controls")}</a>
    </main>
  );
}
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Dumpling Booth" },
    ],
    links: [{ rel: "stylesheet", href: css }],
  }),
  shellComponent: ({ children }) => (
    <LocaleProvider>
      <Document>{children}</Document>
    </LocaleProvider>
  ),
  component: Outlet,
  notFoundComponent: () => <RouteNotice missing />,
  errorComponent: () => <RouteNotice />,
});
