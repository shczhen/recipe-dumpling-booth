import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/i18n/provider";

export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();
  return (
    <ToggleGroup
      className="language-switcher"
      aria-label="Interface language / 界面语言"
      type="single"
      size="sm"
      variant="outline"
      value={locale}
      onValueChange={(value) => {
        if (value === "en" || value === "zh") setLocale(value);
      }}
    >
      <ToggleGroupItem value="en" lang="en" aria-label="English">
        EN
      </ToggleGroupItem>
      <ToggleGroupItem value="zh" lang="zh-CN" aria-label="简体中文">
        中文
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
