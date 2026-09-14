import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const DEFAULT_SIZES = [100_000, 1_000_000, 5_000_000];

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function repeatToLength(pattern, length) {
  if (length <= 0) return "";
  const repetitions = Math.ceil(length / pattern.length);
  return pattern.repeat(repetitions).slice(0, length);
}

function nativeSource(title, content, { metadata = "", style = "" } = {}) {
  return `<!doctype html>\n<html><head><meta name="fractal-format" content="1"><title>${escapeHtml(title)}</title><style data-fractal-style>${style}</style><meta data-fractal-metadata>${metadata}</meta></head><body><main data-fractal-document><h1 data-fractal-title>${escapeHtml(title)}</h1>${content}</main></body></html>\n`;
}

function paragraphContent(size) {
  const sentence = "Amanite keeps the document session warm while Fractal remains the durable source of truth. ";
  const text = repeatToLength(sentence, size);
  const paragraphs = [];
  for (let offset = 0; offset < text.length; offset += 240) {
    paragraphs.push(`<p>${escapeHtml(text.slice(offset, offset + 240))}</p>`);
  }
  return paragraphs.join("");
}

function hugeParagraphContent(size) {
  return `<p>${escapeHtml(repeatToLength("one enormous editable paragraph keeps the parser honest ", size))}</p>`;
}

function nestedListContent(size) {
  const item = "Nested list item with enough text to exercise block boundaries. ";
  const text = repeatToLength(item, size);
  const items = [];
  for (let offset = 0; offset < text.length; offset += 150) {
    const value = escapeHtml(text.slice(offset, offset + 150));
    items.push(`<li>${value}${offset % 450 === 0 ? `<ul><li>${escapeHtml(item)}</li><li>${escapeHtml(item)}</li></ul>` : ""}</li>`);
  }
  return `<ol>${items.join("")}</ol>`;
}

function tableContent(size) {
  const cell = "Table cell text for import batching and layout measurements. ";
  const rows = [];
  let visible = 0;
  let row = 0;
  while (visible < size) {
    const cells = Array.from({ length: 6 }, (_, column) => {
      const value = `${cell}${row}-${column}`;
      visible += value.length;
      return `<td>${escapeHtml(value)}</td>`;
    });
    rows.push(`<tr>${cells.join("")}</tr>`);
    row += 1;
  }
  return `<table><thead><tr><th>Column A</th><th>Column B</th><th>Column C</th><th>Column D</th><th>Column E</th><th>Column F</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function linkContent(size) {
  const sentence = "Read the Index, Field Notes, and Reference pages before continuing. ";
  const text = repeatToLength(sentence, size);
  const escaped = escapeHtml(text)
    .replaceAll("Index", '<a href="index.fractal.html">Index</a>')
    .replaceAll("Field Notes", '<a href="notes/field-notes.fractal.html">Field Notes</a>');
  return `<h2>Links</h2><p>${escaped}</p>`;
}

function fixtureDescriptor(size) {
  return [
    ["many-short", paragraphContent(size)],
    ["huge-paragraph", hugeParagraphContent(size)],
    ["nested-lists", nestedListContent(size)],
    ["large-table", tableContent(size)],
    ["dense-links", linkContent(size)]
  ].map(([structure, content]) => ({
    file: `${structure}-${size}.fractal.html`,
    size,
    structure,
    source: nativeSource(`${structure} ${size}`, content)
  }));
}

function smallIntegrityFixtures() {
  return [
    {
      file: "invalid-missing-root.fractal.html",
      kind: "invalid",
      source: "<!doctype html>\n<html><head><title>Invalid</title></head><body><article>There is no Fractal document root.</article></body></html>\n"
    },
    {
      file: "invalid-malformed-native.fractal.html",
      kind: "invalid",
      source: "<!doctype html>\n<html><head><title>Malformed</title></head><body><main data-fractal-document><p>Missing native title and section metadata.</p></main></body></html>\n"
    },
    {
      file: "protected-fractal-valid.fractal.html",
      kind: "fractal-valid-rich-protected",
      source: nativeSource("Protected", '<figure><img src="diagram.png" alt="Diagram"><figcaption>Preserve this exact source.</figcaption></figure><p>Fractal can read this native page, but the rich editor cannot round-trip its figure.</p>')
    }
  ];
}

function manyPageProject() {
  const pages = [];
  for (let index = 0; index < 48; index += 1) {
    const folder = index % 3 === 0 ? "notes/" : index % 3 === 1 ? "chapters/part-one/" : "";
    const title = `Fixture page ${String(index + 1).padStart(2, "0")}`;
    pages.push({
      file: `${folder}${title.toLowerCase().replaceAll(" ", "-")}.fractal.html`,
      title,
      source: nativeSource(title, `<p>${escapeHtml(repeatToLength("Many-page project content for catalog, search, and warm-tab checks. ", 2_400))}</p>`)
    });
  }
  return pages;
}

export function createFixtureManifest() {
  const documents = DEFAULT_SIZES.flatMap(fixtureDescriptor).map(({ file, size, structure }) => ({ file, size, structure }));
  return {
    version: 1,
    visibleCharacterSizes: DEFAULT_SIZES,
    documents: [...documents, ...smallIntegrityFixtures().map(({ file, kind }) => ({ file, kind }))],
    manyPageProject: { pageCount: 48, dirtyPages: ["notes/fixture-page-01.fractal.html", "chapters/part-one/fixture-page-02.fractal.html"], warmPages: ["fixture-page-03.fractal.html"], coldPages: ["fixture-page-04.fractal.html"], samePageInBothGroups: "notes/fixture-page-01.fractal.html", folderEdit: "notes" },
    semantics: {
      invalidDocumentsStayExact: true,
      protectedDocumentsStayExact: true,
      recoveryDraftsAreNativeSourceOutsideProject: true
    }
  };
}

export async function writeFixtures(outputDirectory) {
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: true });
  const fixtureFiles = [...DEFAULT_SIZES.flatMap(fixtureDescriptor), ...smallIntegrityFixtures()];
  for (const fixture of fixtureFiles) {
    const path = join(directory, fixture.file);
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, fixture.source, "utf8");
  }

  const projectDirectory = join(directory, "many-page-project");
  await mkdir(join(projectDirectory, "pages"), { recursive: true });
  await writeFile(join(projectDirectory, "fractal.json"), JSON.stringify({ name: "Data-flow fixture project", version: 2 }, null, 2) + "\n", "utf8");
  for (const page of manyPageProject()) {
    const path = join(projectDirectory, "pages", page.file);
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, page.source, "utf8");
  }

  const manifest = createFixtureManifest();
  await writeFile(join(directory, "fixture-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return { directory, fixtureFiles, projectDirectory, manifest };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const output = process.argv[2] || "artifacts/document-dataflow/fixtures";
  const result = await writeFixtures(output);
  console.log(`Wrote ${result.fixtureFiles.length} document fixtures and ${result.manifest.manyPageProject.pageCount}-page project to ${result.directory}`);
}
