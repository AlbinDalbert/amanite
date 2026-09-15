# R2 verification

Snapshot replies now contain the document ID, project generation, source
incarnation, request ID, and captured revision. The coordinator chooses the
registered controller with the newest revision and calls only that controller.
It reuses compatible in-flight work and rejects mismatched or older replies.

The shared session keeps revision numbers monotonic. Replacing source advances a
separate incarnation and clears history because history entries belong to the
previous native source. Workspace and recovery publication reject mismatched
documents, project generations, older incarnations, and older revisions.

Focus loss and component cleanup no longer serialize complete HTML. Saves,
recovery, and close use explicit snapshot requests. A save refuses to proceed
when dirty editor state needs a snapshot but no controller can supply one. If
composition is active, the controller waits up to one second for
`compositionend`; timeout is a visible save failure and leaves the buffer open.

Existing persistence tests cover immediate flush before save, edits arriving
during save, save-all rescans, title and body section ordering, partial success,
original section hashes, composition failure, and committed or indeterminate
outcomes. New coordinator tests cover one-controller selection, request
coalescing, identity rejection, and monotonic source incarnation.

The Linux desktop path exercised reload after a conflicting edit and native
draft recovery during R1. Real composition-at-close with an OS IME remains a
platform acceptance item in R7.
