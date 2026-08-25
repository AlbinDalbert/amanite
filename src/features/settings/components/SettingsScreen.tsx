import { useCallback, useEffect, useRef, useState } from "react";
import WindowControls, { handleWindowDragMouseDown } from "@/components/ui/WindowControls";
import { APP_VERSION } from "@/app/appVersion";
import type { AiSettings } from "@/app/useAiSettings";
import { aiClient } from "@/lib/ai/client";
import {
  DEFAULT_APPEARANCE_SETTINGS,
  type AppearanceSettings,
  type ColorTheme,
  type DocumentFont,
  type LogoMark
} from "@/app/useAppearanceSettings";

type Props = {
  aiSettings: AiSettings;
  settings: AppearanceSettings;
  onAiChange: (settings: AiSettings) => void;
  onChange: (settings: AppearanceSettings) => void;
  onCloseRequest: () => void;
  onClose: () => void;
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

function SettingsScreen({ aiSettings, settings, onAiChange, onChange, onClose, onCloseRequest }: Props) {
  const [models, setModels] = useState<string[]>([]);
  const [modelError, setModelError] = useState<string | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const requestId = useRef(0);

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
    <main className="settings-screen">
      <header className="settings-titlebar" data-tauri-drag-region onMouseDown={handleWindowDragMouseDown}>
        <button className="settings-back" onClick={onClose} type="button">
          <span aria-hidden="true">←</span> Back
        </button>
        <WindowControls onCloseRequest={onCloseRequest} />
      </header>

      <div className="settings-layout">
        <aside className="settings-intro">
          <div className="start-brand"><span className="brand-mark" aria-hidden="true" /><p>Amanite</p></div>
          <p className="settings-kicker">Local preferences</p>
          <h1>Settings</h1>
          <p>These choices belong to this copy of Amanite. They do not alter the Fractal project or its pages.</p>
        </aside>

        <section className="settings-sheet" aria-label="Application settings">
          <header className="settings-sheet-header">
            <p>Preferences</p>
            <span>Changes apply immediately</span>
          </header>

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
              <span><strong>API key</strong><small>Optional for local servers</small></span>
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
            <p>Amanite {APP_VERSION} · Stored locally</p>
            <button className="ghost-action" onClick={() => onChange(DEFAULT_APPEARANCE_SETTINGS)} type="button">Reset appearance</button>
          </footer>
        </section>
      </div>
    </main>
  );
}

export default SettingsScreen;
