import { createContext, type FormEvent, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import type { AiSettings } from "@/app/useAiSettings";
import Icon from "@/components/ui/Icon";
import { aiClient, type AiChatMessage } from "@/lib/ai/client";
import { executeWorkspaceTool, FRACTAL_AI_TOOLS, type AiWorkspace, workspaceSystemPrompt } from "@/lib/ai/workspaceTools";
import MarkdownContent from "./MarkdownContent";

type ChatEntry = { id: number; role: "assistant" | "user"; content: string };

type BorealisSession = {
  configured: boolean;
  draft: string;
  error: string | null;
  isSending: boolean;
  messages: ChatEntry[];
  model: string;
  send: (event?: FormEvent) => Promise<void>;
  setDraft: (draft: string) => void;
  startNewChat: () => void;
};

const BorealisSessionContext = createContext<BorealisSession | null>(null);

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function BorealisSessionProvider({ children, settings, workspace }: {
  children: ReactNode;
  settings: AiSettings;
  workspace: AiWorkspace;
}) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const nextId = useRef(1);
  const conversationRef = useRef<AiChatMessage[]>([]);
  const workspaceRef = useRef(workspace);
  const configured = Boolean(settings.endpoint.trim() && settings.model);
  workspaceRef.current = workspace;

  function startNewChat() {
    if (isSending) return;
    conversationRef.current = [];
    nextId.current = 1;
    setMessages([]);
    setDraft("");
    setError(null);
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || isSending || !configured) return;

    const userMessage: ChatEntry = { id: nextId.current++, role: "user", content };
    const userRequest: AiChatMessage = { role: "user", content };
    const requestMessages = [...conversationRef.current, userRequest];
    conversationRef.current = requestMessages;
    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setError(null);
    setIsSending(true);
    try {
      const workingMessages = [...requestMessages];
      let finalReply: string | null = null;
      for (let round = 0; round < 8; round += 1) {
        const reply = await aiClient.chat(
          settings,
          [{ role: "system", content: workspaceSystemPrompt(workspaceRef.current) }, ...workingMessages],
          FRACTAL_AI_TOOLS
        );
        workingMessages.push({
          role: "assistant",
          content: reply.content,
          ...(reply.tool_calls.length ? { tool_calls: reply.tool_calls } : {})
        });
        if (!reply.tool_calls.length) {
          finalReply = reply.content?.trim() || null;
          break;
        }
        for (const call of reply.tool_calls) {
          workingMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: await executeWorkspaceTool(call, workspaceRef.current)
          });
        }
      }
      if (!finalReply) throw new Error("Borealis did not finish after several tool calls.");
      conversationRef.current = workingMessages;
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", content: finalReply }]);
    } catch (sendError) {
      conversationRef.current = requestMessages;
      setError(messageFromError(sendError));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <BorealisSessionContext.Provider value={{ configured, draft, error, isSending, messages, model: settings.model, send, setDraft, startNewChat }}>
      {children}
    </BorealisSessionContext.Provider>
  );
}

function useBorealisSession() {
  const session = useContext(BorealisSessionContext);
  if (!session) throw new Error("BorealisChat must be rendered inside BorealisSessionProvider.");
  return session;
}

export function BorealisTrigger({ isOpen, isWorkspace = false, onClick }: { isOpen: boolean; isWorkspace?: boolean; onClick: () => void }) {
  const action = isWorkspace ? "Focus Borealis" : isOpen ? "Close Borealis" : "Open Borealis";
  return (
    <button
      aria-expanded={isOpen}
      aria-label={action}
      className="ai-chat-trigger"
      onClick={onClick}
      title={action}
      type="button"
    >
      <span className="ai-chat-trigger-mark" aria-hidden="true"><i /><i /><i /></span>
      <span className="ai-chat-trigger-label">Borealis</span>
    </button>
  );
}

type ChatProps = {
  hidden?: boolean;
  isOpen?: boolean;
  onMaximize?: () => void;
  onOpenChange?: (open: boolean) => void;
  onOpenSettings: () => void;
  presentation?: "popover" | "workspace";
  showTrigger?: boolean;
};

function BorealisChat({ hidden = false, isOpen: controlledOpen, onMaximize, onOpenChange, onOpenSettings, presentation = "popover", showTrigger = true }: ChatProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const isOpen = controlledOpen ?? localOpen;
  const session = useBorealisSession();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const visible = presentation === "workspace" || isOpen;
  const setIsOpen = (open: boolean) => {
    if (controlledOpen === undefined) setLocalOpen(open);
    onOpenChange?.(open);
  };

  useEffect(() => {
    if (visible) inputRef.current?.focus();
  }, [visible]);

  useEffect(() => {
    if (visible) transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [session.messages, session.isSending, visible]);

  const panel = (
    <section aria-label="Borealis chat" className={`ai-chat-panel${presentation === "workspace" ? " ai-chat-workspace" : ""}`}>
      <header className="ai-chat-header">
        <div>
          <span className="ai-chat-status" aria-hidden="true" />
          <p>Borealis</p>
          <small>{session.configured ? session.model : "Connection needed"}</small>
        </div>
        <div className="ai-chat-header-actions">
          <button aria-label="Start a new chat" disabled={session.isSending || (!session.messages.length && !session.error && !session.draft)} onClick={session.startNewChat} title="Start a new chat" type="button">
            <Icon name="restart" size={16} />
          </button>
          {presentation === "popover" && onMaximize ? (
            <button
              aria-label="Open Borealis in the workspace"
              onClick={(event) => {
                event.currentTarget.blur();
                requestAnimationFrame(onMaximize);
              }}
              type="button"
            >
              <Icon name="maximize" size={15} />
            </button>
          ) : null}
          {presentation === "popover" ? (
            <button aria-label="Close Borealis" onClick={() => setIsOpen(false)} title="Close Borealis" type="button">
              <Icon name="close" size={17} />
            </button>
          ) : null}
        </div>
      </header>

      <div aria-live="polite" className="ai-chat-transcript" ref={transcriptRef}>
        {!session.configured ? (
          <div className="ai-chat-empty">
            <span className="ai-chat-glyph" aria-hidden="true"><i /><i /><i /></span>
            <h2>Connect Borealis</h2>
            <p>Add an OpenAI-compatible endpoint, then choose one of its models.</p>
            <button onClick={onOpenSettings} type="button">Open settings</button>
          </div>
        ) : session.messages.length === 0 ? (
          <div className="ai-chat-empty">
            <span className="ai-chat-glyph" aria-hidden="true"><i /><i /><i /></span>
            <h2>Start here</h2>
            <p>This conversation stays in memory until Amanite closes.</p>
          </div>
        ) : null}

        {session.messages.map((message) => (
          <article className={`ai-chat-message ${message.role}`} key={message.id}>
            <span>{message.role === "user" ? "You" : "Borealis"}</span>
            {message.role === "assistant" ? <MarkdownContent content={message.content} /> : <p className="ai-chat-message-content">{message.content}</p>}
          </article>
        ))}
        {session.isSending ? <div className="ai-chat-thinking" aria-label="Borealis is responding"><i /><i /><i /></div> : null}
        {session.error ? <p className="ai-chat-error" role="alert">{session.error}</p> : null}
      </div>

      <form className="ai-chat-compose" onSubmit={(event) => void session.send(event)}>
        <textarea
          aria-label="Message"
          disabled={!session.configured || session.isSending}
          onChange={(event) => session.setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void session.send();
            }
          }}
          placeholder={session.configured ? "Ask Borealis something…" : "Configure Borealis in settings"}
          ref={inputRef}
          rows={2}
          value={session.draft}
        />
        <button aria-label="Send message" disabled={!session.draft.trim() || session.isSending || !session.configured} title="Send message" type="submit">
          <Icon name="arrow-up" size={18} />
        </button>
        <small>Enter to send · Shift+Enter for a new line</small>
      </form>
    </section>
  );

  if (presentation === "workspace") return panel;

  return (
    <div className={`ai-chat-dock ${isOpen ? "open" : ""}`} hidden={hidden}>
      {isOpen ? panel : null}
      {showTrigger ? <BorealisTrigger isOpen={isOpen} onClick={() => setIsOpen(!isOpen)} /> : null}
    </div>
  );
}

export default BorealisChat;
