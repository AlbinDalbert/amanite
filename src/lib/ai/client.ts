import { invoke } from "@tauri-apps/api/core";
import type { AiSettings } from "@/app/useAiSettings";

export type AiToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type AiChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: AiToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

export type AiAssistantMessage = {
  content: string | null;
  tool_calls: AiToolCall[];
};

export type AiTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

function hasTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

async function invokeAi<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!hasTauriRuntime()) {
    throw new Error("AI connections are available in the Amanite desktop app.");
  }
  return invoke<T>(command, args);
}

export const aiClient = {
  listModels: (settings: Pick<AiSettings, "endpoint" | "apiKey">) =>
    invokeAi<string[]>("ai_list_models", {
      endpoint: settings.endpoint,
      apiKey: settings.apiKey
    }),
  chat: (settings: AiSettings, messages: AiChatMessage[], tools: AiTool[] = []) =>
    invokeAi<AiAssistantMessage>("ai_chat", {
      endpoint: settings.endpoint,
      apiKey: settings.apiKey,
      model: settings.model,
      messages,
      tools
    })
};
