# D3 verification

Completed on 2026-09-14 after D0 through D2 had been committed.

## Structural result

- Lexical edits report a monotonic revision immediately.
- Ordinary edits update the live model and do not export complete HTML or
  rebuild native source.
- A registered editor snapshot is exported only for an explicit request,
  including save and close barriers. Concurrent requests use the same pending
  snapshot.
- Counts, outline, and find text use the live model after import. Native source
  analysis remains at import, replacement, and snapshot boundaries.
- One shared editor session owns the model and history. Non-owning views display
  a read-only text mirror, so a duplicate view does not create a second editor
  transaction stream.

## Verification evidence

- `pnpm exec tsc -b --pretty false`
- `pnpm test -- --runInBand`: 31 test files and 98 tests passed.
- `pnpm run build`: passed.
- `pnpm run tauri:webdriver:smoke`: passed. The run is recorded under
  `artifacts/tauri-webdriver/2026-09-14T20-18-46-922Z/`.

The new `HtmlBridgePlugin` contract test checks that a content transaction
reports revision 1 without calling the serializer, then that an explicit
snapshot request returns the serialized revision and body. The live model tests
cover counts, headings, Unicode matching, and replacement without changing
explicit link text.

## Remaining measurement limit

D0 contains the comparable HTML parse and source-reconstruction timings. D3
changes the ordinary edit path, but the desktop harness does not yet collect
per-keystroke export counts or Lexical import timing. The initial DOM parse is
still synchronous. Import now yields on an 8 ms batch budget with up to 12
top-level nodes or 32,000 text characters; one enormous top-level paragraph or
table remains a single Lexical import operation. D8 must repeat the D0 fixture
matrix and report these cases separately.
