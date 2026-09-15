# R1 verification

The document session now owns one Lexical controller per view ID and one history
state per document. Controllers copy Lexical editor states directly. HTML is
not the view synchronization channel. A synchronized state keeps the receiving
view's selection, and scroll remains keyed by the full group or folder view ID.

Only the current input owner mounts Lexical history against the shared history
state. Moving control to another group or folder view changes the command
handler without replacing the undo and redo stacks. Inactive visible views use
the same rich editor nodes with editing disabled, so formatting, lists, tables,
and links remain visible.

Deterministic tests cover state propagation between distinct view controllers,
shared history identity, and undo after moving the history command handler to a
second view. The existing desktop flow covers formatting, table edits, links,
synthetic composition, undo, group splitting, folder editing, warm switching,
rename, and save behavior.

Real OS IME input and simultaneous conflicting pointer input are still platform
acceptance items for R7. The current session registry deliberately retains
controllers after the last view detaches. R2 will add operation-aware close and
disposal barriers.

The full Tauri WebDriver build and smoke flow passed on 2026-09-15. Its ignored
screenshots, logs, and two-phase data-flow records are under
`artifacts/tauri-webdriver/2026-09-15T16-07-04-876Z/`. The run caught and fixed
two source-replacement bugs: stale peer selections could abort a batch import,
and a recovery source could be mistaken for the already loaded session body.
