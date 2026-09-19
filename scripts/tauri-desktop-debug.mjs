#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const defaultBinary = join(repoRoot, "src-tauri", "target", "debug", "amanite");
const elementKey = "element-6066-11e4-a52e-4f735466cecf";
const ctrlKey = "\uE009";

function createDefaultOptions() {
  return {
    documentRuntimeSmoke: false,
    doctor: false,
    typingRegression: false,
    keepOpen: false,
    port: Number(process.env.TAURI_WEBDRIVER_PORT || 4445),
    projectRoot: process.env.AMANITE_PROJECT_ROOT || "",
    screenshotsDir: "",
    skipBuild: process.env.AMANITE_TAURI_WEBDRIVER_SKIP_BUILD === "1"
  };
}

function splitOption(arg) {
  const separator = arg.indexOf("=");
  return separator < 0
    ? { flag: arg, value: undefined }
    : { flag: arg.slice(0, separator), value: arg.slice(separator + 1) };
}

const booleanOptionHandlers = new Map([
  ["--document-runtime-smoke", (options) => { options.documentRuntimeSmoke = true; }],
  ["--typing-regression", (options) => { options.typingRegression = true; }],
  ["--doctor", (options) => { options.doctor = true; }],
  ["--keep-open", (options) => { options.keepOpen = true; }],
  ["--skip-build", (options) => { options.skipBuild = true; }]
]);

const valueOptionHandlers = new Map([
  ["--port", (options, value) => { options.port = Number(value); }],
  ["--project-root", (options, value) => { options.projectRoot = value; }],
  ["--screenshots-dir", (options, value) => { options.screenshotsDir = value; }]
]);

function applyKnownOption(options, argv, index, flag, inlineValue) {
  const booleanHandler = booleanOptionHandlers.get(flag);
  if (booleanHandler) {
    booleanHandler(options);
    return 1;
  }

  return applyValueOption(options, argv, index, flag, inlineValue);
}

function applyValueOption(options, argv, index, flag, inlineValue) {
  const valueHandler = valueOptionHandlers.get(flag);
  if (!valueHandler) throw new Error(`Unknown argument: ${argv[index]}`);
  if (inlineValue !== undefined) {
    valueHandler(options, inlineValue);
    return 1;
  }

  const separateValue = argv[index + 1];
  if (separateValue === undefined || separateValue === "" || separateValue.startsWith("-")) return 1;

  valueHandler(options, separateValue);
  return 2;
}

function applyOption(options, argv, index) {
  const arg = argv[index];
  if (arg === "--") return 1;

  const { flag, value: inlineValue } = splitOption(arg);
  if (flag === "--help" || flag === "-h") {
    printHelp();
    process.exit(0);
  }
  return applyKnownOption(options, argv, index, flag, inlineValue);
}

function parseArgs(argv) {
  const options = createDefaultOptions();
  for (let index = 0; index < argv.length;) index += applyOption(options, argv, index);

  assertSmoke(Number.isInteger(options.port) && options.port >= 1 && options.port <= 65535, `Invalid --port value: ${options.port}`);

  return options;
}

function printHelp() {
  console.log(`Amanite Tauri desktop WebDriver debugger

Usage:
  pnpm run tauri:webdriver:doctor
  pnpm run tauri:webdriver:smoke
  pnpm run tauri:webdriver:open

Options:
  --doctor                    Check the local setup and exit.
  --keep-open                 Leave the Tauri app open until Enter is pressed.
  --skip-build                Reuse src-tauri/target/debug/amanite.
  --document-runtime-smoke    Exercise one-editor and warm-switch session lifetime.
  --typing-regression         Exercise sustained typing with autosave on small and large files.
  --port <port>               Embedded WebDriver port. Default: 4445.
  --project-root <path>       Fractal project library for the run.
  --screenshots-dir <path>    Where screenshots/logs are written.

Environment:
  AMANITE_PROJECT_ROOT        Same as --project-root.
  TAURI_WEBDRIVER_PORT        Same as --port.
  AMANITE_TAURI_WEBDRIVER_SKIP_BUILD=1  Same as --skip-build.
`);
}

function commandExists(command) {
  return spawnSync("bash", ["-lc", `command -v ${JSON.stringify(command)}`], {
    cwd: repoRoot,
    stdio: "ignore"
  }).status === 0;
}

function runChecked(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    console.log(`$ ${[command, ...args].join(" ")}`);
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${command} exited with ${signal ?? code}`));
      }
    });
  });
}

async function checkSetup() {
  const checks = [
    ["node", commandExists("node")],
    ["pnpm", commandExists("pnpm")],
    ["cargo", commandExists("cargo")]
  ];

  for (const [name, exists] of checks) {
    console.log(`${exists ? "✓" : "✗"} ${name}`);
  }

  console.log("✓ embedded WebDriver path: tauri-plugin-wdio-webdriver feature");
  console.log("  (No external WebKitWebDriver / tauri-driver process required.)");

  assertSmoke(checks.every(([, exists]) => exists), "Missing required command(s). Install them before running desktop WebDriver.");
}

async function webDriverAttempt(url, appProcess) {
  if (appProcess.exitCode !== null) {
    throw new Error(`Amanite exited before WebDriver was ready with code ${appProcess.exitCode}.`);
  }
  try {
    const response = await fetch(url);
    return response.ok ? null : new Error(`${url} returned HTTP ${response.status}`);
  } catch (error) {
    return error;
  }
}

function webDriverTimeoutMessage(url, lastError) {
  return `${url}. Last error: ${lastError?.message ?? lastError}`;
}

async function waitForWebDriver(port, appProcess) {
  const url = `http://127.0.0.1:${port}/status`;
  const started = Date.now();
  let lastError = null;

  while (Date.now() - started < 30_000) {
    lastError = await webDriverAttempt(url, appProcess);
    if (!lastError) return;

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }

  throw new Error(`Embedded Tauri WebDriver did not answer at ${webDriverTimeoutMessage(url, lastError)}`);
}

function parseDriverResponse(response, text, method, path) {
  const json = JSON.parse(text || "{}");
  if (response.ok) return json;
  const error = driverErrorMessage(json, text, response.statusText);
  throw new Error(`${method} ${path} failed with HTTP ${response.status}: ${error}`);
}

function driverErrorMessage(json, text, statusText) {
  return [json.value?.message, json.error, text, statusText].find(Boolean);
}

function elementId(json) {
  return json.value?.[elementKey] ?? json.value?.ELEMENT;
}

async function findElementAttempt(client, selector) {
  try {
    const json = await client.request("POST", client.sessionPath("/element"), {
      using: "css selector",
      value: selector
    });
    const id = elementId(json);
    return { id, error: id ? null : new Error(`No element id returned for ${selector}`) };
  } catch (error) {
    return { id: null, error };
  }
}

function elementTimeoutMessage(selector, lastError) {
  return `Timed out waiting for ${selector}: ${lastError?.message ?? lastError}`;
}

class DesktopWebDriverClient {
  constructor(port) {
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.sessionId = null;
  }

  async request(method, path, body, timeoutMs = 10_000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      return parseDriverResponse(response, text, method, path);
    } finally {
      clearTimeout(timeout);
    }
  }

  async createSession() {
    const json = await this.request("POST", "/session", {
      capabilities: {
        alwaysMatch: {}
      }
    });

    this.sessionId = json.value?.sessionId ?? json.sessionId;
    if (!this.sessionId) {
      throw new Error(`WebDriver did not return a session id: ${JSON.stringify(json)}`);
    }
  }

  async deleteSession() {
    if (!this.sessionId) {
      return;
    }

    const sessionId = this.sessionId;
    this.sessionId = null;
    await this.request("DELETE", `/session/${sessionId}`, undefined, 2_000);
  }

  sessionPath(path) {
    if (!this.sessionId) {
      throw new Error("No active WebDriver session.");
    }

    return `/session/${this.sessionId}${path}`;
  }

  async find(selector, timeout = 20_000) {
    const started = Date.now();
    let lastError = null;

    while (Date.now() - started < timeout) {
      const attempt = await findElementAttempt(this, selector);
      if (attempt.id) return attempt.id;
      lastError = attempt.error;

      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }

    throw new Error(elementTimeoutMessage(selector, lastError));
  }

  async click(selector, timeout) {
    const id = await this.find(selector, timeout);
    await this.request("POST", this.sessionPath(`/element/${id}/click`), {});
  }

  async setValue(selector, value, timeout) {
    const setFormControl = await this.executeScript(`
      const element = document.querySelector(arguments[0]);
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, arguments[1]);
      element.dispatchEvent(new InputEvent("input", { bubbles: true, data: arguments[1], inputType: "insertText" }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    `, [selector, value]);
    if (setFormControl) return;

    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const id = await this.find(selector, timeout);
        await this.request("POST", this.sessionPath(`/element/${id}/clear`), {});
        await this.request("POST", this.sessionPath(`/element/${id}/value`), { text: value });
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async sendKeys(selector, value, timeout) {
    const id = await this.find(selector, timeout);
    await this.request("POST", this.sessionPath(`/element/${id}/value`), { text: value });
  }

  async selectAll(selector, timeout) {
    await this.click(selector, timeout);
    await this.request("POST", this.sessionPath("/actions"), {
      actions: [
        {
          type: "key",
          id: "keyboard",
          actions: [
            { type: "keyDown", value: ctrlKey },
            { type: "keyDown", value: "a" },
            { type: "keyUp", value: "a" },
            { type: "keyUp", value: ctrlKey }
          ]
        }
      ]
    });
  }

  async ctrlS() {
    await this.request("POST", this.sessionPath("/actions"), {
      actions: [
        {
          type: "key",
          id: "keyboard",
          actions: [
            { type: "keyDown", value: ctrlKey },
            { type: "keyDown", value: "s" },
            { type: "keyUp", value: "s" },
            { type: "keyUp", value: ctrlKey }
          ]
        }
      ]
    });
  }

  async ctrlW() {
    await this.request("POST", this.sessionPath("/actions"), {
      actions: [{
        type: "key",
        id: "keyboard",
        actions: [
          { type: "keyDown", value: ctrlKey },
          { type: "keyDown", value: "w" },
          { type: "keyUp", value: "w" },
          { type: "keyUp", value: ctrlKey }
        ]
      }]
    });
  }

  async ctrlShiftT() {
    await this.request("POST", this.sessionPath("/actions"), {
      actions: [{
        type: "key",
        id: "keyboard",
        actions: [
          { type: "keyDown", value: ctrlKey },
          { type: "keyDown", value: "\uE008" },
          { type: "keyDown", value: "t" },
          { type: "keyUp", value: "t" },
          { type: "keyUp", value: "\uE008" },
          { type: "keyUp", value: ctrlKey }
        ]
      }]
    });
  }

  async executeScript(script, args = []) {
    const json = await this.request("POST", this.sessionPath("/execute/sync"), { script, args });
    return json.value;
  }

  async executeAsyncScript(script, args = []) {
    const json = await this.request("POST", this.sessionPath("/execute/async"), { script, args });
    return json.value;
  }

  async refresh() {
    await this.request("POST", this.sessionPath("/refresh"), {});
  }

  async text(selector, timeout) {
    const id = await this.find(selector, timeout);
    const json = await this.request("GET", this.sessionPath(`/element/${id}/text`));
    return json.value;
  }

  async screenshot() {
    const json = await this.request("GET", this.sessionPath("/screenshot"));
    return json.value;
  }
}

async function takeScreenshot(driver, screenshotsDir, name) {
  const base64 = await driver.screenshot();
  const path = join(screenshotsDir, `${name}.png`);
  await writeFile(path, Buffer.from(base64, "base64"));
  console.log(`screenshot: ${path}`);
}

function assertSmoke(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForScript(driver, script, args = [], timeout = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await driver.executeScript(script, args);
    if (value) return value;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for desktop script condition: ${script}`);
}

async function readNativeDraft(driver, projectRoot, pagePath) {
  return driver.executeAsyncScript(`
    const [root, path] = arguments;
    const done = arguments[arguments.length - 1];
    window.__TAURI_INTERNALS__.invoke("fractal_read_draft", { projectRoot: root, pagePath: path })
      .then((draft) => done(draft), (error) => done({ error }));
  `, [projectRoot, pagePath]);
}

async function waitForNativeDraft(driver, projectRoot, pagePath, timeout = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const draft = await readNativeDraft(driver, projectRoot, pagePath);
    if (draft && !draft.error) return draft;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for a recovery draft for ${pagePath}.`);
}

async function deleteNativeDraft(driver, projectRoot, pagePath) {
  const result = await driver.executeAsyncScript(`
    const [root, path] = arguments;
    const done = arguments[arguments.length - 1];
    window.__TAURI_INTERNALS__.invoke("fractal_delete_draft", { projectRoot: root, pagePath: path })
      .then(() => done({ ok: true }), (error) => done({ ok: false, error }));
  `, [projectRoot, pagePath]);
  assertSmoke(result?.ok === true, `Native draft cleanup failed: ${JSON.stringify(result?.error)}`);
}

async function openRootExplorerMenu(driver) {
  await driver.executeScript(`
    const explorer = document.querySelector('.file-explorer-surface');
    explorer?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2, clientX: 180, clientY: 180 }));
  `);
  await driver.find(".file-context-menu");
}

async function openProjectFromStart(driver, projectRoot) {
  const selector = `.project-list-option[title="${projectRoot}"]`;
  await waitForScript(driver, `
    const project = document.querySelector(arguments[0]);
    return Boolean(project && !project.disabled);
  `, [selector], 30_000);
  await driver.click(selector);
}

async function prepareSmokeProject(driver, screenshotsDir, projectRoot) {
  await driver.find("body");
  await driver.executeScript(`
    localStorage.removeItem("amanite.last-session.v1");
    localStorage.setItem("amanite.ai.v1", JSON.stringify({ endpoint: "", apiKey: "desktop-secret", model: "" }));
  `);
  await driver.refresh();
  try {
    await driver.find(".start-screen", 1_000);
  } catch {
    await driver.click('.brand > button[title="Close project"]');
  }
  await driver.find(".start-screen");
  const securityState = await driver.executeScript(`
    const inline = document.createElement("script");
    inline.textContent = "window.__amaniteInlineScriptRan = true";
    document.head.append(inline);
    return {
      inlineScriptRan: window.__amaniteInlineScriptRan === true,
      persistedAi: localStorage.getItem("amanite.ai.v1")
    };
  `);
  assertSmoke(!securityState.inlineScriptRan, `Production CSP allowed an inline script: ${JSON.stringify(securityState)}`);
  assertSmoke(!securityState.persistedAi?.includes("desktop-secret") && !securityState.persistedAi?.includes("apiKey"), `The legacy API key remained in storage: ${securityState.persistedAi}`);
  await takeScreenshot(driver, screenshotsDir, "01-start-screen");

  const runSlug = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const projectName = `Desktop WebDriver ${runSlug}`;
  const projectDirectory = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const activeProjectRoot = join(projectRoot, projectDirectory);

  await driver.setValue(".create-project-section input", projectName);
  await driver.click("button.primary-action");
  await driver.find(".workspace", 30_000);
  await driver.find(`.folder-view[aria-label="Folder ${projectName}"]`, 30_000);
  await driver.find('.editor-group-tab.folder.active button[role="tab"][title="Pages"]');
  await takeScreenshot(driver, screenshotsDir, "02-project-overview");

  return { activeProjectRoot, projectName };
}

async function runWorkspaceSmoke(driver, screenshotsDir, projectName) {
  await driver.click(".folder-view-empty");
  await driver.click(".folder-empty-row .folder-add-menu button:first-child");
  await driver.setValue(".create-page-dialog input", "Index");
  await driver.click(".create-page-dialog .primary-action");
  await driver.find(".editor-tab-panel.active .rich-content-editable", 30_000);
  await takeScreenshot(driver, screenshotsDir, "02-workspace");
  const compactSidebarState = await driver.executeScript(`
    const notifications = document.querySelector('.workspace-status-stack');
    const formatting = document.querySelector('.rich-editor-header');
    return {
      actions: Boolean(document.querySelector('.explorer-header')),
      filter: Boolean(document.querySelector('.sidebar-filter')),
      notificationLayer: Number(getComputedStyle(notifications).zIndex),
      formattingLayer: Number(getComputedStyle(formatting).zIndex)
    };
  `);
  assertSmoke(!compactSidebarState.actions && !compactSidebarState.filter && compactSidebarState.notificationLayer > compactSidebarState.formattingLayer, `Sidebar cleanup or notification layering regressed: ${JSON.stringify(compactSidebarState)}`);
  await driver.click(".brand-home");
  await driver.find(`.folder-view[aria-label="Folder ${projectName}"]`, 30_000);
  await driver.click('[title="index.fractal.html"]');
  await driver.find(".editor-tab-panel.active .rich-content-editable", 30_000);

  const borealisPlacement = await driver.executeScript(`return document.querySelector('.ai-chat-trigger')?.parentElement?.className;`);
  assertSmoke(borealisPlacement === "document-status-actions", `Borealis trigger is not in the document footer: ${borealisPlacement}`);
  await driver.click(".ai-chat-trigger");
  await driver.find(".ai-chat-panel");
  const chatEmptyState = await driver.text(".ai-chat-empty h2");
  assertSmoke(chatEmptyState === "Connect Borealis" || chatEmptyState === "Start here", `Borealis did not show its connection state: ${chatEmptyState}`);
  await takeScreenshot(driver, screenshotsDir, "02a-borealis");
  await driver.click('.ai-chat-header button[aria-label="Open Borealis in the workspace"]');
  await driver.find('.workspace-tab-strip[data-group-id="left"] .editor-group-tab.borealis.active');
  await driver.find('.borealis-tab-panel .ai-chat-workspace');
  const staleBorealisTooltip = await driver.executeScript(`return Boolean(document.querySelector('.themed-tooltip'));`);
  assertSmoke(!staleBorealisTooltip, "The Borealis maximize tooltip remained after the popover closed.");
  await takeScreenshot(driver, screenshotsDir, "02b-borealis-tab");

  await driver.click('.workspace-tab-strip[data-group-id="left"] .editor-group-tab.borealis .editor-group-tab-split');
  await driver.find('.workspace-tab-strip[data-group-id="right"] .editor-group-tab.borealis.active');
  await driver.click('.workspace-tab-strip[data-group-id="left"] .editor-group-tab:not(.borealis) button[role="tab"]');
  await driver.click('.editor-group[data-group-id="left"] .ai-chat-trigger');
  const focusedBorealisGroup = await driver.executeScript(`return document.querySelector('.editor-group[data-group-id="right"]')?.classList.contains('focused');`);
  assertSmoke(focusedBorealisGroup, "The footer Borealis button did not focus its workspace tab.");
  await takeScreenshot(driver, screenshotsDir, "02c-borealis-split");

  await driver.click('.workspace-tab-strip[data-group-id="right"] .editor-group-tab.borealis .editor-group-tab-close');
  await driver.click('.editor-group[data-group-id="left"] .ai-chat-trigger');
  await driver.find('.ai-chat-panel:not(.ai-chat-workspace)');
  await driver.click('.ai-chat-header button[title="Close Borealis"]');
}

async function runFolderSmoke(driver, screenshotsDir, projectName) {
  await openRootExplorerMenu(driver);
  await driver.click(".file-context-menu button:nth-of-type(2)");
  await driver.setValue('.create-page-dialog input', "Field Notes");
  await driver.click('.create-page-dialog .primary-action');
  await driver.find('.explorer-row.folder[title="field-notes"]', 30_000);
  await driver.executeScript(`
    const row = document.querySelector('.explorer-row.folder[title="field-notes"]');
    row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2, clientX: 180, clientY: 180 }));
  `);
  await driver.click('.file-context-menu button:nth-of-type(2)');
  await driver.setValue('.create-page-dialog input', "Inside Folder");
  await driver.click('.create-page-dialog .primary-action');
  await driver.find('[title="field-notes/inside-folder.fractal.html"]', 30_000);
  await driver.find('[aria-label="Body for field-notes/inside-folder.fractal.html"]', 30_000);

  await driver.setValue(".editor-tab-panel.active .document-title-field input", projectName);
  await driver.setValue(".editor-tab-panel.active .rich-content-editable", "Saved from the desktop WebDriver smoke test.");
  await driver.find(".save-state.unsaved");
  await driver.ctrlS();
  await driver.find(".save-state.saved");
  await takeScreenshot(driver, screenshotsDir, "03-after-edit-save-shortcut");

  await driver.click('.explorer-row.folder[title="field-notes"] .explorer-folder-open');
  await driver.find('.folder-view[aria-label="Folder Field Notes"]', 30_000);
  await takeScreenshot(driver, screenshotsDir, "03a-folder-view");

  const folderAddControlCount = await driver.executeScript(`return document.querySelectorAll('.editor-tab-panel.active .folder-add-row .folder-add-ghost').length;`);
  assertSmoke(folderAddControlCount === 2, `Folder view has ${folderAddControlCount} add controls instead of two.`);
  await driver.click('.editor-tab-panel.active .folder-add-row.top .folder-add-ghost');
  const firstFolderAddAction = await driver.text('.editor-tab-panel.active .folder-add-row.top .folder-add-menu button:first-child strong');
  assertSmoke(firstFolderAddAction === "New page", `The first folder add action is ${firstFolderAddAction}.`);
  await takeScreenshot(driver, screenshotsDir, "03aa-folder-add-menu");
  await driver.click('.editor-tab-panel.active .folder-add-row.top .folder-add-menu button:first-child');
  await driver.setValue('.create-page-dialog input', "Folder View Page");
  await driver.click('.create-page-dialog .primary-action');
  await driver.find('[aria-label="Body for field-notes/folder-view-page.fractal.html"]', 30_000);
  // The page-create command opens the new page in a tab. Close that owner so
  // the next part exercises folder-inline attachment for an otherwise closed
  // document. Opening it while the tab is present should focus that tab.
  const closedFolderPageTab = await driver.executeScript(`
    const tab = [...document.querySelectorAll('.workspace-tab-strip[data-group-id="left"] .editor-group-tab')]
      .find((candidate) => candidate.querySelector('button[title="field-notes/folder-view-page.fractal.html"]'));
    tab?.querySelector('.editor-group-tab-close')?.click();
    return Boolean(tab);
  `);
  assertSmoke(closedFolderPageTab, "Could not find the created page tab to close before inline editing.");
  await new Promise((resolve) => setTimeout(resolve, 500));
  const folderPageTabStillOpen = await driver.executeScript(`return Boolean([...document.querySelectorAll('.workspace-tab-strip[data-group-id="left"] .editor-group-tab')].find((candidate) => candidate.querySelector('button[title="field-notes/folder-view-page.fractal.html"]')));`);
  assertSmoke(!folderPageTabStillOpen, "The created page tab remained open before inline editing.");

  await driver.find('.folder-view[aria-label="Folder Field Notes"]', 30_000);
  await driver.click('.editor-tab-panel.active .folder-add-row.bottom .folder-add-ghost');
  await driver.click('.editor-tab-panel.active .folder-add-row.bottom .folder-add-menu button:nth-child(2)');
  await driver.setValue('.create-page-dialog input', "Nested View");
  await driver.click('.create-page-dialog .primary-action');
  await driver.find('.explorer-row.folder[title="field-notes/nested-view"]', 30_000);
  await takeScreenshot(driver, screenshotsDir, "03ab-folder-created-items");

  const openedNestedFolder = await driver.executeScript(`
    const card = [...document.querySelectorAll('.editor-tab-panel.active .folder-sequence-item.folder .folder-sequence-card')]
      .find((candidate) => candidate.querySelector('h2')?.textContent?.trim() === 'Nested View');
    card?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    return Boolean(card);
  `);
  assertSmoke(openedNestedFolder, "Could not find the new nested folder card for double-click.");
  await driver.find('.folder-view[aria-label="Folder Nested View"]', 30_000);
  const emptyFolderEdgeControls = await driver.executeScript(`return document.querySelectorAll('.editor-tab-panel.active .folder-add-row').length;`);
  assertSmoke(emptyFolderEdgeControls === 0, `Empty folder has ${emptyFolderEdgeControls} edge add controls.`);
  await driver.click('.editor-tab-panel.active .folder-view-empty');
  await driver.find('.editor-tab-panel.active .folder-empty-row .folder-add-menu');

  await driver.click('.editor-group-tab.folder button[role="tab"][title="field-notes"]');
  await driver.find('.folder-view[aria-label="Folder Field Notes"]', 30_000);
  const openedFolderPage = await driver.executeScript(`
    const card = [...document.querySelectorAll('.editor-tab-panel.active .folder-sequence-item.native .folder-sequence-card')]
      .find((candidate) => candidate.querySelector('h2')?.textContent?.trim() === 'Folder View Page');
    card?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    return Boolean(card);
  `);
  assertSmoke(openedFolderPage, "Could not find the new page card for double-click.");
  await driver.find('[aria-label="Body for field-notes/folder-view-page.fractal.html"]', 30_000);

  await driver.click('.workspace-nav-controls button[title="Back in left"]');
  await driver.find('.folder-view[aria-label="Folder Field Notes"]', 30_000);
  await driver.executeScript(`window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'f' }))`);
  await driver.find('.editor-tab-panel.active .folder-find-drawer input');
  await driver.setValue('.editor-tab-panel.active .folder-find-drawer input', "Folder View");
  await driver.find('.editor-tab-panel.active .folder-find-page');
  await takeScreenshot(driver, screenshotsDir, "03ac-folder-find");
  await driver.click('.editor-tab-panel.active .folder-find-drawer > header button');
  await driver.click('.editor-tab-panel.active .folder-status-bar button:nth-child(2)');
  await driver.find('.folder-export-dialog[aria-labelledby="folder-export-title"]');
  const folderExportSelection = await driver.text('.folder-export-selection > header small');
  assertSmoke(folderExportSelection === "2 of 2 selected", `Folder export did not select the native page: ${folderExportSelection}`);
  await driver.click('.folder-export-selection > header > div:last-child button:nth-child(2)');
  await driver.find('.folder-export-dialog .export-error');
  await driver.click('.folder-export-selection > header > div:last-child button:nth-child(1)');
  await driver.click('.folder-export-settings .export-check-row:nth-of-type(1) input');
  await driver.click('.folder-export-validity label:nth-of-type(2) input');
  await takeScreenshot(driver, screenshotsDir, "03b-folder-export");
  await driver.click('.folder-export-dialog .export-dialog-header > button');
  const closedInlineTargetTab = await driver.executeScript(`
    const tab = [...document.querySelectorAll('.editor-group-tab')]
      .find((candidate) => candidate.querySelector('button[title="field-notes/folder-view-page.fractal.html"]'));
    tab?.querySelector('.editor-group-tab-close')?.click();
    return Boolean(tab);
  `);
  assertSmoke(closedInlineTargetTab, "Could not find the opened page tab to close before inline editing.");
  await new Promise((resolve) => setTimeout(resolve, 500));
  await driver.find('.folder-view[aria-label="Folder Field Notes"]', 30_000);
  const inlineTarget = await driver.executeScript(`
    const card = [...document.querySelectorAll('.editor-tab-panel.active .folder-sequence-item.native .folder-sequence-card')]
      .find((candidate) => candidate.querySelector('h2')?.textContent?.trim() === 'Folder View Page');
    card?.querySelector('.folder-sequence-actions button:first-of-type')?.click();
    return Boolean(card);
  `);
  assertSmoke(inlineTarget, "Could not find the closed page card for folder-inline editing.");
  await driver.find('.editor-tab-panel.active .folder-document-editor .rich-content-editable', 30_000);
  await driver.sendKeys('.editor-tab-panel.active .folder-document-editor .rich-content-editable', " Edited from the folder view.");
  await driver.ctrlS();
  await driver.find(".save-state.saved");
  await takeScreenshot(driver, screenshotsDir, "03c-folder-inline-editor");
  await driver.executeScript(`
    const card = [...document.querySelectorAll('.editor-tab-panel.active .folder-sequence-item.native .folder-sequence-card')]
      .find((candidate) => candidate.querySelector('h2')?.textContent?.trim() === 'Folder View Page');
    card?.querySelector('.folder-sequence-actions button:nth-of-type(2)')?.click();
  `);
  await driver.find('.editor-tab-panel.active .rich-content-editable', 30_000);
  const folderEdit = await driver.text('.editor-tab-panel.active .rich-content-editable');
  assertSmoke(folderEdit.includes("Edited from the folder view."), `Folder edit did not reach the child page: ${folderEdit}`);
}

async function createSmokePage(driver, screenshotsDir) {
  await openRootExplorerMenu(driver);
  await driver.click(".file-context-menu button:first-of-type");
  await driver.setValue(".create-page-dialog input", "My file");
  await driver.click(".create-page-dialog .primary-action");
  await driver.find('[title="my-file.fractal.html"]', 30_000);
  await takeScreenshot(driver, screenshotsDir, "04-created-page");

  const removedNativeControls = await driver.executeScript(`
    const headerButtons = [...document.querySelectorAll('.rich-editor-header button')].map((button) => button.textContent.trim());
    return {
      checklist: headerButtons.includes('☑ List'),
      preview: headerButtons.includes('Preview'),
      titleHint: Boolean(document.querySelector('.document-title-field > span'))
    };
  `);
  if (removedNativeControls.checklist || removedNativeControls.preview || removedNativeControls.titleHint) {
    throw new Error(`Removed native controls are still visible: ${JSON.stringify(removedNativeControls)}`);
  }
}

async function verifyDerivedLinkSmoke(driver) {
  await driver.setValue(".editor-tab-panel.active .rich-content-editable", "Index");
  await driver.find('.editor-tab-panel.active .rich-content-editable .rich-derived-link[data-amanite-derived-target="index.fractal.html"]', 30_000);
  const derivedLinkShape = await driver.executeScript(`
    const derived = document.querySelector('.editor-tab-panel.active .rich-content-editable .rich-derived-link[data-amanite-derived-target="index.fractal.html"]');
    return { href: derived?.getAttribute('href'), role: derived?.getAttribute('role'), tagName: derived?.tagName };
  `);
  assertSmoke(!derivedLinkShape.href && derivedLinkShape.role === "link" && derivedLinkShape.tagName === "SPAN", `Derived link became an anchor: ${JSON.stringify(derivedLinkShape)}`);
  await driver.click('.editor-tab-panel.active .rich-content-editable .rich-derived-link[data-amanite-derived-target="index.fractal.html"]');
  await driver.find('.editor-group-tab.active button[title="index.fractal.html"]', 30_000);

  await driver.click('[title="my-file.fractal.html"]');
  await driver.find('.editor-tab-panel.active .rich-content-editable .rich-derived-link[data-amanite-derived-target="index.fractal.html"]', 30_000);
  const derivedAfterReload = await driver.executeScript(`
    const editor = document.querySelector('.editor-tab-panel.active .rich-content-editable');
    return {
      derived: Boolean(editor?.querySelector('.rich-derived-link[data-amanite-derived-target="index.fractal.html"]')),
      explicit: Boolean(editor?.querySelector('a[href]'))
    };
  `);
  assertSmoke(derivedAfterReload.derived && !derivedAfterReload.explicit, `Derived link persisted as an explicit link: ${JSON.stringify(derivedAfterReload)}`);
}

async function runInlinePageLinkSmoke(driver, screenshotsDir) {
  await driver.selectAll(".editor-tab-panel.active .rich-content-editable");
  await driver.sendKeys(".editor-tab-panel.active .rich-content-editable", "@Ind");
  await driver.find(".page-link-menu button", 30_000);
  await takeScreenshot(driver, screenshotsDir, "04a-inline-page-link-picker");
  await driver.click(".page-link-menu button", 30_000);
  await driver.find('.editor-tab-panel.active .rich-content-editable a.rich-link[href]', 30_000);
  const acceptedLink = await driver.executeScript(`
    const anchor = document.querySelector('.editor-tab-panel.active .rich-content-editable a.rich-link[href]');
    const dispatched = anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    return { dispatched, href: anchor.getAttribute('href') };
  `);
  if (!acceptedLink.href || acceptedLink.dispatched) throw new Error(`Accepted link was not handled: ${JSON.stringify(acceptedLink)}`);
  await driver.find('.editor-group-tab.active button[title="index.fractal.html"]', 30_000);
  await driver.click('[title="my-file.fractal.html"]');
  await driver.find(".editor-tab-panel.active .rich-content-editable", 30_000);
}

async function runRichEditorContractSmoke(driver, screenshotsDir) {
  const editorSelector = ".editor-tab-panel.active .rich-content-editable[contenteditable=\"true\"]";
  const toolbarSelector = ".editor-tab-panel.active";
  await driver.click(editorSelector);
  await driver.sendKeys(editorSelector, "Formatting checkpoint");
  await driver.find(editorSelector, 30_000);

  const composition = await driver.executeScript(`
    const root = document.querySelector(arguments[0]);
    if (!root) return null;
    const events = [];
    const record = (event) => events.push(event.type);
    for (const type of ["compositionstart", "compositionupdate", "compositionend"]) root.addEventListener(type, record);
    root.focus();
    root.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "あ" }));
    root.dispatchEvent(new CompositionEvent("compositionupdate", { bubbles: true, data: "あ" }));
    root.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "あ" }));
    for (const type of ["compositionstart", "compositionupdate", "compositionend"]) root.removeEventListener(type, record);
    return { active: document.activeElement === root, events };
  `, [editorSelector]);
  assertSmoke(composition?.active && composition.events.join(",") === "compositionstart,compositionupdate,compositionend", `Composition lifecycle failed: ${JSON.stringify(composition)}`);
  await driver.sendKeys(editorSelector, " composition");
  const composedText = await driver.text(editorSelector);
  assertSmoke(composedText.includes("composition"), `Composition follow-up text was lost: ${composedText}`);

  await driver.selectAll(editorSelector);
  await driver.click(`${toolbarSelector} [data-tool="Bold"]`);
  const boldAfterToggle = await waitForScript(driver, `
    const root = document.querySelector(arguments[0]);
    const button = document.querySelector(arguments[1]);
    const rendered = root?.querySelector("strong, b, .rich-text-bold, [style*='font-weight']");
    return button?.getAttribute("aria-pressed") === "true" && Boolean(rendered);
  `, [editorSelector, `${toolbarSelector} [data-tool="Bold"]`]);
  assertSmoke(boldAfterToggle, "Bold formatting did not reach the active Lexical selection.");
  await driver.click(`${toolbarSelector} [data-tool="Undo (Ctrl+Z)"]`);
  await waitForScript(driver, `
    const root = document.querySelector(arguments[0]);
    const button = document.querySelector(arguments[1]);
    return button?.getAttribute("aria-pressed") === "false" && !root?.querySelector("strong, b, .rich-text-bold, [style*='font-weight']");
  `, [editorSelector, `${toolbarSelector} [data-tool="Bold"]`]);

  await driver.click(`${toolbarSelector} [data-tool="More formatting"]`);
  await driver.click(`${toolbarSelector} [data-tool="Add 3 by 3 table"]`);
  const tableShape = await waitForScript(driver, `
    const table = document.querySelector(arguments[0])?.querySelector("table");
    if (!table) return null;
    return { rows: table.querySelectorAll("tr").length, cells: table.querySelectorAll("td, th").length };
  `, [editorSelector]);
  assertSmoke(tableShape.rows === 3 && tableShape.cells === 9, `Table insertion produced an unexpected shape: ${JSON.stringify(tableShape)}`);
  await driver.click(`${toolbarSelector} [data-tool="Undo (Ctrl+Z)"]`);
  await waitForScript(driver, `return !document.querySelector(arguments[0])?.querySelector("table");`, [editorSelector]);
  await takeScreenshot(driver, screenshotsDir, "04b-editor-contract");

  await driver.ctrlS();
  try {
    await driver.find(".save-state.saved", 30_000);
  } catch (error) {
    await takeScreenshot(driver, screenshotsDir, "04c-save-failure");
    const state = await driver.executeScript(`
      return {
        status: document.querySelector('.command-status')?.textContent?.trim() ?? null,
        save: document.querySelector('.save-state')?.textContent?.trim() ?? null,
        tab: document.querySelector('.editor-group-tab.active')?.textContent?.trim() ?? null
      };
    `);
    throw new Error(`Rich editor save did not complete: ${JSON.stringify(state)}; ${error}`);
  }
}

async function runEditorBasicsSmoke(driver, screenshotsDir) {
  await createSmokePage(driver, screenshotsDir);
  await runRichEditorContractSmoke(driver, screenshotsDir);
  await verifyDerivedLinkSmoke(driver);
  await runInlinePageLinkSmoke(driver, screenshotsDir);
}

async function runSplitSmoke(driver, screenshotsDir, activeProjectRoot) {
  for (const title of ["Alpha", "Beta", "Gamma", "Delta"]) {
    await openRootExplorerMenu(driver);
    await driver.click(".file-context-menu button:first-of-type");
    await driver.setValue(".create-page-dialog input", title);
    await driver.click(".create-page-dialog .primary-action");
    await driver.find(`[title="${title.toLowerCase()}.fractal.html"]`, 30_000);
  }

  await driver.executeScript(`
    const tab = document.querySelector('.workspace-tab-strip[data-group-id="left"] [title="index.fractal.html"]')?.closest('.editor-group-tab');
    const transfer = new DataTransfer();
    window.__amaniteSmokeTransfer = transfer;
    tab?.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  `);
  await driver.find(".create-group-drop-zone", 30_000);
  await driver.executeScript(`
    const target = document.querySelector('.create-group-drop-zone');
    const transfer = window.__amaniteSmokeTransfer;
    target?.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    target?.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  `);
  await driver.find('.workspace-tab-strip[data-group-id="right"] [title="index.fractal.html"]', 30_000);

  await driver.executeScript(`
    const tab = document.querySelector('.workspace-tab-strip[data-group-id="left"] [title="my-file.fractal.html"]')?.closest('.editor-group-tab');
    const target = document.querySelector('.workspace-tab-strip[data-group-id="right"] .editor-group-tabs');
    const transfer = new DataTransfer();
    tab?.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    target?.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    target?.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    tab?.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }));
  `);
  await driver.find('.workspace-tab-strip[data-group-id="right"] .editor-group-tab.active [title="my-file.fractal.html"]', 30_000);
  const groupCounts = await driver.executeScript(`
    return {
      left: document.querySelectorAll('.workspace-tab-strip[data-group-id="left"] .editor-group-tab').length,
      right: document.querySelectorAll('.workspace-tab-strip[data-group-id="right"] .editor-group-tab').length
    };
  `);
  if (groupCounts.left < 4 || groupCounts.right !== 2) throw new Error(`Unexpected editor group tab counts: ${JSON.stringify(groupCounts)}`);

  await driver.click('.editor-group[data-group-id="right"] .editor-tab-panel.active .rich-content-editable');
  try {
    await driver.find('.editor-group[data-group-id="right"] .editor-tab-panel.active .rich-content-editable[contenteditable="true"]', 5_000);
  } catch (error) {
    const state = await driver.executeScript(`
      const group = document.querySelector('.editor-group[data-group-id="right"]');
      const editor = group?.querySelector('.editor-tab-panel.active .rich-content-editable');
      return { contenteditable: editor?.getAttribute('contenteditable'), focused: group?.classList.contains('focused'), imports: window.__AMANITE_DATAFLOW__?.read?.().filter((event) => event.name === 'editor.import').slice(-8), loading: Boolean(group?.querySelector('.document-loading-preview')), titleDisabled: group?.querySelector('.document-title-field input')?.disabled };
    `);
    throw new Error(`${error.message}; right editor state: ${JSON.stringify(state)}`);
  }
  await driver.setValue('.editor-group[data-group-id="right"] .editor-tab-panel.active .rich-content-editable', "Local edit before an external change.");
  const externalPagePath = join(activeProjectRoot, "pages", "my-file.fractal.html");
  const externalSource = await readFile(externalPagePath, "utf8");
  await writeFile(externalPagePath, externalSource.replace("</main>", "<p>External edit detected.</p></main>"));
  await driver.find('.editor-group[data-group-id="right"] .document-buffer-alert.conflict', 10_000);
  await driver.click('.editor-group[data-group-id="right"] .document-buffer-actions button:first-child');
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  await driver.click('.editor-group[data-group-id="right"] .editor-tab-panel.active .rich-content-editable');
  try {
    await driver.find('.editor-group[data-group-id="right"] .editor-tab-panel.active .rich-content-editable[contenteditable="true"]', 5_000);
  } catch (error) {
    const state = await driver.executeScript(`
      const group = document.querySelector('.editor-group[data-group-id="right"]');
      const editor = group?.querySelector('.editor-tab-panel.active .rich-content-editable');
      return { contenteditable: editor?.getAttribute('contenteditable'), focused: group?.classList.contains('focused'), imports: window.__AMANITE_DATAFLOW__?.read?.().filter((event) => event.name === 'editor.import').slice(-8), loading: Boolean(group?.querySelector('.document-loading-preview')), titleDisabled: group?.querySelector('.document-title-field input')?.disabled };
    `);
    throw new Error(`${error.message}; reloaded right editor state: ${JSON.stringify(state)}`);
  }
  await driver.setValue('.editor-group[data-group-id="right"] .editor-tab-panel.active .rich-content-editable[contenteditable="true"]', "Written in the right editor group.");
  await driver.find('.workspace-tab-strip[data-group-id="right"] .editor-group-tab-state.dirty');
  await takeScreenshot(driver, screenshotsDir, "04b-split-pane");
  await driver.ctrlW();
  try {
    await driver.find('.workspace-tab-strip[data-group-id="right"] .editor-group-tab.active [title="index.fractal.html"]', 30_000);
  } catch (error) {
    const state = await driver.executeScript(`
      return {
        groups: [...document.querySelectorAll('.workspace-tab-strip')].map((strip) => ({
          group: strip.getAttribute('data-group-id'),
          tabs: [...strip.querySelectorAll('.editor-group-tab')].map((tab) => ({
            active: tab.classList.contains('active'),
            titles: [...tab.querySelectorAll('[title]')].map((node) => node.getAttribute('title'))
          }))
        })),
        save: document.querySelector('.editor-group[data-group-id="right"] .save-state')?.textContent?.trim() ?? null,
        errors: [...document.querySelectorAll('.editor-group[data-group-id="right"] [role="alert"], .editor-group[data-group-id="right"] .document-buffer-alert')].map((node) => node.textContent?.trim()),
        command: document.querySelector('.command-status')?.textContent?.trim() ?? null
      };
    `);
    throw new Error(`${error.message}; split state after closing right tab: ${JSON.stringify(state)}`);
  }
  await driver.ctrlShiftT();
  await driver.find('.workspace-tab-strip[data-group-id="right"] .editor-group-tab.active [title="my-file.fractal.html"]', 30_000);
  await driver.click('.workspace-tab-strip[data-group-id="right"] .editor-group-close');
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  await driver.find(".editor-groups:not(.split)", 30_000);
  await takeScreenshot(driver, screenshotsDir, "04c-split-pane-closed");

  await driver.click(".editor-tab-panel.active .editor-inspector-toggle");
  await driver.find(".fractal-inspector", 10_000);
  await takeScreenshot(driver, screenshotsDir, "05-inspector");
}

async function runSettingsSmoke(driver, screenshotsDir) {
  await driver.click(".sidebar-settings");
  await driver.find(".settings-screen");
  await driver.find('.ai-settings input[aria-label="OpenAI-compatible endpoint"]');
  const restoredApiKey = await driver.executeScript(`return document.querySelector('.ai-settings input[aria-label="API key"]')?.value;`);
  assertSmoke(!restoredApiKey, "The settings screen restored a persisted API key.");
  await driver.find('.ai-settings select[aria-label="AI model"]');
  await takeScreenshot(driver, screenshotsDir, "06-ai-settings");
  await driver.click(".theme-option.moss");
  const settingsScroll = await driver.executeScript(`
    const screen = document.querySelector('.settings-screen');
    screen.scrollTop = screen.scrollHeight;
    return { clientHeight: screen.clientHeight, scrollHeight: screen.scrollHeight, scrollTop: screen.scrollTop };
  `);
  assertSmoke(settingsScroll.scrollHeight > settingsScroll.clientHeight && settingsScroll.scrollTop > 0, `Settings screen did not scroll: ${JSON.stringify(settingsScroll)}`);
  await takeScreenshot(driver, screenshotsDir, "06-settings");
  await driver.click(".settings-footer .ghost-action");
  await driver.click('.settings-check input[type="checkbox"]');
  await driver.click(".settings-back");
  await driver.find(".workspace");

  await driver.click(".editor-tab-panel.active .document-status-bar button:last-child");
  await driver.find(".app-shell.focus-mode");
  const focusToolbarState = await driver.executeScript(`
    return {
      editor: getComputedStyle(document.querySelector('.rich-editor-header')).display,
      workspaceOpacity: getComputedStyle(document.querySelector('.workspace-toolbar')).opacity
    };
  `);
  if (focusToolbarState.editor !== "none" || focusToolbarState.workspaceOpacity !== "0") {
    throw new Error(`Focus mode left a toolbar visible: ${JSON.stringify(focusToolbarState)}`);
  }
  await driver.click(".editor-tab-panel.active .document-status-bar button:last-child");
  await driver.find(".app-shell:not(.focus-mode)");
}

async function runBufferSwitchSmoke(driver, screenshotsDir) {
  const editedPath = await driver.executeScript(`return document.querySelector('.workspace-tab-strip.focused .editor-group-tab.active button[title]')?.getAttribute('title');`);
  if (!editedPath) throw new Error("Focused editor group did not expose an active tab.");
  const beforeSwitch = await driver.executeScript(`
    const editors = [...document.querySelectorAll('.editor-tab-panel.active .rich-content-editable')];
    const imports = window.__AMANITE_DATAFLOW__?.read?.().filter((event) => event.name === 'editor.import' && event.status === 'start').length ?? 0;
    return {
      count: editors.length,
      documentId: editors[0]?.getAttribute('data-amanite-document-id') ?? null,
      imports
    };
  `);
  if (beforeSwitch.count !== 1 || !beforeSwitch.documentId) {
    throw new Error(`Expected one identified active document editor before switching: ${JSON.stringify(beforeSwitch)}`);
  }
  await driver.setValue(".editor-tab-panel.active .rich-content-editable", "Saved during a page switch.");
  await driver.find(".save-state.unsaved");
  await driver.click('[title="index.fractal.html"]');
  await driver.find('.editor-group-tab.active [title="index.fractal.html"]');
  await driver.click(`[title="${editedPath}"]`);
  const afterSwitch = await driver.executeScript(`
    const editors = [...document.querySelectorAll('.editor-tab-panel.active .rich-content-editable')];
    const imports = window.__AMANITE_DATAFLOW__?.read?.().filter((event) => event.name === 'editor.import' && event.status === 'start').length ?? 0;
    return {
      count: editors.length,
      documentId: editors[0]?.getAttribute('data-amanite-document-id') ?? null,
      imports
    };
  `);
  if (afterSwitch.count !== 1 || afterSwitch.documentId !== beforeSwitch.documentId || afterSwitch.imports !== beforeSwitch.imports) {
    throw new Error(`Warm switch did not reattach the same document session: ${JSON.stringify({ beforeSwitch, afterSwitch })}`);
  }
  const switchedText = await driver.text(".editor-tab-panel.active .rich-content-editable");
  if (!switchedText.includes("Saved during a page switch.")) {
    throw new Error(`Page switch did not preserve the dirty buffer: ${switchedText}`);
  }
  await driver.ctrlS();
  await driver.find(".save-state.saved");
  await driver.click('[title="my-file.fractal.html"]');
  await takeScreenshot(driver, screenshotsDir, "07-buffer-after-switch");
}

async function runDocumentRuntimeSmoke(driver, screenshotsDir, projectName) {
  await runWorkspaceSmoke(driver, screenshotsDir, projectName);
  await createSmokePage(driver, screenshotsDir);
  await runBufferSwitchSmoke(driver, screenshotsDir);
}

async function runDraftRecoverySmoke(driver, screenshotsDir, activeProjectRoot) {
  const liveDraftMarker = "Coordinator capture survives a detached editor.";
  await driver.click('[title="index.fractal.html"]');
  await driver.find('.editor-tab-panel.active .rich-content-editable[contenteditable="true"]', 30_000);
  await driver.executeScript("window.__AMANITE_DATAFLOW__.clear();");
  await driver.setValue('.editor-tab-panel.active .rich-content-editable', liveDraftMarker);
  await driver.find(".save-state.unsaved");
  await driver.click('[title="my-file.fractal.html"]');
  await driver.find('.editor-tab-panel.active .rich-content-editable[contenteditable="true"]', 30_000);
  const liveDraft = await waitForNativeDraft(driver, activeProjectRoot, "index.fractal.html");
  const liveDraftEvents = await driver.executeScript(`return window.__AMANITE_DATAFLOW__.read();`);
  assertSmoke(liveDraft.source.includes(liveDraftMarker), "The coordinator recovery draft did not contain the detached document edit.");
  assertSmoke(liveDraft.source.includes("data-fractal-style"), "The coordinator recovery draft discarded native sections.");
  assertSmoke(liveDraftEvents.some((event) => event.name === "document.capture") && liveDraftEvents.some((event) => event.name === "document.encode"), `The recovery draft did not use the session capture path: ${JSON.stringify(liveDraftEvents)}`);
  assertSmoke(!liveDraftEvents.some((event) => event.name === "snapshot.request" && event.status === "start"), "The recovery draft asked a mounted snapshot controller to export the document.");

  await driver.click('[title="index.fractal.html"]');
  await driver.find('.editor-tab-panel.active .rich-content-editable[contenteditable="true"]', 30_000);
  await driver.ctrlS();
  await driver.find(".save-state.saved", 30_000);
  await deleteNativeDraft(driver, activeProjectRoot, "index.fractal.html");

  const recoverySource = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fractal-format" content="1"><title>Recovered page</title><style data-fractal-style></style></head><body><main data-fractal-document><h1 data-fractal-title>Recovered page</h1><p>Recovered from Amanite local storage.</p></main></body></html>';
  await driver.executeScript(`
    const tab = document.querySelector('.editor-group-tab [title="index.fractal.html"]')?.closest('.editor-group-tab');
    tab?.querySelector('.editor-group-tab-close')?.click();
  `);
  const draftWrite = await driver.executeAsyncScript(`
    const [projectRoot, pagePath, source] = arguments;
    const done = arguments[arguments.length - 1];
    const draft = { pagePath, projectRoot, source, baseSourceHash: "", updatedAt: new Date().toISOString(), version: 1 };
    window.__TAURI_INTERNALS__.invoke("fractal_write_draft", { draft }).then(() => done({ ok: true }), (error) => done({ ok: false, error }));
  `, [activeProjectRoot, "index.fractal.html", recoverySource]);
  assertSmoke(draftWrite?.ok === true, `Native draft write failed: ${JSON.stringify(draftWrite?.error)}`);
  await driver.click('[title="index.fractal.html"]');
  await driver.find(".confirm-dialog");
  await driver.click(".confirm-dialog .primary-action");
  await driver.find(".save-state.unsaved");
  await driver.find('.editor-tab-panel.active .rich-content-editable[contenteditable="true"]', 30_000);
  const recoveredText = await driver.text(".editor-tab-panel.active .rich-content-editable");
  if (!recoveredText.includes("Recovered from Amanite local storage.")) {
    throw new Error(`Draft recovery returned unexpected text: ${recoveredText}`);
  }
  await driver.ctrlS();
  await driver.find(".save-state.saved");
  await takeScreenshot(driver, screenshotsDir, "08-recovered-draft");
}

async function moveAndExportSmoke(driver, screenshotsDir, activeProjectRoot) {
  await openRootExplorerMenu(driver);
  await driver.click(".file-context-menu button:first-of-type");
  await driver.setValue(".create-page-dialog input", "Move Me");
  await driver.click(".create-page-dialog .primary-action");
  await driver.find('[title="move-me.fractal.html"]', 30_000);
  await driver.executeScript(`
    const page = document.querySelector('[title="move-me.fractal.html"]');
    page?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2, clientX: 180, clientY: 180 }));
  `);
  await driver.click(".file-context-menu button:nth-of-type(2)");
  await driver.executeScript(`
    const select = document.querySelector('.create-page-dialog select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(select, "field-notes");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  `);
  await driver.click(".create-page-dialog .primary-action");
  await driver.find('[title="field-notes/move-me.fractal.html"]', 30_000);
  const oldMovePathExists = await driver.executeScript(`return Boolean(document.querySelector('[title="move-me.fractal.html"]'));`);
  assertSmoke(!oldMovePathExists, "Page movement left the old path in the explorer.");

  const exportPath = join(screenshotsDir, "move-me-export.html");
  const exportResult = await driver.executeAsyncScript(`
    const [projectRoot, pagePath, output] = arguments;
    const done = arguments[arguments.length - 1];
    window.__TAURI_INTERNALS__.invoke("fractal_export_html", {
      includeDerivedLinks: false,
      output,
      pagePath,
      projectRoot
    }).then((report) => done({ ok: true, report }), (error) => done({ ok: false, error }));
  `, [activeProjectRoot, "field-notes/move-me.fractal.html", exportPath]);
  assertSmoke(exportResult?.ok === true, `Live export failed: ${JSON.stringify(exportResult?.error)}`);
  const exportedSource = await readFile(exportPath, "utf8");
  assertSmoke(exportedSource.includes("Move Me"), "Live export did not contain the moved page.");
  await takeScreenshot(driver, screenshotsDir, "08a-moved-page");
}

async function recreateMovedPageSmoke(driver, activeProjectRoot) {
  const movedPagePath = join(activeProjectRoot, "pages", "field-notes", "move-me.fractal.html");
  await driver.click('[title="field-notes/move-me.fractal.html"]');
  await driver.find(".editor-tab-panel.active .rich-content-editable", 30_000);
  const openPageSource = await readFile(movedPagePath, "utf8");
  await unlink(movedPagePath);
  const recreation = await driver.executeAsyncScript(`
    const [projectRoot, pagePath, source] = arguments;
    const done = arguments[arguments.length - 1];
    window.__TAURI_INTERNALS__.invoke("fractal_recreate_page", { projectRoot, pagePath, source })
      .then((result) => done({ ok: true, result }), (error) => done({ ok: false, error }));
  `, [activeProjectRoot, "field-notes/move-me.fractal.html", openPageSource]);
  assertSmoke(recreation?.ok === true, `Missing open page recreation failed: ${JSON.stringify(recreation?.error)}`);
  const recreatedSource = await readFile(movedPagePath, "utf8");
  assertSmoke(recreatedSource.includes("Move Me"), "Recreated page did not contain the open buffer.");

  await unlink(movedPagePath);
  await writeFile(movedPagePath, recreatedSource.replace("Move Me", "A different file reappeared."));
  const guardedRecreation = await driver.executeAsyncScript(`
    const [projectRoot, pagePath, source] = arguments;
    const done = arguments[arguments.length - 1];
    window.__TAURI_INTERNALS__.invoke("fractal_recreate_page", { projectRoot, pagePath, source })
      .then((result) => done({ ok: true, result }), (error) => done({ ok: false, error }));
  `, [activeProjectRoot, "field-notes/move-me.fractal.html", recreatedSource]);
  assertSmoke(guardedRecreation?.ok !== true && guardedRecreation?.error?.code === "conflict", `Recreation overwrote or misreported a reappeared file: ${JSON.stringify(guardedRecreation)}`);
}

async function runMoveSmoke(driver, screenshotsDir, activeProjectRoot) {
  await moveAndExportSmoke(driver, screenshotsDir, activeProjectRoot);
  await recreateMovedPageSmoke(driver, activeProjectRoot);
  await takeScreenshot(driver, screenshotsDir, "08b-recreated-page");
}

async function runReopenSmoke(driver, screenshotsDir, activeProjectRoot, projectName) {
  await driver.click('.brand > button[title="Close project"]');
  await driver.find(".start-screen", 30_000);
  await openProjectFromStart(driver, activeProjectRoot);
  await driver.find(".workspace", 30_000);
  await takeScreenshot(driver, screenshotsDir, "11-reopened-workspace");
  const reopenedFolder = await driver.find('.folder-view[aria-label^="Folder "]', 30_000);
  const reopenedFolderLabel = await driver.request("GET", driver.sessionPath(`/element/${reopenedFolder}/attribute/aria-label`));
  assertSmoke(reopenedFolderLabel.value === `Folder ${projectName}`, `Reopened the wrong folder view: ${reopenedFolderLabel.value}`);
  await driver.find('.editor-group-tab.folder.active button[role="tab"][title="Pages"]');
  const reopenedOnDocument = await driver.executeScript(`return Boolean(document.querySelector('.editor-tab-panel.active .rich-content-editable'));`);
  if (reopenedOnDocument) throw new Error("Reopened project started on a document instead of the project overview.");
  await takeScreenshot(driver, screenshotsDir, "09-reopened-project-overview");
}

async function writeDataflowEvidence(driver, screenshotsDir, phase = "final") {
  const evidence = await driver.executeScript(`
    const events = window.__AMANITE_DATAFLOW__?.read?.() ?? [];
    return {
      buildProfile: "debug-webdriver",
      commit: document.documentElement.dataset.commit || null,
      displayBackend: navigator.userAgent.includes("Wayland") ? "wayland" : "unreported",
      events,
      hardwareConcurrency: navigator.hardwareConcurrency,
      platform: navigator.platform,
      userAgent: navigator.userAgent
    };
  `);
  await writeFile(join(screenshotsDir, `dataflow-events-${phase}.json`), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

async function runSmoke(driver, screenshotsDir, projectRoot) {
  const { activeProjectRoot, projectName } = await prepareSmokeProject(driver, screenshotsDir, projectRoot);
  await runWorkspaceSmoke(driver, screenshotsDir, projectName);
  await runFolderSmoke(driver, screenshotsDir, projectName);

  await runEditorBasicsSmoke(driver, screenshotsDir);
  await runSplitSmoke(driver, screenshotsDir, activeProjectRoot);
  await runSettingsSmoke(driver, screenshotsDir);
  await runBufferSwitchSmoke(driver, screenshotsDir);
  await runDraftRecoverySmoke(driver, screenshotsDir, activeProjectRoot);
  await runMoveSmoke(driver, screenshotsDir, activeProjectRoot);
  return { activeProjectRoot, projectName };
}

async function runForcedTerminationRecoverySmoke(driver, appProcess, log, screenshotsDir, projectRoot, activeProjectRoot, port) {
  const recoverySource = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fractal-format" content="1"><title>Recovered page</title><style data-fractal-style></style></head><body><main data-fractal-document><h1 data-fractal-title>Recovered page</h1><p>Recovered after forced termination.</p></main></body></html>';
  const recoveryPagePath = "recovered-page.fractal.html";
  const draftWrite = await driver.executeAsyncScript(`
    const [projectRoot, pagePath, source] = arguments;
    const done = arguments[arguments.length - 1];
    const draft = { pagePath, projectRoot, source, baseSourceHash: "", updatedAt: new Date().toISOString(), version: 1, revision: 17 };
    window.__TAURI_INTERNALS__.invoke("fractal_write_draft", { draft }).then(() => done({ ok: true }), (error) => done({ ok: false, error }));
  `, [activeProjectRoot, recoveryPagePath, recoverySource]);
  assertSmoke(draftWrite?.ok === true, `Forced-termination draft write failed: ${JSON.stringify(draftWrite?.error)}`);

  await driver.deleteSession();
  appProcess.kill("SIGKILL");
  await waitForProcessExit(appProcess);
  log.end();

  const restarted = startApp({ appBinary: process.env.AMANITE_TAURI_APP_BINARY || defaultBinary, artifactsDir: screenshotsDir, port, projectRoot });
  await waitForWebDriver(port, restarted.child);
  const nextDriver = new DesktopWebDriverClient(port);
  await nextDriver.createSession();
  try {
    try {
      await nextDriver.find(".workspace", 5_000);
    } catch {
      await nextDriver.find(".start-screen", 30_000);
      await openProjectFromStart(nextDriver, activeProjectRoot);
      await nextDriver.find(".workspace", 30_000);
    }
    await takeScreenshot(nextDriver, screenshotsDir, "10-after-forced-restart");
    try {
      await nextDriver.find(`.explorer-row.page[title="${recoveryPagePath}"]`, 5_000);
    } catch {
      await nextDriver.click('.brand > button[title="Close project"]');
      await nextDriver.find(".start-screen", 30_000);
      await openProjectFromStart(nextDriver, activeProjectRoot);
      await nextDriver.find(".workspace", 30_000);
      await nextDriver.find(`.explorer-row.page[title="${recoveryPagePath}"]`, 30_000);
    }
    await nextDriver.click(`.explorer-row.page[title="${recoveryPagePath}"]`);
    await nextDriver.find(".confirm-dialog", 30_000);
    await nextDriver.click(".confirm-dialog .primary-action");
    await nextDriver.find(".save-state.unsaved", 30_000);
    const recoveredText = await nextDriver.text(".editor-tab-panel.active .rich-content-editable");
    assertSmoke(recoveredText.includes("Recovered after forced termination."), `Forced-termination recovery returned unexpected text: ${recoveredText}`);
    await nextDriver.ctrlS();
    try {
      await nextDriver.find(".save-state.saved", 30_000);
    } catch (error) {
      await takeScreenshot(nextDriver, screenshotsDir, "10-save-failure");
      const state = await nextDriver.executeScript(`
        return {
          error: document.querySelector('.document-error, .error')?.textContent?.trim() ?? null,
          save: document.querySelector('.save-state')?.textContent?.trim() ?? null,
          editable: document.querySelector('.editor-tab-panel.active .rich-content-editable')?.getAttribute('contenteditable') ?? null,
          events: window.__AMANITE_DATAFLOW__?.read().filter((event) => event.name.startsWith('snapshot.')) ?? []
        };
      `);
      throw new Error(`Recovered document save did not complete: ${JSON.stringify(state)}; ${error}`);
    }
    await takeScreenshot(nextDriver, screenshotsDir, "10-forced-termination-recovery");
    const persistedSource = await readFile(join(activeProjectRoot, "pages", recoveryPagePath), "utf8");
    assertSmoke(persistedSource.includes("Recovered after forced termination."), "Recovered forced-termination content was not persisted.");
  } catch (error) {
    await deleteDriverSession(nextDriver, restarted.child);
    stopAppProcess(restarted.child);
    restarted.log.end();
    throw error;
  }
  return { driver: nextDriver, appProcess: restarted.child, getNativeOutput: restarted.getNativeOutput, log: restarted.log };
}

function startApp({ appBinary, artifactsDir, port, projectRoot }) {
  const logPath = join(artifactsDir, "amanite.log");
  const log = createWriteStream(logPath, { flags: "a" });
  const env = {
    ...process.env,
    AMANITE_PROJECT_ROOT: projectRoot,
    TAURI_WEBDRIVER_PORT: String(port)
  };

  console.log(`launching: ${appBinary}`);
  console.log(`project root: ${projectRoot}`);
  console.log(`webdriver: http://127.0.0.1:${port}`);
  console.log(`app log: ${logPath}`);

  const child = spawn(appBinary, [], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.pipe(log);
  child.stderr.pipe(log);
  let nativeOutput = "";
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.stderr.on("data", (chunk) => {
    nativeOutput = `${nativeOutput}${chunk}`.slice(-32_768);
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));

  return { child, getNativeOutput: () => nativeOutput, log };
}

function waitForProcessExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      reject(new Error(`Amanite did not exit within ${timeoutMs} ms.`));
    }, timeoutMs);
    const onExit = (code) => {
      clearTimeout(timeout);
      resolvePromise(code);
    };
    child.once("exit", onExit);
  });
}

async function waitForEnter() {
  if (!process.stdin.isTTY) {
    console.log("--keep-open requested, but stdin is not interactive. Press Ctrl+C to stop.");
    await new Promise(() => {});
    return;
  }

  console.log("Desktop WebDriver session is open. Press Enter to close Amanite.");
  process.stdin.setRawMode?.(false);
  process.stdin.resume();
  await new Promise((resolvePromise) => process.stdin.once("data", resolvePromise));
}

function runDirectories(options, runId) {
  return {
    artifactsDir: resolve(repoRoot, options.screenshotsDir || join("artifacts", "tauri-webdriver", runId)),
    projectRoot: resolve(repoRoot, options.projectRoot || join("artifacts", "tauri-webdriver", runId, "projects"))
  };
}

async function buildWebDriverApp(options) {
  if (options.skipBuild) return;
  await runChecked("pnpm", ["exec", "tauri", "build", "--debug", "--no-bundle", "--features", "webdriver"]);
}

async function closeSmokeSession(driver, appProcess, getNativeOutput) {
  await driver.find('.window-control.close');
  await driver.click('.window-control.close').catch(() => undefined);
  const exitCode = await waitForProcessExit(appProcess);
  assertSmoke(exitCode === 0, `Amanite exited with code ${exitCode}.`);
  assertSmoke(!/corrupted (?:unsorted chunks|double-linked list)|free\(\):/i.test(getNativeOutput()), "Amanite printed allocator corruption during shutdown.");
}

async function deleteDriverSession(driver, appProcess) {
  if (!driver || appProcess.exitCode !== null) return;
  try {
    await driver.deleteSession();
  } catch {
    // The app may already be gone.
  }
}

function stopAppProcess(appProcess) {
  if (appProcess.exitCode === null) {
    appProcess.kill("SIGTERM");
    setTimeout(() => {
      if (appProcess.exitCode === null) appProcess.kill("SIGKILL");
    }, 2_000).unref();
  }
}

async function cleanupDesktop(driver, appProcess, log) {
  await deleteDriverSession(driver, appProcess);
  stopAppProcess(appProcess);
  log.end();
}

function installSignalCleanup(cleanup) {
  process.once("SIGINT", async () => {
    await cleanup();
    process.exit(130);
  });
  process.once("SIGTERM", async () => {
    await cleanup();
    process.exit(143);
  });
}

async function runTypingRegression(driver, artifactsDir, projectRoot) {
  await driver.find("body");
  await driver.executeScript(`
    const settings = JSON.parse(localStorage.getItem("amanite.appearance.v1") || "{}");
    localStorage.setItem("amanite.appearance.v1", JSON.stringify({ ...settings, autoSave: true }));
  `);
  const { activeProjectRoot } = await prepareSmokeProject(driver, artifactsDir, projectRoot);
  await driver.click('.brand > button[title="Close project"]');
  await driver.find('.start-screen');
  for (const [name, blocks] of [["small", 5], ["large", 1500]]) {
    const body = Array.from({ length: blocks }, (_, i) => `<p>Paragraph ${i} has ordinary words for the typing regression check.</p>`).join("");
    await writeFile(join(activeProjectRoot, "pages", `${name}.fractal.html`), `<!doctype html><html><head><meta charset="utf-8"><meta name="fractal-format" content="1"><title>${name}</title><style data-fractal-style></style></head><body><main data-fractal-document><h1 data-fractal-title>${name}</h1>${body}</main></body></html>`);
  }
  await openProjectFromStart(driver, activeProjectRoot);
  await driver.find('.workspace');
  const reports = [];
  for (const name of ["small", "large"]) {
    await driver.click(`[title="${name}.fractal.html"]`);
    const selector = `.editor-tab-panel.active .rich-content-editable[aria-label="Body for ${name}.fractal.html"]`;
    await waitForScript(driver, `return document.querySelector(arguments[0])?.contentEditable === "true"`, [selector]);
    await driver.executeScript(`
      window.__AMANITE_DATAFLOW__.clear();
      const root = document.querySelector(arguments[0]);
      root.focus();
      const range = document.createRange(); range.selectNodeContents(root); range.collapse(false);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      window.__typingBaseline = root.textContent;
      window.__typingFrames = []; window.__typingRunning = true;
      let previous = performance.now();
      function frame(now) { window.__typingFrames.push(now - previous); previous = now; if (window.__typingRunning) requestAnimationFrame(frame); }
      requestAnimationFrame(frame);
    `, [selector]);
    const typed = " Testing ordinary typing through several autosaves.";
    for (const char of typed) {
      await driver.sendKeys(selector, char);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await new Promise((resolve) => setTimeout(resolve, 3200));
    const report = await driver.executeScript(`
      window.__typingRunning = false;
      const root = document.querySelector(arguments[0]);
      const events = window.__AMANITE_DATAFLOW__.read();
      return { textPreserved: root.textContent === window.__typingBaseline + arguments[1],
        tail: root.textContent.slice(-120),
        dialogs: [...document.querySelectorAll('[role="dialog"]')].map(el => el.textContent),
        conflict: !!document.querySelector('.document-buffer-actions'),
        imports: events.filter(e => e.name === 'editor.import' && e.status === 'start').length,
        longestFrameMs: Math.max(...window.__typingFrames),
        p95FrameMs: window.__typingFrames.slice().sort((a, b) => a - b)[Math.floor(window.__typingFrames.length * 0.95)],
        exports: events.filter(e => e.name === 'editor.full-export').length,
        saves: events.filter(e => e.name === 'ipc.fractal_set_page_content' && e.status === 'start').length,
        events };
    `, [selector, typed]);
    report.name = name;
    const diskSource = await readFile(join(activeProjectRoot, "pages", `${name}.fractal.html`), 'utf8');
    report.diskBytes = Buffer.byteLength(diskSource);
    report.diskPreserved = diskSource.includes(typed.trim())
      && [...diskSource.matchAll(/Paragraph \d+ has ordinary words for the typing regression check\./g)].length === (name === "small" ? 5 : 1500);
    reports.push(report);
    await takeScreenshot(driver, artifactsDir, `typing-${name}`);
    await writeFile(join(artifactsDir, 'typing-regression.json'), JSON.stringify(reports, null, 2));
    console.log(JSON.stringify({ ...report, events: undefined }));
    if (report.dialogs.length) break;
  }
  assertSmoke(reports.length === 2 && reports.every(r => r.textPreserved && r.diskPreserved && !r.conflict && !r.dialogs.length && !r.imports), "Typing caused data loss, a reload, or a false conflict. See typing-regression.json.");
}

async function runDesktopSession(options, artifactsDir, projectRoot) {
  const appBinary = process.env.AMANITE_TAURI_APP_BINARY || defaultBinary;
  const initial = startApp({ appBinary, artifactsDir, port: options.port, projectRoot });
  let appProcess = initial.child;
  let getNativeOutput = initial.getNativeOutput;
  let log = initial.log;
  let driver = null;
  const cleanup = () => cleanupDesktop(driver, appProcess, log);
  installSignalCleanup(cleanup);

  try {
    await waitForWebDriver(options.port, appProcess);
    driver = new DesktopWebDriverClient(options.port);
    await driver.createSession();
    if (options.typingRegression) {
      await runTypingRegression(driver, artifactsDir, projectRoot);
      return;
    }
    if (options.documentRuntimeSmoke) {
      const { activeProjectRoot, projectName } = await prepareSmokeProject(driver, artifactsDir, projectRoot);
      await runDocumentRuntimeSmoke(driver, artifactsDir, projectName);
      await writeDataflowEvidence(driver, artifactsDir, "document-runtime");
      await closeSmokeSession(driver, appProcess, getNativeOutput);
      return { activeProjectRoot, projectName };
    }
    const smoke = await runSmoke(driver, artifactsDir, projectRoot);
    await writeDataflowEvidence(driver, artifactsDir, "before-termination");
    const restarted = await runForcedTerminationRecoverySmoke(driver, appProcess, log, artifactsDir, projectRoot, smoke.activeProjectRoot, options.port);
    driver = restarted.driver;
    appProcess = restarted.appProcess;
    getNativeOutput = restarted.getNativeOutput;
    log = restarted.log;
    await runReopenSmoke(driver, artifactsDir, smoke.activeProjectRoot, smoke.projectName);
    await writeDataflowEvidence(driver, artifactsDir, "after-restart");
    if (options.keepOpen) await waitForEnter();
    else await closeSmokeSession(driver, appProcess, getNativeOutput);
  } finally {
    await cleanup();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await checkSetup();
  if (options.doctor) return;
  const directories = runDirectories(options, new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(directories.artifactsDir, { recursive: true });
  await mkdir(directories.projectRoot, { recursive: true });
  await buildWebDriverApp(options);
  await runDesktopSession(options, directories.artifactsDir, directories.projectRoot);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
