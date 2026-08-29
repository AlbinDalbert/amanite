#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const defaultBinary = join(repoRoot, "src-tauri", "target", "debug", "amanite");
const elementKey = "element-6066-11e4-a52e-4f735466cecf";
const ctrlKey = "\uE009";

function parseArgs(argv) {
  const options = {
    doctor: false,
    keepOpen: false,
    port: Number(process.env.TAURI_WEBDRIVER_PORT || 4445),
    projectRoot: process.env.AMANITE_PROJECT_ROOT || "",
    screenshotsDir: "",
    skipBuild: process.env.AMANITE_TAURI_WEBDRIVER_SKIP_BUILD === "1"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--doctor") {
      options.doctor = true;
    } else if (arg === "--keep-open") {
      options.keepOpen = true;
    } else if (arg === "--skip-build") {
      options.skipBuild = true;
    } else if (arg === "--port") {
      options.port = Number(argv[++index]);
    } else if (arg.startsWith("--port=")) {
      options.port = Number(arg.slice("--port=".length));
    } else if (arg === "--project-root") {
      options.projectRoot = argv[++index] ?? "";
    } else if (arg.startsWith("--project-root=")) {
      options.projectRoot = arg.slice("--project-root=".length);
    } else if (arg === "--screenshots-dir") {
      options.screenshotsDir = argv[++index] ?? "";
    } else if (arg.startsWith("--screenshots-dir=")) {
      options.screenshotsDir = arg.slice("--screenshots-dir=".length);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error(`Invalid --port value: ${options.port}`);
  }

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

  let ok = true;
  for (const [name, exists] of checks) {
    console.log(`${exists ? "✓" : "✗"} ${name}`);
    ok &&= exists;
  }

  console.log("✓ embedded WebDriver path: tauri-plugin-wdio-webdriver feature");
  console.log("  (No external WebKitWebDriver / tauri-driver process required.)");

  if (!ok) {
    throw new Error("Missing required command(s). Install them before running desktop WebDriver.");
  }
}

async function waitForWebDriver(port, appProcess) {
  const url = `http://127.0.0.1:${port}/status`;
  const started = Date.now();
  let lastError = null;

  while (Date.now() - started < 30_000) {
    if (appProcess.exitCode !== null) {
      throw new Error(`Amanite exited before WebDriver was ready with code ${appProcess.exitCode}.`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }

  throw new Error(
    `Embedded Tauri WebDriver did not answer at ${url}. Last error: ${lastError?.message ?? lastError}`
  );
}

class DesktopWebDriverClient {
  constructor(port) {
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.sessionId = null;
  }

  async request(method, path, body) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const error = json.value?.message || json.error || text || response.statusText;
      throw new Error(`${method} ${path} failed with HTTP ${response.status}: ${error}`);
    }

    return json;
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
    await this.request("DELETE", `/session/${sessionId}`);
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
      try {
        const json = await this.request("POST", this.sessionPath("/element"), {
          using: "css selector",
          value: selector
        });
        const id = json.value?.[elementKey] ?? json.value?.ELEMENT;

        if (id) {
          return id;
        }

        lastError = new Error(`No element id returned for ${selector}`);
      } catch (error) {
        lastError = error;
      }

      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }

    throw new Error(`Timed out waiting for ${selector}: ${lastError?.message ?? lastError}`);
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

async function runSmoke(driver, screenshotsDir, projectRoot) {
  await driver.executeScript(`localStorage.removeItem("amanite.last-session.v1");`);
  await driver.refresh();
  try {
    await driver.find(".start-screen", 1_000);
  } catch {
    await driver.click('.brand > button[title="Close project"]');
  }
  await driver.find(".start-screen");
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
  await driver.click(".folder-view-empty");
  await driver.click(".folder-empty-row .folder-add-menu button:first-child");
  await driver.setValue(".create-page-dialog input", "Index");
  await driver.click(".create-page-dialog .primary-action");
  await driver.find(".editor-tab-panel.active .rich-content-editable", 30_000);
  await takeScreenshot(driver, screenshotsDir, "02-workspace");

  const borealisPlacement = await driver.executeScript(`return document.querySelector('.ai-chat-trigger')?.parentElement?.className;`);
  if (borealisPlacement !== "document-status-actions") {
    throw new Error(`Borealis trigger is not in the document footer: ${borealisPlacement}`);
  }
  await driver.click(".ai-chat-trigger");
  await driver.find(".ai-chat-panel");
  const chatEmptyState = await driver.text(".ai-chat-empty h2");
  if (chatEmptyState !== "Connect Borealis" && chatEmptyState !== "Start here") {
    throw new Error(`Borealis did not show its connection state: ${chatEmptyState}`);
  }
  await takeScreenshot(driver, screenshotsDir, "02a-borealis");
  await driver.click('.ai-chat-header button[aria-label="Open Borealis in the workspace"]');
  await driver.find('.editor-group[data-group-id="left"] .editor-group-tab.borealis.active');
  await driver.find('.borealis-tab-panel .ai-chat-workspace');
  const staleBorealisTooltip = await driver.executeScript(`return Boolean(document.querySelector('.themed-tooltip'));`);
  if (staleBorealisTooltip) throw new Error("The Borealis maximize tooltip remained after the popover closed.");
  await takeScreenshot(driver, screenshotsDir, "02b-borealis-tab");

  await driver.click('.editor-group[data-group-id="left"] .editor-group-tab.borealis .editor-group-tab-split');
  await driver.find('.editor-group[data-group-id="right"] .editor-group-tab.borealis.active');
  await driver.click('.editor-group[data-group-id="left"] .editor-group-tab:not(.borealis) button[role="tab"]');
  await driver.click('.editor-group[data-group-id="left"] .ai-chat-trigger');
  const focusedBorealisGroup = await driver.executeScript(`return document.querySelector('.editor-group[data-group-id="right"]')?.classList.contains('focused');`);
  if (!focusedBorealisGroup) throw new Error("The footer Borealis button did not focus its workspace tab.");
  await takeScreenshot(driver, screenshotsDir, "02c-borealis-split");

  await driver.click('.editor-group[data-group-id="right"] .editor-group-tab.borealis .editor-group-tab-close');
  await driver.click('.editor-group[data-group-id="left"] .ai-chat-trigger');
  await driver.find('.ai-chat-panel:not(.ai-chat-workspace)');
  await driver.click('.ai-chat-header button[title="Close Borealis"]');

  await driver.click('.explorer-header button[title="Create folder"]');
  await driver.setValue('.create-page-dialog input', "Field Notes");
  await driver.click('.create-page-dialog .primary-action');
  await driver.find('.explorer-row.folder[title="Field Notes"]', 30_000);
  await driver.executeScript(`
    const row = document.querySelector('.explorer-row.folder[title="Field Notes"]');
    row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2, clientX: 180, clientY: 180 }));
  `);
  await driver.click('.file-context-menu button:nth-of-type(2)');
  await driver.setValue('.create-page-dialog input', "Inside Folder");
  await driver.click('.create-page-dialog .primary-action');
  await driver.find('[title="Field Notes/inside-folder.fractal.html"]', 30_000);
  await driver.find('[aria-label="Body for Field Notes/inside-folder.fractal.html"]', 30_000);

  await driver.setValue(".editor-tab-panel.active .document-title-field input", projectName);
  await driver.setValue(".editor-tab-panel.active .rich-content-editable", "Saved from the desktop WebDriver smoke test.");
  await driver.find(".save-state.unsaved");
  await driver.ctrlS();
  await driver.find(".save-state.saved");
  await takeScreenshot(driver, screenshotsDir, "03-after-edit-save-shortcut");

  await driver.click('.explorer-row.folder[title="Field Notes"] .explorer-folder-open');
  await driver.find('.folder-view[aria-label="Folder Field Notes"]', 30_000);
  await takeScreenshot(driver, screenshotsDir, "03a-folder-view");

  const folderAddControlCount = await driver.executeScript(`return document.querySelectorAll('.editor-tab-panel.active .folder-add-row .folder-add-ghost').length;`);
  if (folderAddControlCount !== 2) throw new Error(`Folder view has ${folderAddControlCount} add controls instead of two.`);
  await driver.click('.editor-tab-panel.active .folder-add-row.top .folder-add-ghost');
  const firstFolderAddAction = await driver.text('.editor-tab-panel.active .folder-add-row.top .folder-add-menu button:first-child strong');
  if (firstFolderAddAction !== "New page") throw new Error(`The first folder add action is ${firstFolderAddAction}.`);
  await takeScreenshot(driver, screenshotsDir, "03aa-folder-add-menu");
  await driver.click('.editor-tab-panel.active .folder-add-row.top .folder-add-menu button:first-child');
  await driver.setValue('.create-page-dialog input', "Folder View Page");
  await driver.click('.create-page-dialog .primary-action');
  await driver.find('[aria-label="Body for Field Notes/folder-view-page.fractal.html"]', 30_000);

  await driver.click('.workspace-nav-controls button[title="Back in left"]');
  await driver.find('.folder-view[aria-label="Folder Field Notes"]', 30_000);
  await driver.click('.editor-tab-panel.active .folder-add-row.bottom .folder-add-ghost');
  await driver.click('.editor-tab-panel.active .folder-add-row.bottom .folder-add-menu button:nth-child(2)');
  await driver.setValue('.create-page-dialog input', "Nested View");
  await driver.click('.create-page-dialog .primary-action');
  await driver.find('.explorer-row.folder[title="Field Notes/Nested View"]', 30_000);
  await takeScreenshot(driver, screenshotsDir, "03ab-folder-created-items");

  const openedNestedFolder = await driver.executeScript(`
    const card = [...document.querySelectorAll('.editor-tab-panel.active .folder-sequence-item.folder .folder-sequence-card')]
      .find((candidate) => candidate.querySelector('code')?.textContent === 'Field Notes/Nested View');
    card?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    return Boolean(card);
  `);
  if (!openedNestedFolder) throw new Error("Could not find the new nested folder card for double-click.");
  await driver.find('.folder-view[aria-label="Folder Nested View"]', 30_000);
  const emptyFolderEdgeControls = await driver.executeScript(`return document.querySelectorAll('.editor-tab-panel.active .folder-add-row').length;`);
  if (emptyFolderEdgeControls !== 0) throw new Error(`Empty folder has ${emptyFolderEdgeControls} edge add controls.`);
  await driver.click('.editor-tab-panel.active .folder-view-empty');
  await driver.find('.editor-tab-panel.active .folder-empty-row .folder-add-menu');

  await driver.click('.editor-group-tab.folder button[role="tab"][title="Field Notes"]');
  await driver.find('.folder-view[aria-label="Folder Field Notes"]', 30_000);
  const openedFolderPage = await driver.executeScript(`
    const card = [...document.querySelectorAll('.editor-tab-panel.active .folder-sequence-item.native .folder-sequence-card')]
      .find((candidate) => candidate.querySelector('code')?.textContent === 'Field Notes/folder-view-page.fractal.html');
    card?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    return Boolean(card);
  `);
  if (!openedFolderPage) throw new Error("Could not find the new page card for double-click.");
  await driver.find('[aria-label="Body for Field Notes/folder-view-page.fractal.html"]', 30_000);

  await driver.click('.workspace-nav-controls button[title="Back in left"]');
  await driver.find('.folder-view[aria-label="Folder Field Notes"]', 30_000);
  await driver.click('.editor-tab-panel.active .folder-view-eyebrow button');
  await driver.find('.folder-export-dialog[aria-labelledby="folder-export-title"]');
  const folderExportSelection = await driver.text('.folder-export-selection > header small');
  if (folderExportSelection !== "2 of 2 selected") {
    throw new Error(`Folder export did not select the native page: ${folderExportSelection}`);
  }
  await driver.click('.folder-export-selection > header > div:last-child button:nth-child(2)');
  await driver.find('.folder-export-dialog .export-error');
  await driver.click('.folder-export-selection > header > div:last-child button:nth-child(1)');
  await driver.click('.folder-export-settings .export-check-row:nth-of-type(1) input');
  await driver.click('.folder-export-validity label:nth-of-type(2) input');
  await takeScreenshot(driver, screenshotsDir, "03b-folder-export");
  await driver.click('.folder-export-dialog .export-dialog-header > button');
  await driver.click('.editor-tab-panel.active .folder-sequence-item.native .folder-sequence-actions button:nth-of-type(1)');
  await driver.find('.editor-tab-panel.active .folder-document-editor .rich-content-editable', 30_000);
  await driver.sendKeys('.editor-tab-panel.active .folder-document-editor .rich-content-editable', " Edited from the folder view.");
  await driver.ctrlS();
  await driver.find(".save-state.saved");
  await takeScreenshot(driver, screenshotsDir, "03c-folder-inline-editor");
  await driver.click('.editor-tab-panel.active .folder-sequence-item.native .folder-sequence-actions button:nth-of-type(2)');
  await driver.find('.editor-tab-panel.active .rich-content-editable', 30_000);
  const folderEdit = await driver.text('.editor-tab-panel.active .rich-content-editable');
  if (!folderEdit.includes("Edited from the folder view.")) {
    throw new Error(`Folder edit did not reach the child page: ${folderEdit}`);
  }

  await driver.click('.explorer-header button[title="Create page"]');
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

  await driver.setValue(".editor-tab-panel.active .rich-content-editable", "Index");
  await driver.find('.editor-tab-panel.active .rich-content-editable .rich-derived-link[data-amanite-derived-target="index.fractal.html"]', 30_000);
  const derivedLinkShape = await driver.executeScript(`
    const derived = document.querySelector('.editor-tab-panel.active .rich-content-editable .rich-derived-link[data-amanite-derived-target="index.fractal.html"]');
    return { href: derived?.getAttribute('href'), role: derived?.getAttribute('role'), tagName: derived?.tagName };
  `);
  if (derivedLinkShape.href || derivedLinkShape.role !== "link" || derivedLinkShape.tagName !== "SPAN") {
    throw new Error(`Derived link became an anchor: ${JSON.stringify(derivedLinkShape)}`);
  }
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
  if (!derivedAfterReload.derived || derivedAfterReload.explicit) {
    throw new Error(`Derived link persisted as an explicit link: ${JSON.stringify(derivedAfterReload)}`);
  }
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

  for (const title of ["Alpha", "Beta", "Gamma", "Delta"]) {
    await driver.click('.explorer-header button[title="Create page"]');
    await driver.setValue(".create-page-dialog input", title);
    await driver.click(".create-page-dialog .primary-action");
    await driver.find(`[title="${title.toLowerCase()}.fractal.html"]`, 30_000);
  }

  await driver.executeScript(`
    const tab = document.querySelector('.editor-group[data-group-id="left"] [title="index.fractal.html"]')?.closest('.editor-group-tab');
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
  await driver.find('.editor-groups.split .editor-group[data-group-id="right"] [title="index.fractal.html"]', 30_000);

  await driver.executeScript(`
    const tab = document.querySelector('.editor-group[data-group-id="left"] [title="my-file.fractal.html"]')?.closest('.editor-group-tab');
    const target = document.querySelector('.editor-group[data-group-id="right"] .editor-group-tabs');
    const transfer = new DataTransfer();
    tab?.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    target?.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    target?.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    tab?.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }));
  `);
  await driver.find('.editor-group[data-group-id="right"] .editor-group-tab.active [title="my-file.fractal.html"]', 30_000);
  const groupCounts = await driver.executeScript(`
    return {
      left: document.querySelectorAll('.editor-group[data-group-id="left"] .editor-group-tab').length,
      right: document.querySelectorAll('.editor-group[data-group-id="right"] .editor-group-tab').length
    };
  `);
  if (groupCounts.left < 4 || groupCounts.right !== 2) throw new Error(`Unexpected editor group tab counts: ${JSON.stringify(groupCounts)}`);

  await driver.setValue('.editor-group[data-group-id="right"] .editor-tab-panel.active .rich-content-editable', "Local edit before an external change.");
  const externalPagePath = join(activeProjectRoot, "pages", "my-file.fractal.html");
  const externalSource = await readFile(externalPagePath, "utf8");
  await writeFile(externalPagePath, externalSource.replace("</main>", "<p>External edit detected.</p></main>"));
  await driver.find('.editor-group[data-group-id="right"] .document-buffer-alert.conflict', 10_000);
  await driver.click('.editor-group[data-group-id="right"] .document-buffer-actions button:first-child');
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  await driver.find('.editor-group[data-group-id="right"] .editor-tab-panel.active .rich-content-editable[contenteditable="true"]', 30_000);
  await driver.setValue('.editor-group[data-group-id="right"] .editor-tab-panel.active .rich-content-editable[contenteditable="true"]', "Written in the right editor group.");
  await driver.find('.editor-group[data-group-id="right"] .editor-group-tab-state.dirty');
  await takeScreenshot(driver, screenshotsDir, "04b-split-pane");
  await driver.ctrlW();
  await driver.find('.editor-group[data-group-id="right"] .editor-group-tab.active [title="index.fractal.html"]', 30_000);
  await driver.ctrlShiftT();
  await driver.find('.editor-group[data-group-id="right"] .editor-group-tab.active [title="my-file.fractal.html"]', 30_000);
  await driver.click('.editor-group[data-group-id="right"] .editor-group-close');
  await driver.find(".editor-groups:not(.split)", 30_000);
  await takeScreenshot(driver, screenshotsDir, "04c-split-pane-closed");

  await driver.click(".editor-tab-panel.active .editor-inspector-toggle");
  await driver.find(".fractal-inspector", 10_000);
  await takeScreenshot(driver, screenshotsDir, "05-inspector");

  await driver.click(".sidebar-settings");
  await driver.find(".settings-screen");
  await driver.find('.ai-settings input[aria-label="OpenAI-compatible endpoint"]');
  await driver.find('.ai-settings select[aria-label="AI model"]');
  await takeScreenshot(driver, screenshotsDir, "06-ai-settings");
  await driver.click(".theme-option.moss");
  const settingsScroll = await driver.executeScript(`
    const screen = document.querySelector('.settings-screen');
    screen.scrollTop = screen.scrollHeight;
    return { clientHeight: screen.clientHeight, scrollHeight: screen.scrollHeight, scrollTop: screen.scrollTop };
  `);
  if (!(settingsScroll.scrollHeight > settingsScroll.clientHeight && settingsScroll.scrollTop > 0)) {
    throw new Error(`Settings screen did not scroll: ${JSON.stringify(settingsScroll)}`);
  }
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

  const editedPath = await driver.executeScript(`return document.querySelector('.editor-group.focused .editor-group-tab.active button[title]')?.getAttribute('title');`);
  if (!editedPath) throw new Error("Focused editor group did not expose an active tab.");
  await driver.setValue(".editor-tab-panel.active .rich-content-editable", "Saved during a page switch.");
  await driver.find(".save-state.unsaved");
  await driver.click('[title="index.fractal.html"]');
  await driver.find('.editor-group-tab.active [title="index.fractal.html"]');
  await driver.click(`[title="${editedPath}"]`);
  const switchedText = await driver.text(".editor-tab-panel.active .rich-content-editable");
  if (!switchedText.includes("Saved during a page switch.")) {
    throw new Error(`Page switch did not preserve the dirty buffer: ${switchedText}`);
  }
  await driver.ctrlS();
  await driver.find(".save-state.saved");
  await driver.click('[title="my-file.fractal.html"]');
  await takeScreenshot(driver, screenshotsDir, "07-buffer-after-switch");

  const recoverySource = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fractal-format" content="1"><title>Recovered page</title></head><body><main data-fractal-document><h1>Recovered page</h1><p>Recovered from Amanite local storage.</p></main></body></html>';
  await driver.executeScript(`
    const tab = document.querySelector('.editor-group-tab [title="index.fractal.html"]')?.closest('.editor-group-tab');
    tab?.querySelector('.editor-group-tab-close')?.click();
  `);
  await driver.executeScript(`
    const [projectRoot, pagePath, source] = arguments;
    const key = "amanite.page-draft.v1:" + encodeURIComponent(projectRoot + "\\u0000" + pagePath);
    localStorage.setItem(key, JSON.stringify({ pagePath, projectRoot, source, updatedAt: new Date().toISOString(), version: 1 }));
  `, [activeProjectRoot, "index.fractal.html", recoverySource]);
  await driver.click('[title="index.fractal.html"]');
  await driver.find(".confirm-dialog");
  await driver.click(".confirm-dialog .primary-action");
  await driver.find(".save-state.unsaved");
  const recoveredText = await driver.text(".editor-tab-panel.active .rich-content-editable");
  if (!recoveredText.includes("Recovered from Amanite local storage.")) {
    throw new Error(`Draft recovery returned unexpected text: ${recoveredText}`);
  }
  await driver.ctrlS();
  await driver.find(".save-state.saved");
  await takeScreenshot(driver, screenshotsDir, "08-recovered-draft");

  await driver.click('.brand > button[title="Close project"]');
  await driver.find(".start-screen", 30_000);
  await driver.click(`.project-list-option[title="${activeProjectRoot}"]`);
  await driver.find(`.folder-view[aria-label="Folder ${projectName}"]`, 30_000);
  await driver.find('.editor-group-tab.folder.active button[role="tab"][title="Pages"]');
  const reopenedOnDocument = await driver.executeScript(`return Boolean(document.querySelector('.editor-tab-panel.active .rich-content-editable'));`);
  if (reopenedOnDocument) throw new Error("Reopened project started on a document instead of the project overview.");
  await takeScreenshot(driver, screenshotsDir, "09-reopened-project-overview");
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
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));

  return { child, log };
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await checkSetup();

  if (options.doctor) {
    return;
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactsDir = resolve(
    repoRoot,
    options.screenshotsDir || join("artifacts", "tauri-webdriver", runId)
  );
  const projectRoot = resolve(
    repoRoot,
    options.projectRoot || join("artifacts", "tauri-webdriver", runId, "projects")
  );

  await mkdir(artifactsDir, { recursive: true });
  await mkdir(projectRoot, { recursive: true });

  if (!options.skipBuild) {
    await runChecked("pnpm", [
      "exec",
      "tauri",
      "build",
      "--debug",
      "--no-bundle",
      "--features",
      "webdriver"
    ]);
  }

  const appBinary = process.env.AMANITE_TAURI_APP_BINARY || defaultBinary;
  const { child: appProcess, log } = startApp({
    appBinary,
    artifactsDir,
    port: options.port,
    projectRoot
  });

  let driver = null;

  const cleanup = async () => {
    if (driver) {
      try {
        await driver.deleteSession();
      } catch {
        // The app may already be gone.
      }
    }

    if (appProcess.exitCode === null) {
      appProcess.kill("SIGTERM");
      setTimeout(() => {
        if (appProcess.exitCode === null) {
          appProcess.kill("SIGKILL");
        }
      }, 2_000).unref();
    }

    log.end();
  };

  process.once("SIGINT", async () => {
    await cleanup();
    process.exit(130);
  });
  process.once("SIGTERM", async () => {
    await cleanup();
    process.exit(143);
  });

  try {
    await waitForWebDriver(options.port, appProcess);
    driver = new DesktopWebDriverClient(options.port);
    await driver.createSession();
    await runSmoke(driver, artifactsDir, projectRoot);

    if (options.keepOpen) {
      await waitForEnter();
    }
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
