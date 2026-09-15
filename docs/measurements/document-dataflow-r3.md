# R3 verification

Each document session now owns one `DerivedEditorModel`. The session update
listener receives Lexical's dirty element and leaf sets, maps them to cached
top-level blocks, and rebuilds only those blocks. Root-level structural changes
rebuild the block order. Deletion removes the old block through the retained
node-to-block map.

Paragraph, word, and character counts update by subtracting the previous block
summary and adding the replacement. Outline items compose from cached heading
summaries. Full text is a lazy, revision-keyed value, so an ordinary edit does
not join every block unless search, Quick Open, Borealis, or another text
consumer reads it.

The bridge no longer performs its own full-model read for shared production
sessions, and the old shared mirror listener no longer performs a second read.
Inactive rich views receive the same Lexical editor state and do not compute a
separate document model. The query index rejects an older or duplicate model by
revision without reading its lazy text.

Tests cover Unicode text, headings, nested lists, block counts, a dirty-leaf
update, lazy search semantics, stale query results, unsaved overlays, and a
body-only catalog update that leaves the title index unchanged. R7 will compare
the recorded model and input costs against R0 on the real desktop fixtures.
