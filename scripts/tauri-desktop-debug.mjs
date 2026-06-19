#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
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
    const id = await this.find(selector, timeout);
    await this.request("POST", this.sessionPath(`/element/${id}/clear`), {});
    await this.request("POST", this.sessionPath(`/element/${id}/value`), { text: value });
  }

  async sendKeys(selector, value, timeout) {
    const id = await this.find(selector, timeout);
    await this.request("POST", this.sessionPath(`/element/${id}/value`), { text: value });
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

async function runSmoke(driver, screenshotsDir) {
  await driver.find(".start-screen");
  await takeScreenshot(driver, screenshotsDir, "01-start-screen");

  const runSlug = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const projectName = `Desktop WebDriver ${runSlug}`;

  await driver.setValue('input[placeholder="Field notes"]', projectName);
  await driver.click("button.primary-action");

  await driver.find(".workspace", 30_000);
  await driver.find(".rich-content-editable", 30_000);
  await takeScreenshot(driver, screenshotsDir, "02-workspace");

  await driver.setValue(".rich-title-input", `${projectName} Edited`);
  await driver.ctrlS();
  await takeScreenshot(driver, screenshotsDir, "03-after-edit-save-shortcut");

  await driver.click(".editor-inspector-toggle");
  await driver.find(".fractal-inspector", 10_000);
  await takeScreenshot(driver, screenshotsDir, "04-inspector");
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
    await runSmoke(driver, artifactsDir);

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
