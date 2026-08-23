import WindowControls, { handleWindowDragMouseDown } from "@/components/ui/WindowControls";
import {
  DEFAULT_APPEARANCE_SETTINGS,
  type AppearanceSettings,
  type ColorTheme,
  type DocumentFont
} from "@/app/useAppearanceSettings";

type Props = {
  settings: AppearanceSettings;
  onChange: (settings: AppearanceSettings) => void;
  onCloseRequest: () => void;
  onClose: () => void;
};

const THEMES: Array<{ id: ColorTheme; label: string; note: string }> = [
  { id: "ember", label: "Ember", note: "Warm amber and soot" },
  { id: "moss", label: "Moss", note: "Lichen green and bark" },
  { id: "ink", label: "Ink", note: "Blue black and silver" }
];

const FONTS: Array<{ id: DocumentFont; label: string; sample: string }> = [
  { id: "literary", label: "Literary", sample: "Cormorant Garamond" },
  { id: "book", label: "Book", sample: "Georgia" },
  { id: "sans", label: "Sans", sample: "Bricolage Grotesque" }
];

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function SettingsScreen({ settings, onChange, onClose, onCloseRequest }: Props) {
  function patch(next: Partial<AppearanceSettings>) {
    onChange({ ...settings, ...next });
  }

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

        <section className="settings-sheet" aria-label="Appearance settings">
          <header className="settings-sheet-header">
            <p>Appearance</p>
            <span>Changes apply immediately</span>
          </header>

          <fieldset className="settings-group theme-settings">
            <legend>Color theme</legend>
            <div className="theme-options">
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

          <footer className="settings-footer">
            <p>Stored locally in Amanite.</p>
            <button className="ghost-action" onClick={() => onChange(DEFAULT_APPEARANCE_SETTINGS)} type="button">Reset appearance</button>
          </footer>
        </section>
      </div>
    </main>
  );
}

export default SettingsScreen;
