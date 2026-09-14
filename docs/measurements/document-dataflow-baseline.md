# Document data-flow baseline

Captured for D0 on 2026-09-14 with the deterministic fixture generator in
[`scripts/document-dataflow-fixtures.mjs`](../../scripts/document-dataflow-fixtures.mjs)
and benchmark in
[`scripts/document-dataflow-benchmark.mjs`](../../scripts/document-dataflow-benchmark.mjs).

The generated documents are not committed. Run:

```sh
pnpm run dataflow:benchmark
```

The command writes `artifacts/document-dataflow/baseline.json` and the fixture
files used by the run. The JSON report is the machine-readable record for later
comparisons.

## Fixture matrix

- Five structures at 100,000, 1,000,000, and 5,000,000 visible characters:
  many short paragraphs, one huge paragraph, nested lists, a large table, and
  dense explicit links.
- Invalid native-looking documents with a missing document root and missing
  native sections.
- A Fractal-valid page containing a figure and image that the rich editor must
  protect rather than rewrite.
- A 48-page project with dirty pages, warm and cold pages, the same page named
  in both editor groups, and a folder-edit case.

## Reproducible interaction sequences

1. Open the many-page project, open one page cold, type one character, wait 200
   ms, and close the tab immediately.
2. Open two pages, type into both, then invoke Save all before any export.
3. Start a composition session, request close while composition is active, and
   verify the committed text after reopening.
4. Open one page in both groups, edit and undo from each group, then switch
   groups without reloading the document.
5. Edit a page, terminate the desktop process, reopen the project, and choose
   recovery. Compare the restored source with the last confirmed draft.

## Budgets selected for project hardware

These are acceptance targets, not claims about the baseline:

| Interaction | Target |
| --- | ---: |
| Cold first editable paint | <= 1,500 ms |
| Warm tab activation | <= 50 ms |
| Typing foreground stall, p95 | <= 50 ms |
| Longest post-pause typing stall | <= 100 ms |
| Recovery checkpoint lag during continuous typing | <= 2,000 ms |
| Ordinary typing complete HTML exports | 0 |

The 5,000,000-character fixture is deliberately reported even when it exceeds
these limits. A large-document failure is evidence about the current editor,
not a reason to lower the fixture size.

## Integrity baseline

The existing frontend and Rust test suites pass before D1. The baseline
reproductions are represented by the native section-save, pending-revision,
save-all, stale-project, and draft identity tests. Any case that remains
unreproduced is called out in the D8 report rather than treated as fixed.
