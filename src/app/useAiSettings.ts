import { useEffect, useState } from "react";

export type AiSettings = {
  endpoint: string;
  apiKey: string;
  model: string;
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  endpoint: "",
  apiKey: "",
  model: ""
};

const SETTINGS_KEY = "amanite.ai.v1";

function readSettings(): AiSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<AiSettings> | null;
    return {
      endpoint: typeof stored?.endpoint === "string" ? stored.endpoint : "",
      apiKey: typeof stored?.apiKey === "string" ? stored.apiKey : "",
      model: typeof stored?.model === "string" ? stored.model : ""
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export function useAiSettings() {
  const [settings, setSettings] = useState<AiSettings>(readSettings);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // The active connection still works when persistence is unavailable.
    }
  }, [settings]);

  return { settings, setSettings };
}
