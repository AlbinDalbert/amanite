import { beforeEach, describe, expect, it } from "vitest";
import { persistAiSettings, readAiSettings } from "./useAiSettings";

describe("AI settings persistence", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  };

  beforeEach(() => values.clear());

  it("discards a key from legacy settings but keeps the endpoint and model", () => {
    storage.setItem("amanite.ai.v1", JSON.stringify({
      endpoint: "http://localhost:11434/v1",
      apiKey: "paid-secret",
      model: "local-model"
    }));

    expect(readAiSettings(storage)).toEqual({
      endpoint: "http://localhost:11434/v1",
      apiKey: "",
      model: "local-model"
    });
  });

  it("never writes the session key to storage", () => {
    persistAiSettings({
      endpoint: "https://models.example/v1",
      apiKey: "paid-secret",
      model: "writer"
    }, storage);

    expect(JSON.parse(storage.getItem("amanite.ai.v1") ?? "null")).toEqual({
      endpoint: "https://models.example/v1",
      model: "writer"
    });
    expect(storage.getItem("amanite.ai.v1")).not.toContain("paid-secret");
  });
});
