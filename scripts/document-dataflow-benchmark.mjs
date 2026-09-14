import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { JSDOM } from "jsdom";
import { writeFixtures } from "./document-dataflow-fixtures.mjs";

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentileValue))];
}

function measure(task, repeats = 3) {
  const values = [];
  let result;
  for (let attempt = 0; attempt < repeats; attempt += 1) {
    const start = performance.now();
    result = task();
    values.push(performance.now() - start);
  }
  return { medianMs: percentile(values, 0.5), p95Ms: percentile(values, 0.95), longestMs: Math.max(...values), result };
}

function visibleText(document) {
  const root = document.body.querySelector("main[data-fractal-document]");
  return root?.textContent?.replace(/\s+/gu, " ").trim() || "";
}

async function benchmarkFile(path) {
  const readStart = performance.now();
  const source = await readFile(path, "utf8");
  const readMs = performance.now() - readStart;
  // Large documents are intentionally measured once. Repeated jsdom parses
  // retain enough DOM bookkeeping to distort the process-memory result before
  // the next fixture gets a fair run.
  const repeats = source.length > 1_000_000 ? 1 : 3;
  const parsed = measure(() => {
    const dom = new JSDOM(source);
    dom.window.close();
  }, repeats);
  const analyzed = measure(() => {
    const dom = new JSDOM(source);
    const text = visibleText(dom.window.document);
    dom.window.close();
    return text;
  }, repeats);
  const reconstructed = measure(() => {
    const dom = new JSDOM(source);
    const result = `<!doctype html>\n${dom.window.document.documentElement.outerHTML}\n`;
    dom.window.close();
    return result;
  }, repeats);
  const draftStart = performance.now();
  await writeFile(`${path}.draft.tmp`, source, "utf8");
  const draftWriteMs = performance.now() - draftStart;
  return {
    bytes: Buffer.byteLength(source),
    visibleCharacters: analyzed.result.length,
    pageReadMs: readMs,
    htmlParseMs: parsed.medianMs,
    visibleTextQueryMs: analyzed.medianMs,
    sourceReconstructionMs: reconstructed.medianMs,
    draftWriteMs,
    ipcPayloadBytes: Buffer.byteLength(JSON.stringify({ source }))
  };
}

async function main() {
  const output = resolve(process.argv[2] || "artifacts/document-dataflow");
  const fixtures = await writeFixtures(join(output, "fixtures"));
  const results = {};
  for (const fixture of fixtures.fixtureFiles.filter((entry) => entry.size)) {
    results[fixture.file] = await benchmarkFile(join(fixtures.directory, fixture.file));
  }
  const report = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    fixtureDirectory: fixtures.directory,
    results
  };
  await writeFile(join(output, "baseline.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
}

await main();
