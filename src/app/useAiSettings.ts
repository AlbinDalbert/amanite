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

export function readAiSettings(storage: Pick<Storage, "getItem"> = localStorage): AiSettings {
  try {
    const stored = JSON.parse(storage.getItem(SETTINGS_KEY) ?? "null") as Partial<AiSettings> | null;
    return {
      endpoint: typeof stored?.endpoint === "string" ? stored.endpoint : "",
      apiKey: "",
      model: typeof stored?.model === "string" ? stored.model : ""
    };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export function persistAiSettings(
  settings: AiSettings,
  storage: Pick<Storage, "setItem"> = localStorage
) {
  storage.setItem(SETTINGS_KEY, JSON.stringify({
    endpoint: settings.endpoint,
    model: settings.model
  }));
}

export function useAiSettings() {
  const [settings, setSettings] = useState<AiSettings>(readAiSettings);

  useEffect(() => {
    try {
      persistAiSettings(settings);
    } catch {
      // The active connection still works when persistence is unavailable.
    }
  }, [settings]);

  return { settings, setSettings };
}
