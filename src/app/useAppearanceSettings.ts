import { useEffect, useState } from "react";

export type ColorTheme = "system" | "ember" | "moss" | "ink";
export type DocumentFont = "literary" | "book" | "sans";
export type LogoMark = "facet" | "cap" | "spore" | "sigil";
type LegacyParagraphStyle = "spaced" | "indented" | "both";

export type AppearanceSettings = {
  autoSave: boolean;
  colorTheme: ColorTheme;
  documentFont: DocumentFont;
  lineHeight: number;
  logoMark: LogoMark;
  noiseIntensity: number;
  pageWidth: number;
  paragraphIndent: boolean;
  paragraphSpace: boolean;
  restoreLastSession: boolean;
  spellCheck: boolean;
  textScale: number;
  uiScale: number;
  wordGoal: number;
};

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  autoSave: true,
  colorTheme: "ember",
  documentFont: "literary",
  lineHeight: 1.72,
  logoMark: "spore",
  noiseIntensity: 0.16,
  pageWidth: 760,
  paragraphIndent: false,
  paragraphSpace: true,
  restoreLastSession: true,
  spellCheck: true,
  textScale: 1,
  uiScale: 1,
  wordGoal: 0
};

const SETTINGS_KEY = "amanite.appearance.v1";
type StoredAppearanceSettings = Partial<AppearanceSettings> & { paragraphStyle?: LegacyParagraphStyle };

function clamp(value: unknown, minimum: number, maximum: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function readSettings(): AppearanceSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as StoredAppearanceSettings | null;
    if (!stored) return DEFAULT_APPEARANCE_SETTINGS;
    const legacyParagraphStyle = stored.paragraphStyle;
    return {
      autoSave: stored.autoSave !== false,
      colorTheme: stored.colorTheme === "system" || stored.colorTheme === "moss" || stored.colorTheme === "ink" ? stored.colorTheme : "ember",
      documentFont: stored.documentFont === "book" || stored.documentFont === "sans" ? stored.documentFont : "literary",
      lineHeight: clamp(stored.lineHeight, 1.35, 2.1, 1.72),
      logoMark: stored.logoMark === "facet" || stored.logoMark === "cap" || stored.logoMark === "sigil" ? stored.logoMark : "spore",
      noiseIntensity: clamp(stored.noiseIntensity, 0, 0.6, 0.16),
      pageWidth: clamp(stored.pageWidth, 560, 960, 760),
      paragraphIndent: typeof stored.paragraphIndent === "boolean"
        ? stored.paragraphIndent
        : legacyParagraphStyle === "indented" || legacyParagraphStyle === "both",
      paragraphSpace: typeof stored.paragraphSpace === "boolean"
        ? stored.paragraphSpace
        : legacyParagraphStyle ? legacyParagraphStyle === "spaced" || legacyParagraphStyle === "both" : true,
      restoreLastSession: stored.restoreLastSession !== false,
      spellCheck: stored.spellCheck !== false,
      textScale: clamp(stored.textScale, 0.85, 1.35, 1),
      uiScale: clamp(stored.uiScale, 0.85, 1.2, 1),
      wordGoal: clamp(stored.wordGoal, 0, 100000, 0)
    };
  } catch {
    return DEFAULT_APPEARANCE_SETTINGS;
  }
}

export function useAppearanceSettings() {
  const [settings, setSettings] = useState<AppearanceSettings>(readSettings);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.colorTheme = settings.colorTheme;
    root.dataset.documentFont = settings.documentFont;
    root.style.fontSize = `${16 * settings.uiScale}px`;
    root.style.setProperty("--document-text-size", `${1.17 * settings.textScale}rem`);
    root.style.setProperty("--document-line-height", String(settings.lineHeight));
    root.style.setProperty("--document-page-width", `${settings.pageWidth}px`);
    root.style.setProperty("--document-paragraph-gap", settings.paragraphSpace ? "1em" : "0");
    root.style.setProperty("--document-paragraph-indent", settings.paragraphIndent ? "1.75em" : "0");
    root.style.setProperty("--noise-opacity", String(settings.noiseIntensity));
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // The active settings still apply when persistence is unavailable.
    }
  }, [settings]);

  return { settings, setSettings };
}
