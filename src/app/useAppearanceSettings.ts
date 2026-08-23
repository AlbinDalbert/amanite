import { useEffect, useState } from "react";

export type ColorTheme = "ember" | "moss" | "ink";
export type DocumentFont = "literary" | "book" | "sans";

export type AppearanceSettings = {
  colorTheme: ColorTheme;
  documentFont: DocumentFont;
  noiseIntensity: number;
  textScale: number;
  uiScale: number;
};

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  colorTheme: "ember",
  documentFont: "literary",
  noiseIntensity: 0.28,
  textScale: 1,
  uiScale: 1
};

const SETTINGS_KEY = "amanite.appearance.v1";

function clamp(value: unknown, minimum: number, maximum: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function readSettings(): AppearanceSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<AppearanceSettings> | null;
    if (!stored) return DEFAULT_APPEARANCE_SETTINGS;
    return {
      colorTheme: stored.colorTheme === "moss" || stored.colorTheme === "ink" ? stored.colorTheme : "ember",
      documentFont: stored.documentFont === "book" || stored.documentFont === "sans" ? stored.documentFont : "literary",
      noiseIntensity: clamp(stored.noiseIntensity, 0, 0.6, 0.28),
      textScale: clamp(stored.textScale, 0.85, 1.35, 1),
      uiScale: clamp(stored.uiScale, 0.85, 1.2, 1)
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
    root.style.setProperty("--noise-opacity", String(settings.noiseIntensity));
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // The active settings still apply when persistence is unavailable.
    }
  }, [settings]);

  return { settings, setSettings };
}
