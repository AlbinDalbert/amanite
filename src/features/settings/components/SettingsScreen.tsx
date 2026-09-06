import { useCallback, useEffect, useRef, useState } from "react";
import { APP_VERSION, FRACTAL_REVISION } from "@/app/appVersion";
import type { AiSettings } from "@/app/useAiSettings";
import { aiClient } from "@/lib/ai/client";
import {
  DEFAULT_APPEARANCE_SETTINGS,
  type AppearanceSettings,
  type ColorTheme,
  type DocumentFont,
  type LogoMark
} from "@/app/useAppearanceSettings";
import type { FractalMutationReceipt, FractalProjectInspection } from "@/lib/fractal/types";

type Props = {
  aiSettings: AiSettings;
  settings: AppearanceSettings;
  projectHealth?: ProjectHealth;
  onAiChange: (settings: AiSettings) => void;
  onChange: (settings: AppearanceSettings) => void;
  onClose: () => void;
};

type ProjectHealth = {
  projectName: string;
  projectRoot: string;
  pageCount: number;
  inspection: FractalProjectInspection | null;
  draftCount: number;
  hasUnsavedChanges: boolean;
  lastReceipt: FractalMutationReceipt | null;
  isBusy: boolean;
  onInspect: () => void;
  onRepair: () => void;
};

const THEMES: Array<{ id: ColorTheme; label: string; note: string }> = [
  { id: "system", label: "System", note: "Follow desktop light or dark" },
  { id: "ember", label: "Ember", note: "Warm amber and soot" },
  { id: "moss", label: "Moss", note: "Lichen green and bark" },
  { id: "ink", label: "Ink", note: "Blue black and silver" }
];

const FONTS: Array<{ id: DocumentFont; label: string; sample: string }> = [
  { id: "literary", label: "Literary", sample: "Cormorant Garamond" },
  { id: "book", label: "Book", sample: "Georgia" },
  { id: "sans", label: "Sans", sample: "Bricolage Grotesque" }
];

const LOGO_MARKS: Array<{ id: LogoMark; label: string; note: string }> = [
  { id: "facet", label: "Facet", note: "The original cut stone" },
  { id: "cap", label: "Cap", note: "A small forest silhouette" },
  { id: "spore", label: "Spore", note: "A drifting field of points" },
  { id: "sigil", label: "Sigil", note: "A sharp Amanite monogram" }
];

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatOperation(operation: string) {
  return operation.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function healthSummary(health: ProjectHealth) {
  if (!health.inspection) return { tone: "checking", title: "Health check pending", note: "Inspect the project files to see their current state." } as const;
  if (!health.inspection.openable) return { tone: "blocked", title: "Project needs recovery", note: "Amanite cannot safely continue until the project is recovered." } as const;
  if (!health.inspection.healthy) return { tone: "attention", title: "Project needs attention", note: `${health.inspection.issues.length} issue${health.inspection.issues.length === 1 ? "" : "s"} found in the project files.` } as const;
  return { tone: "healthy", title: "Project files look healthy", note: "Fractal found no structural issues in this project." } as const;
}

function ProjectHealthSection({ health }: { health: ProjectHealth }) {
  const summary = healthSummary(health);
  const inspection = health.inspection;
  const draftLabel = `${health.draftCount} recovery draft${health.draftCount === 1 ? "" : "s"}`;

  return (
    <fieldset className="settings-group project-health-settings">
      <legend>Project health</legend>
      <div aria-live="polite" className={`health-status-card ${summary.tone}`}>
        <span className="health-status-mark" aria-hidden="true">{summary.tone === "healthy" ? "✓" : summary.tone === "checking" ? "…" : "!"}</span>
        <span className="health-status-copy">
          <strong>{summary.title}</strong>
          <small>{summary.note}</small>
        </span>
        <button
          className="health-refresh"
          disabled={health.isBusy}
          onClick={health.onInspect}
          type="button"
        >
          {health.isBusy ? "Checking…" : "Recheck"}
        </button>
      </div>

      <div className="health-facts" aria-label="Project health details">
        <div className="health-fact">
          <span>Project</span>
          <strong title={health.projectRoot}>{health.projectName}</strong>
          <small>{health.pageCount} page{health.pageCount === 1 ? "" : "s"}</small>
        </div>
        <div className="health-fact">
          <span>Editor state</span>
          <strong>{health.hasUnsavedChanges ? "Unsaved edits" : "All changes saved"}</strong>
          <small>{health.hasUnsavedChanges ? "Save before closing" : "Ready to close"}</small>
        </div>
        <div className="health-fact">
          <span>Recovery</span>
          <strong>{health.draftCount ? "Drafts waiting" : "No drafts"}</strong>
          <small>{draftLabel}</small>
        </div>
      </div>

      {inspection?.issues.length ? (
        <div className="health-issues" aria-label="Project health issues">
          <p className="health-section-label">Issues found</p>
          <ul>
            {inspection.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                <span className="health-issue-mark" aria-hidden="true">!</span>
                <span>
                  {issue.path ? <code>{issue.path}</code> : null}
                  <small>{issue.message}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {inspection?.proposedRepairs.length ? (
        <div className="health-repair-row">
          <span>
            <strong>{inspection.proposedRepairs.length} repair{inspection.proposedRepairs.length === 1 ? "" : "s"} available</strong>
            <small>Review the proposed Fractal changes before applying them.</small>
          </span>
          <button className="health-repair-action" disabled={health.isBusy} onClick={health.onRepair} type="button">Review repairs</button>
        </div>
      ) : null}

      {health.lastReceipt ? (
        <div className="health-receipt">
          <span>Last session mutation</span>
          <strong>{formatOperation(health.lastReceipt.operation)}</strong>
          {health.lastReceipt.warnings.length ? <small>{health.lastReceipt.warnings[0].message}</small> : null}
        </div>
      ) : null}
    </fieldset>
  );
}

function SettingsScreen({ aiSettings, settings, projectHealth, onAiChange, onChange, onClose }: Props) {
  const [models, setModels] = useState<string[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const requestId = useRef(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  function patch(next: Partial<AppearanceSettings>) {
    onChange({ ...settings, ...next });
  }

  function patchAi(next: Partial<AiSettings>) {
    onAiChange({ ...aiSettings, ...next });
  }

  const loadModels = useCallback(async () => {
    if (!aiSettings.endpoint.trim()) return;
    const currentRequest = ++requestId.current;
    setIsLoadingModels(true);
    setModelError(null);
    try {
      const available = await aiClient.listModels(aiSettings);
      if (currentRequest !== requestId.current) return;
      setModels(available);
      if (!available.includes(aiSettings.model)) {
        onAiChange({ ...aiSettings, model: available[0] ?? "" });
      }
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      setModels([]);
      setModelError(error instanceof Error ? error.message : String(error));
    } finally {
      if (currentRequest === requestId.current) setIsLoadingModels(false);
    }
  }, [aiSettings, onAiChange]);

  useEffect(() => {
    if (!aiSettings.endpoint.trim()) {
      setModels([]);
      setModelError(null);
      return;
    }
    const timer = window.setTimeout(() => void loadModels(), 450);
    return () => window.clearTimeout(timer);
  }, [aiSettings.endpoint, aiSettings.apiKey, loadModels]);

  return (
    <div className="settings-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} role="presentation">
    <main aria-labelledby="settings-title" aria-modal="true" className="settings-screen" role="dialog">
      <header className="settings-titlebar">
        <div className="settings-brand">
          <span className={`brand-mark logo-${settings.logoMark}`} aria-hidden="true"><i /></span>
          <h1 id="settings-title">Settings</h1>
        </div>
        <button aria-label="Close settings" className="settings-back" onClick={onClose} ref={closeButtonRef} type="button">
          Close
        </button>
      </header>

      <div className="settings-layout">
        <section className="settings-sheet" aria-label="Application settings">
          <header className="settings-sheet-header">
            <p>Preferences</p>
            <span>Changes apply immediately</span>
          </header>

          {projectHealth ? <ProjectHealthSection health={projectHealth} /> : null}

          <fieldset className="settings-group ai-settings">
            <legend>Borealis connection</legend>
            <p className="settings-group-note">Use any server that implements the OpenAI models and chat completions APIs.</p>
            <label>
              <span><strong>Endpoint</strong><small>Include the server's /v1 path</small></span>
              <input
                aria-label="OpenAI-compatible endpoint"
                onChange={(event) => patchAi({ endpoint: event.currentTarget.value, model: "" })}
                placeholder="http://localhost:11434/v1"
                spellCheck={false}
                type="url"
                value={aiSettings.endpoint}
              />
            </label>
            <label>
              <span><strong>API key</strong><small>Kept in memory until Amanite closes</small></span>
              <input
                aria-label="API key"
                autoComplete="off"
                onChange={(event) => patchAi({ apiKey: event.currentTarget.value, model: "" })}
                placeholder="Not required"
                spellCheck={false}
                type="password"
                value={aiSettings.apiKey}
              />
            </label>
            <label>
              <span><strong>Model</strong><small>Reported by the models endpoint</small></span>
              <div className="ai-model-picker">
                <select
                  aria-label="AI model"
                  disabled={!models.length || isLoadingModels}
                  onChange={(event) => patchAi({ model: event.currentTarget.value })}
                  value={models.includes(aiSettings.model) ? aiSettings.model : ""}
                >
                  <option value="">{isLoadingModels ? "Loading models…" : models.length ? "Choose a model" : "No models loaded"}</option>
                  {models.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
                <button disabled={!aiSettings.endpoint.trim() || isLoadingModels} onClick={() => void loadModels()} type="button">
                  {isLoadingModels ? "Loading" : "Reload"}
                </button>
              </div>
            </label>
            {modelError ? <p className="ai-settings-error" role="alert">{modelError}</p> : null}
            {!modelError && models.length > 0 ? <p className="ai-settings-success">Found {models.length} {models.length === 1 ? "model" : "models"}.</p> : null}
          </fieldset>

          <fieldset className="settings-group theme-settings">
            <legend>Color theme</legend>
            <div className="theme-options four">
              {THEMES.map((theme) => (
                <button
                  aria-pressed={settings.colorTheme === theme.id}
                  className={`theme-option ${theme.id}`}
                  key={theme.id}
                  onClick={() => patch({ colorTheme: theme.id })}
                  type="button"
                >
                  <span className="theme-swatch" aria-hidden="true"><i /><i /><i /></span>
                  <strong>{theme.label}</strong>
                  <small>{theme.note}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="settings-group logo-settings">
            <legend>Corner logo</legend>
            <div className="logo-options">
              {LOGO_MARKS.map((logo) => (
                <button
                  aria-pressed={settings.logoMark === logo.id}
                  className="logo-option"
                  key={logo.id}
                  onClick={() => patch({ logoMark: logo.id })}
                  type="button"
                >
                  <span className={`brand-mark logo-${logo.id}`} aria-hidden="true"><i /></span>
                  <span><strong>{logo.label}</strong><small>{logo.note}</small></span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="settings-group font-settings">
            <legend>Writing font</legend>
            <div className="font-options">
              {FONTS.map((font) => (
                <button
                  aria-pressed={settings.documentFont === font.id}
                  className={`font-option ${font.id}`}
                  key={font.id}
                  onClick={() => patch({ documentFont: font.id })}
                  type="button"
                >
                  <span>Aa</span><strong>{font.label}</strong><small>{font.sample}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="settings-group scale-settings">
            <legend>Scale</legend>
            <label>
              <span><strong>Interface</strong><small>Menus, controls, and navigation</small></span>
              <input
                aria-label="Interface scale"
                max="1.2"
                min="0.85"
                onChange={(event) => patch({ uiScale: Number(event.currentTarget.value) })}
                step="0.05"
                type="range"
                value={settings.uiScale}
              />
              <output>{percent(settings.uiScale)}</output>
            </label>
            <label>
              <span><strong>Writing text</strong><small>The document body only</small></span>
              <input
                aria-label="Writing text size"
                max="1.35"
                min="0.85"
                onChange={(event) => patch({ textScale: Number(event.currentTarget.value) })}
                step="0.05"
                type="range"
                value={settings.textScale}
              />
              <output>{percent(settings.textScale)}</output>
            </label>
          </fieldset>

          <fieldset className="settings-group scale-settings texture-settings">
            <legend>Texture</legend>
            <label>
              <span><strong>Noise</strong><small>Fine grain across the app</small></span>
              <input
                aria-label="Noise intensity"
                max="0.6"
                min="0"
                onChange={(event) => patch({ noiseIntensity: Number(event.currentTarget.value) })}
                step="0.02"
                type="range"
                value={settings.noiseIntensity}
              />
              <output>{percent(settings.noiseIntensity)}</output>
            </label>
          </fieldset>

          <fieldset className="settings-group behavior-settings">
            <legend>Writing</legend>
            <label className="settings-check">
              <input checked={settings.autoSave} onChange={(event) => patch({ autoSave: event.currentTarget.checked })} type="checkbox" />
              <span><strong>Autosave</strong><small>Write the page after 900 ms without typing</small></span>
            </label>
            <label className="settings-check">
              <input checked={settings.spellCheck} onChange={(event) => patch({ spellCheck: event.currentTarget.checked })} type="checkbox" />
              <span><strong>Spellcheck</strong><small>Use the desktop webview dictionary</small></span>
            </label>
            <label className="settings-check">
              <input checked={settings.restoreLastSession} onChange={(event) => patch({ restoreLastSession: event.currentTarget.checked })} type="checkbox" />
              <span><strong>Restore session</strong><small>Reopen the last project and page at launch</small></span>
            </label>
            <label>
              <span><strong>Line spacing</strong><small>Document body leading</small></span>
              <input max="2.1" min="1.35" onChange={(event) => patch({ lineHeight: Number(event.currentTarget.value) })} step="0.05" type="range" value={settings.lineHeight} />
              <output>{settings.lineHeight.toFixed(2)}</output>
            </label>
            <div className="paragraph-style-setting">
              <span><strong>Paragraph separation</strong><small>Presentation only; page HTML stays unchanged</small></span>
              <div aria-label="Paragraph formatting" className="paragraph-style-options" role="group">
                <button
                  aria-pressed={settings.paragraphIndent}
                  onClick={() => patch({ paragraphIndent: !settings.paragraphIndent })}
                  title="Indent the first line of every paragraph"
                  type="button"
                >
                  Indent
                </button>
                <button
                  aria-pressed={settings.paragraphSpace}
                  onClick={() => patch({ paragraphSpace: !settings.paragraphSpace })}
                  title="Leave a visible gap between paragraphs"
                  type="button"
                >
                  Space
                </button>
              </div>
            </div>
            <label>
              <span><strong>Page width</strong><small>Maximum writing column</small></span>
              <input max="960" min="560" onChange={(event) => patch({ pageWidth: Number(event.currentTarget.value) })} step="20" type="range" value={settings.pageWidth} />
              <output>{settings.pageWidth}px</output>
            </label>
            <label className="word-goal-setting">
              <span><strong>Word goal</strong><small>Set to zero to hide goal progress</small></span>
              <input min="0" onChange={(event) => patch({ wordGoal: Math.max(0, Number(event.currentTarget.value)) })} step="100" type="number" value={settings.wordGoal} />
              <output>{settings.wordGoal ? `${settings.wordGoal}` : "Off"}</output>
            </label>
          </fieldset>

          <footer className="settings-footer">
            <p>Amanite {APP_VERSION} · Fractal {FRACTAL_REVISION} · API key session-only</p>
            <button className="ghost-action" onClick={() => onChange(DEFAULT_APPEARANCE_SETTINGS)} type="button">Reset appearance</button>
          </footer>
        </section>
      </div>
    </main>
    </div>
  );
}

export default SettingsScreen;
